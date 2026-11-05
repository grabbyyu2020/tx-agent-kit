import type { ShadowingCaptionKind, ShadowingSegment } from '@tx-agent-kit/contracts'
import { Either, Option } from 'effect'
import { CaptionSourceError } from './shadowing-errors.js'

/** One caption word with its timing in milliseconds from the start of the video. */
export type CaptionWord = Readonly<Pick<ShadowingSegment, 'text' | 'startMs' | 'endMs'>>

export type CaptionTrackSelectionResult = {
  readonly kind: ShadowingCaptionKind
  readonly lang: string
}

// --- Track selection (yt-dlp --dump-single-json) ---

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasFormats = (value: unknown): boolean => Array.isArray(value) && value.length > 0

const trackKeys = (info: Record<string, unknown>, field: string): ReadonlyArray<string> => {
  const tracks = info[field]
  return isRecord(tracks) ? Object.keys(tracks).filter((lang) => hasFormats(tracks[lang])) : []
}

const AUTO_LANG_PREFERENCE = ['en-orig', 'en'] as const

/**
 * Pick the caption track to import: the first manual track whose language is `en` or `en-*`,
 * else the automatic `en-orig` track, else automatic `en`, else none.
 */
export const selectCaptionTrack = (info: unknown): Option.Option<CaptionTrackSelectionResult> => {
  if (!isRecord(info)) {
    return Option.none()
  }
  const manual = trackKeys(info, 'subtitles').find((lang) => lang === 'en' || lang.startsWith('en-'))
  if (manual !== undefined) {
    return Option.some({ kind: 'manual', lang: manual })
  }
  const auto = trackKeys(info, 'automatic_captions')
  const lang = AUTO_LANG_PREFERENCE.find((preferred) => auto.includes(preferred))
  return lang === undefined ? Option.none() : Option.some({ kind: 'auto', lang })
}

// --- json3 parsing ---

type Json3Seg = {
  readonly utf8?: string
  readonly tOffsetMs?: number
}

type Json3Event = {
  readonly tStartMs: number
  readonly dDurationMs?: number
  readonly aAppend?: number
  readonly segs?: ReadonlyArray<Json3Seg>
}

const isOptionalNumber = (value: unknown): value is number | undefined =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value))

const isJson3Seg = (value: unknown): value is Json3Seg =>
  isRecord(value) && (value.utf8 === undefined || typeof value.utf8 === 'string') && isOptionalNumber(value.tOffsetMs)

const isJson3Event = (value: unknown): value is Json3Event =>
  isRecord(value) &&
  typeof value.tStartMs === 'number' &&
  Number.isFinite(value.tStartMs) &&
  isOptionalNumber(value.dDurationMs) &&
  isOptionalNumber(value.aAppend) &&
  (value.segs === undefined || (Array.isArray(value.segs) && value.segs.every(isJson3Seg)))

const decodeJson3Events = (json: unknown): Either.Either<ReadonlyArray<Json3Event>, CaptionSourceError> => {
  if (!isRecord(json) || !Array.isArray(json.events)) {
    return Either.left(new CaptionSourceError({ message: 'Malformed json3 captions: missing events array' }))
  }
  const events: unknown[] = json.events
  const invalid = events.findIndex((event) => !isJson3Event(event))
  return invalid >= 0
    ? Either.left(new CaptionSourceError({ message: `Malformed json3 captions: invalid event at index ${invalid}` }))
    : Either.right(events.filter(isJson3Event))
}

/** Bracketed sound descriptions such as "[Music]" or "[Applause]". */
const SOUND_MARKER = /\[[^\]]*\]/g
/** Tokens made only of music notes. */
const MUSIC_NOTES = /^[\u266A\u266B\u266C\u266F]+$/u

const tokenise = (text: string): ReadonlyArray<string> =>
  text
    .replaceAll(SOUND_MARKER, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !MUSIC_NOTES.test(token))

