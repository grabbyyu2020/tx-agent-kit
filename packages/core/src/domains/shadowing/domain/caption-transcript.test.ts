import { Either, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { parseJson3Captions, selectCaptionTrack, type CaptionWord } from './caption-transcript.js'

const fmt = [{ ext: 'json3', url: 'https://example.test/caption.json3' }]

describe('selectCaptionTrack', () => {
  it('prefers a manual English track over automatic captions [INV-SHADOW-003]', () => {
    const result = selectCaptionTrack({
      subtitles: { 'en-GB': fmt },
      automatic_captions: { 'en-orig': fmt, en: fmt }
    })
    expect(result).toEqual(Option.some({ kind: 'manual', lang: 'en-GB' }))
  })

  it('takes the first manual key that is en or starts with en- [INV-SHADOW-003]', () => {
    const result = selectCaptionTrack({
      subtitles: { fr: fmt, enm: fmt, 'en-US': fmt, en: fmt },
      automatic_captions: {}
    })
    expect(result).toEqual(Option.some({ kind: 'manual', lang: 'en-US' }))
  })

  it('ignores manual keys enm, eng and live_chat [INV-SHADOW-003]', () => {
    const result = selectCaptionTrack({
      subtitles: { live_chat: fmt, enm: fmt, eng: fmt },
      automatic_captions: { en: fmt }
    })
    expect(result).toEqual(Option.some({ kind: 'auto', lang: 'en' }))
  })

  it('ignores manual tracks with no formats [INV-SHADOW-003]', () => {
    const result = selectCaptionTrack({
      subtitles: { en: [] },
      automatic_captions: { en: fmt }
    })
    expect(result).toEqual(Option.some({ kind: 'auto', lang: 'en' }))
  })

  it('prefers automatic en-orig over en regardless of key order [INV-SHADOW-003]', () => {
    const result = selectCaptionTrack({
      subtitles: { de: fmt },
      automatic_captions: { en: fmt, fr: fmt, 'en-orig': fmt }
    })
    expect(result).toEqual(Option.some({ kind: 'auto', lang: 'en-orig' }))
  })

  it('does not accept other automatic English variants [INV-SHADOW-003]', () => {
    expect(selectCaptionTrack({ automatic_captions: { 'en-GB': fmt, 'en-US': fmt } })).toEqual(Option.none())
  })

  it('returns none when no English track exists [INV-SHADOW-003]', () => {
    expect(selectCaptionTrack({ subtitles: { fr: fmt }, automatic_captions: { de: fmt } })).toEqual(Option.none())
    expect(selectCaptionTrack({ subtitles: null, automatic_captions: null })).toEqual(Option.none())
    expect(selectCaptionTrack({})).toEqual(Option.none())
    expect(selectCaptionTrack('not an object')).toEqual(Option.none())
  })
})

const parse = (json: unknown): ReadonlyArray<CaptionWord> => {
  const result = parseJson3Captions(json)
  if (Either.isLeft(result)) {
    expect.fail(`expected Right, got ${result.left.message}`)
  }
  return result.right
}

const texts = (words: ReadonlyArray<CaptionWord>) => words.map((w) => w.text)

describe('parseJson3Captions', () => {
  it('uses word-level tOffsetMs; a word ends where the next starts, the last at the event end [INV-SHADOW-004]', () => {
    const words = parse({
      events: [
        {
          tStartMs: 1000,
          dDurationMs: 3000,
          segs: [{ utf8: 'so' }, { utf8: ' we', tOffsetMs: 400 }, { utf8: ' went', tOffsetMs: 900 }]
        }
      ]
    })
    expect(words).toEqual([
      { text: 'so', startMs: 1000, endMs: 1400 },
      { text: 'we', startMs: 1400, endMs: 1900 },
      { text: 'went', startMs: 1900, endMs: 4000 }
    ])
  })

  it('splits a cue without offsets across its words proportionally to character length [INV-SHADOW-004]', () => {
    const words = parse({
      events: [{ tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Hi there' }] }]
    })
    // "Hi" = 2 chars, "there" = 5 chars, 7 total → 2/7 of 1000 ms ≈ 286 ms.
    expect(words).toEqual([
      { text: 'Hi', startMs: 1000, endMs: 1286 },
      { text: 'there', startMs: 1286, endMs: 2000 }
    ])
  })

  it('joins multiple segs of an offset-less cue, including line breaks inside the text', () => {
    const words = parse({
      events: [{ tStartMs: 0, dDurationMs: 900, segs: [{ utf8: 'one\ntwo' }, { utf8: ' six' }] }]
    })
    expect(words).toEqual([
      { text: 'one', startMs: 0, endMs: 300 },
      { text: 'two', startMs: 300, endMs: 600 },
      { text: 'six', startMs: 600, endMs: 900 }
    ])
  })

  it('drops aAppend events, events without segs, newline and whitespace segs', () => {
    const words = parse({
      events: [
        { tStartMs: 0, dDurationMs: 10_000 },
        { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'hello' }, { utf8: '   ', tOffsetMs: 500 }, { utf8: ' world', tOffsetMs: 1000 }] },
        { tStartMs: 1500, dDurationMs: 500, aAppend: 1, segs: [{ utf8: '\n' }] },
        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: '\n' }] }
      ]
    })
    expect(words).toEqual([
      { text: 'hello', startMs: 0, endMs: 500 },
      { text: 'world', startMs: 1000, endMs: 2000 }
    ])
  })

  it('drops music and sound markers like [Music]', () => {
    const words = parse({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '[Music]' }] },
        { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '[Background noise] okay ♪' }] }
      ]
    })
    expect(words).toEqual([{ text: 'okay', startMs: 1000, endMs: 2000 }])
  })

  it('collapses a word repeated with the same start time', () => {
    const words = parse({
      events: [
        { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: 'okay' }] },
        { tStartMs: 5000, dDurationMs: 1500, segs: [{ utf8: 'okay' }] },
        { tStartMs: 7000, dDurationMs: 1000, segs: [{ utf8: 'okay' }] }
      ]
    })
    expect(words.map((w) => [w.text, w.startMs])).toEqual([
      ['okay', 5000],
      ['okay', 7000]
    ])
  })

  it('removes a rolling auto-caption repeat of the previous line when the events overlap', () => {
    const words = parse({
      events: [
        { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: 'hello' }, { utf8: ' world', tOffsetMs: 500 }] },
        {
          tStartMs: 3000,
          dDurationMs: 3000,
          segs: [{ utf8: 'Hello' }, { utf8: ' world', tOffsetMs: 300 }, { utf8: ' again', tOffsetMs: 600 }]
        }
      ]
    })
    expect(words).toEqual([
      { text: 'hello', startMs: 0, endMs: 500 },
      { text: 'world', startMs: 500, endMs: 4000 },
      { text: 'again', startMs: 3600, endMs: 6000 }
    ])
  })

  it('removes only the leading run that repeats the tail, not a partial non-tail match', () => {
    const words = parse({
      events: [
        { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: 'a b c' }] },
        { tStartMs: 3000, dDurationMs: 3000, segs: [{ utf8: 'b d' }] }
      ]
    })
    // "b" is not a repeat of the tail ("c"), so nothing is removed.
    expect(texts(words)).toEqual(['a', 'b', 'c', 'b', 'd'])
  })

  it('keeps a genuine repetition when the events do not overlap', () => {
    const words = parse({
      events: [
        { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: 'hello' }, { utf8: ' world', tOffsetMs: 500 }] },
        { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: 'hello' }, { utf8: ' world', tOffsetMs: 300 }, { utf8: ' again', tOffsetMs: 600 }] }
      ]
    })
    expect(texts(words)).toEqual(['hello', 'world', 'hello', 'world', 'again'])
  })

  it('returns no words for an empty event list', () => {
    expect(parse({ events: [] })).toEqual([])
  })

  it('rejects malformed json3', () => {
    expect(Either.isLeft(parseJson3Captions({ nope: true }))).toBe(true)
    expect(Either.isLeft(parseJson3Captions({ events: [{ tStartMs: 'zero', segs: [] }] }))).toBe(true)
    expect(Either.isLeft(parseJson3Captions(null))).toBe(true)
  })
})
