import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { YoutubeVideoId } from '../domain/youtube-url.js'
import { CaptionSourcePort } from '../ports/shadowing-ports.js'
import { YtDlpCaptionSourceLive } from './yt-dlp-caption-source.js'

const json3 = (text: string) => ({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: text }] }] })
const enTrack = [{ ext: 'json3' }]

/** Per video id: the `--dump-single-json` output and the json3 file written on download. */
const fixtures: Record<string, { info: unknown; captions?: unknown }> = {
  manualVid01: {
    info: {
      id: 'manualVid01',
      title: 'Manual talk',
      thumbnail: 'https://i.ytimg.com/vi/manualVid01/hqdefault.jpg',
      duration: 61.6,
      playable_in_embed: true,
      subtitles: { 'en-US': enTrack },
      automatic_captions: { en: enTrack, 'en-orig': enTrack }
    },
    captions: json3('hello there world')
  },
  autoVideo01: {
    info: { id: 'autoVideo01', title: 'Auto talk', automatic_captions: { 'en-orig': enTrack, en: enTrack } },
    captions: json3('auto words')
  },
  noEmbed0001: { info: { id: 'noEmbed0001', title: 'x', playable_in_embed: false, subtitles: { en: enTrack } } },
  noCaptions1: { info: { id: 'noCaptions1', title: 'x', subtitles: { fr: enTrack }, automatic_captions: { de: enTrack } } },
  emptyCaps01: { info: { id: 'emptyCaps01', title: 'x', subtitles: { en: enTrack } }, captions: json3('[Music]') },
  failSubs001: { info: { id: 'failSubs001', title: 'x', subtitles: { en: enTrack } } }
}

const longStderr = `${'noise '.repeat(300)}ERROR: [youtube] failMeta001: Video unavailable`

const fakeYtDlpSource = (logPath: string): string => `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + '\\n')
const fixtures = ${JSON.stringify(fixtures)}
const id = new URL(args[args.length - 1]).searchParams.get('v')
if (args.includes('--dump-single-json')) {
  if (id === 'failMeta001') {
    process.stderr.write(${JSON.stringify(longStderr)})
    process.exit(1)
  }
  if (id === 'badJson0001') {
    process.stdout.write('{not json')
    process.exit(0)
  }
  process.stdout.write(JSON.stringify(fixtures[id].info))
  process.exit(0)
}
if (id === 'failSubs001') {
  process.stderr.write('ERROR: unable to download video subtitles')
  process.exit(2)
}
const output = args[args.indexOf('-o') + 1]
const lang = args[args.indexOf('--sub-langs') + 1]
fs.writeFileSync(output.replace('%(id)s', id).replace('%(ext)s', lang + '.json3'), JSON.stringify(fixtures[id].captions))
`

let workDir = ''
let logPath = ''
let fakePath = ''

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'fake-yt-dlp-'))
  logPath = join(workDir, 'argv.log')
  fakePath = join(workDir, 'yt-dlp')
  writeFileSync(fakePath, fakeYtDlpSource(logPath))
  chmodSync(fakePath, 0o755)
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

beforeEach(() => {
  writeFileSync(logPath, '')
})

const invocations = (): ReadonlyArray<ReadonlyArray<string>> =>
  readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const args: unknown = JSON.parse(line)
      return Array.isArray(args) ? args.map(String) : []
    })

const outputDirs = (): ReadonlyArray<string> =>
  invocations().flatMap((args) => {
    const output = args[args.indexOf('-o') + 1]
    return args.includes('-o') && output !== undefined ? [dirname(output)] : []
  })

const fetchSource = (id: string, path = fakePath) =>
  Effect.runPromise(
    CaptionSourcePort.pipe(
      Effect.flatMap((source) => source.fetchVideoSource(id as YoutubeVideoId)),
      Effect.either,
      Effect.provide(YtDlpCaptionSourceLive(path))
    )
  )

