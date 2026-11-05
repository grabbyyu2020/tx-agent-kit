import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Effect, Layer, Option } from 'effect'
import { parseJson3Captions, selectCaptionTrack } from '../domain/caption-transcript.js'
import { CaptionSourceError, NoCaptionsError, NotEmbeddableError } from '../domain/shadowing-errors.js'
import { isYoutubeVideoId, type YoutubeVideoId } from '../domain/youtube-url.js'
import { CaptionSourcePort, type ShadowingVideoSourceMetadata } from '../ports/shadowing-ports.js'

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT_MS = 120_000
/** `--dump-single-json` includes every format and can be several MB. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024
const STDERR_TAIL_CHARS = 500

type YtDlpCaptionSourceOptions = {
  readonly timeoutMs?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const stderrTail = (error: unknown): string => {
  const stderr = isRecord(error) ? error.stderr : undefined
  return typeof stderr === 'string' ? stderr.trim().slice(-STDERR_TAIL_CHARS) : ''
}

const describeExecFailure = (ytDlpPath: string, error: unknown): string => {
  if (isRecord(error) && error.code === 'ENOENT') {
    return `yt-dlp not found at ${ytDlpPath}`
  }
  if (isRecord(error) && error.killed === true) {
    return `yt-dlp timed out: ${stderrTail(error)}`
  }
  const exit = isRecord(error) && typeof error.code === 'number' ? ` with exit code ${error.code}` : ''
  const tail = stderrTail(error)
  return `yt-dlp failed${exit}: ${tail.length > 0 ? tail : errorMessage(error)}`
}

const parseJson = (text: string, what: string): Effect.Effect<unknown, CaptionSourceError> =>
  Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: (error) => new CaptionSourceError({ message: `yt-dlp returned invalid ${what} JSON: ${errorMessage(error)}` })
  })

const metadataOf = (info: Record<string, unknown>): ShadowingVideoSourceMetadata => ({
  title: typeof info.title === 'string' ? info.title : '',
  thumbnailUrl: typeof info.thumbnail === 'string' ? info.thumbnail : null,
  durationSeconds: typeof info.duration === 'number' && Number.isFinite(info.duration) ? Math.round(info.duration) : null
})

/**
 * Caption source backed by the yt-dlp binary at `ytDlpPath`. yt-dlp is run with `execFile` and an
 * argument array (no shell), `--` before the URL, and only for ids matching the YouTube id pattern.
 * Caption files are written to a fresh temp dir that is removed before the effect completes.
 */
export const makeYtDlpCaptionSource = (
  ytDlpPath: string,
  options?: YtDlpCaptionSourceOptions
): CaptionSourcePort['Type'] => {
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const run = (args: ReadonlyArray<string>): Effect.Effect<string, CaptionSourceError> =>
    Effect.tryPromise({
      try: async () => (await execFileAsync(ytDlpPath, [...args], { timeout, maxBuffer: MAX_BUFFER_BYTES, encoding: 'utf8' })).stdout,
      catch: (error) => new CaptionSourceError({ message: describeExecFailure(ytDlpPath, error) })
    })

  const downloadCaptions = (url: string, dir: string, kind: 'manual' | 'auto', lang: string) =>
    Effect.gen(function* () {
      yield* run([
        '--skip-download',
        kind === 'manual' ? '--write-subs' : '--write-auto-subs',
        '--sub-langs',
        lang,
        '--sub-format',
        'json3',
        '-o',
        join(dir, '%(id)s.%(ext)s'),
        '--no-warnings',
        '--',
        url
      ])
      const files = yield* Effect.tryPromise({
        try: () => readdir(dir),
        catch: (error) =>
          new CaptionSourceError({ message: `Could not read the caption download directory: ${errorMessage(error)}` })
      })
      const captionFiles = files.filter((file) => file.endsWith('.json3'))
      const [file] = captionFiles
      if (file === undefined || captionFiles.length !== 1) {
        return yield* new CaptionSourceError({
          message: `Expected one json3 caption file from yt-dlp, found ${captionFiles.length}`
        })
      }
      const text = yield* Effect.tryPromise({
        try: () => readFile(join(dir, file), 'utf8'),
        catch: (error) => new CaptionSourceError({ message: `Could not read the downloaded caption file: ${errorMessage(error)}` })
      })
      return yield* parseJson3Captions(yield* parseJson(text, 'caption'))
    })

  const withTempDir = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => mkdtemp(join(tmpdir(), 'shadowing-captions-')),
        catch: (error) => new CaptionSourceError({ message: `Could not create a temp dir for captions: ${errorMessage(error)}` })
      }),
      use,
      (dir) => Effect.tryPromise(() => rm(dir, { recursive: true, force: true })).pipe(Effect.ignore)
    )

  return {
    fetchVideoSource: (youtubeVideoId: YoutubeVideoId) =>
      Effect.gen(function* () {
        // Defence in depth: the id is interpolated into an argument, so re-check it here.
        if (!isYoutubeVideoId(youtubeVideoId)) {
          return yield* new CaptionSourceError({ message: 'Invalid YouTube video id' })
        }
        const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`

        const info = yield* parseJson(
          yield* run(['--dump-single-json', '--skip-download', '--no-warnings', '--', url]),
          'metadata'
        )
        if (!isRecord(info)) {
          return yield* new CaptionSourceError({ message: 'yt-dlp metadata is not a JSON object' })
        }
        if (info.playable_in_embed === false) {
          return yield* new NotEmbeddableError({ youtubeVideoId })
        }
        const track = selectCaptionTrack(info)
        if (Option.isNone(track)) {
          return yield* new NoCaptionsError({ youtubeVideoId })
        }

        const { kind, lang } = track.value
        const words = yield* withTempDir((dir) => downloadCaptions(url, dir, kind, lang))
        if (words.length === 0) {
          return yield* new NoCaptionsError({ youtubeVideoId })
        }
        return { metadata: metadataOf(info), captionKind: kind, words }
      })
  }
}

/** Live {@link CaptionSourcePort} running yt-dlp from `ytDlpPath` (worker `YT_DLP_PATH`). */
export const YtDlpCaptionSourceLive = (ytDlpPath: string): Layer.Layer<CaptionSourcePort> =>
  Layer.succeed(CaptionSourcePort, makeYtDlpCaptionSource(ytDlpPath))