/** Spread `tokens` across [startMs, endMs] proportionally to their character length. */
const spreadWords = (tokens: ReadonlyArray<string>, startMs: number, endMs: number): ReadonlyArray<CaptionWord> => {
  const totalChars = tokens.reduce((sum, token) => sum + token.length, 0)
  const span = Math.max(0, endMs - startMs)
  let charsBefore = 0
  const starts = tokens.map((token) => {
    const start = startMs + Math.round((span * charsBefore) / totalChars)
    charsBefore += token.length
    return start
  })
  return tokens.map((text, i) => ({ text, startMs: starts[i] ?? startMs, endMs: starts[i + 1] ?? Math.max(startMs, endMs) }))
}

/** Words of one event: per-seg timing when any seg carries `tOffsetMs`, else the whole cue. */
const eventWords = (event: Json3Event): ReadonlyArray<CaptionWord> => {
  const segs = event.segs ?? []
  const eventStart = event.tStartMs
  const eventEnd = eventStart + (event.dDurationMs ?? 0)
  const wordLevel = segs.some((seg) => seg.tOffsetMs !== undefined)

  if (!wordLevel) {
    return spreadWords(tokenise(segs.map((seg) => seg.utf8 ?? '').join('')), eventStart, eventEnd)
  }
  const segStarts = segs.map((seg) => eventStart + (seg.tOffsetMs ?? 0))
  return segs.flatMap((seg, i) => {
    const start = segStarts[i] ?? eventStart
    const end = Math.max(start, segStarts[i + 1] ?? eventEnd)
    return spreadWords(tokenise(seg.utf8 ?? ''), start, end)
  })
}

const sameText = (a: CaptionWord, b: CaptionWord): boolean => a.text.toLowerCase() === b.text.toLowerCase()

/** Length of the longest leading run of `next` that equals the tail of `emitted`. */
const repeatedTailLength = (emitted: ReadonlyArray<CaptionWord>, next: ReadonlyArray<CaptionWord>): number => {
  for (let k = Math.min(emitted.length, next.length); k > 0; k--) {
    const tail = emitted.slice(emitted.length - k)
    if (
      tail.every((word, i) => {
        const candidate = next[i]
        return candidate !== undefined && sameText(word, candidate)
      })
    ) {
      return k
    }
  }
  return 0
}

/**
 * Turn a YouTube json3 caption file into timed words.
 *
 * - Word times come from `tOffsetMs` when an event has them (a word ends where the next seg starts,
 *   the last at the event end); otherwise the cue duration is split by character length.
 * - `aAppend` events, empty/whitespace/newline segs and sound markers ("[Music]", "♪") are dropped.
 * - Rolling auto-caption duplicates are collapsed: a word with the same text and start time as an
 *   emitted word is dropped, and when an event overlaps the previous word-emitting event, a leading
 *   run of words that repeats the tail of the emitted words is removed.
 */
export const parseJson3Captions = (json: unknown): Either.Either<ReadonlyArray<CaptionWord>, CaptionSourceError> =>
  Either.map(decodeJson3Events(json), (events) => {
    const emitted: CaptionWord[] = []
    const seen = new Set<string>()
    const key = (word: CaptionWord): string => `${word.startMs}|${word.text.toLowerCase()}`
    let previousEventEnd: number | null = null

    for (const event of events) {
      if (event.aAppend !== undefined && event.aAppend !== 0) {
        continue
      }

      let words = eventWords(event).filter((word) => !seen.has(key(word)))
      if (previousEventEnd !== null && event.tStartMs < previousEventEnd) {
        words = words.slice(repeatedTailLength(emitted, words))
      }
      if (words.length === 0) {
        continue
      }

      for (const word of words) {
        emitted.push(word)
        seen.add(key(word))
      }
      previousEventEnd = event.tStartMs + (event.dDurationMs ?? 0)
    }
    return emitted
  })