describe('yt-dlp caption source', () => {
  it('downloads the manual English track with --write-subs and returns metadata and words [INV-SHADOW-003]', async () => {
    const result = await fetchSource('manualVid01')

    expect(result).toEqual(
      Either.right({
        metadata: {
          title: 'Manual talk',
          thumbnailUrl: 'https://i.ytimg.com/vi/manualVid01/hqdefault.jpg',
          durationSeconds: 62
        },
        captionKind: 'manual',
        words: [
          { text: 'hello', startMs: 0, endMs: 667 },
          { text: 'there', startMs: 667, endMs: 1333 },
          { text: 'world', startMs: 1333, endMs: 2000 }
        ]
      })
    )

    const [metadataCall, subsCall] = invocations()
    const url = 'https://www.youtube.com/watch?v=manualVid01'
    expect(metadataCall).toEqual(['--dump-single-json', '--skip-download', '--no-warnings', '--', url])
    expect(subsCall?.slice(0, 7)).toEqual(['--skip-download', '--write-subs', '--sub-langs', 'en-US', '--sub-format', 'json3', '-o'])
    expect(subsCall?.slice(-3)).toEqual(['--no-warnings', '--', url])
  })

  it('falls back to the automatic en-orig track with --write-auto-subs and null metadata', async () => {
    const result = await fetchSource('autoVideo01')

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.captionKind).toBe('auto')
      expect(result.right.metadata).toEqual({ title: 'Auto talk', thumbnailUrl: null, durationSeconds: null })
      expect(result.right.words.map((w) => w.text)).toEqual(['auto', 'words'])
    }
    const subsCall = invocations()[1]
    expect(subsCall).toContain('--write-auto-subs')
    expect(subsCall?.[subsCall.indexOf('--sub-langs') + 1]).toBe('en-orig')
  })

  it('rejects an invalid video id before spawning yt-dlp [INV-SHADOW-020]', async () => {
    const result = await fetchSource('abc;rm -rf /')

    expect(Either.isLeft(result) && result.left._tag).toBe('CaptionSourceError')
    expect(invocations()).toEqual([])
  })

  it('removes the caption temp dir after success and after a failed download [INV-SHADOW-020]', async () => {
    await fetchSource('manualVid01')
    const failed = await fetchSource('failSubs001')

    expect(Either.isLeft(failed) && failed.left._tag).toBe('CaptionSourceError')
    const dirs = outputDirs()
    expect(dirs).toHaveLength(2)
    for (const dir of dirs) {
      expect(dir.startsWith(tmpdir())).toBe(true)
      expect(existsSync(dir)).toBe(false)
    }
  })

  it('maps playable_in_embed = false to NotEmbeddableError [INV-SHADOW-021]', async () => {
    const result = await fetchSource('noEmbed0001')

    expect(result).toEqual(Either.left(expect.objectContaining({ _tag: 'NotEmbeddableError', youtubeVideoId: 'noEmbed0001' })))
    expect(invocations()).toHaveLength(1)
  })

  it('maps a video without English tracks to NoCaptionsError [INV-SHADOW-021]', async () => {
    const result = await fetchSource('noCaptions1')

    expect(result).toEqual(Either.left(expect.objectContaining({ _tag: 'NoCaptionsError', youtubeVideoId: 'noCaptions1' })))
    expect(invocations()).toHaveLength(1)
  })

  it('maps a caption file without words to NoCaptionsError and still removes the temp dir [INV-SHADOW-021]', async () => {
    const result = await fetchSource('emptyCaps01')

    expect(result).toEqual(Either.left(expect.objectContaining({ _tag: 'NoCaptionsError', youtubeVideoId: 'emptyCaps01' })))
    expect(outputDirs().every((dir) => !existsSync(dir))).toBe(true)
  })

  it('maps a non-zero exit to CaptionSourceError carrying the stderr tail [INV-SHADOW-021]', async () => {
    const result = await fetchSource('failMeta001')

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('CaptionSourceError')
      expect(result.left).toHaveProperty('message', expect.stringContaining('ERROR: [youtube] failMeta001: Video unavailable'))
      expect(result.left).toHaveProperty('message', expect.not.stringContaining('noise '.repeat(120)))
    }
  })

  it('maps unparseable metadata JSON to CaptionSourceError', async () => {
    const result = await fetchSource('badJson0001')

    expect(Either.isLeft(result) && result.left._tag).toBe('CaptionSourceError')
  })

  it('maps a missing binary to CaptionSourceError naming the path [INV-SHADOW-021]', async () => {
    const missing = join(workDir, 'no-such-yt-dlp')
    const result = await fetchSource('manualVid01', missing)

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('CaptionSourceError')
      expect(result.left).toHaveProperty('message', expect.stringContaining(`yt-dlp not found at ${missing}`))
    }
  })
})
