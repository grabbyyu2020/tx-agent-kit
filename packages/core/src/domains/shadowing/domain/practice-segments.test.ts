import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CaptionWord } from './caption-transcript.js'
import { compromiseClauseSplitter, splitIntoPracticeSegments, type PracticeSegment } from './practice-segments.js'
import type { AlignedSentence } from './sentence-alignment.js'

/** Build a sentence from tokens; `gaps[i]` is the pause before word i (default 0), every word lasts 100 ms. */
const sentence = (text: string, gaps: ReadonlyArray<number> = []): AlignedSentence => {
  const tokens = text.split(' ')
  let t = 0
  const words: CaptionWord[] = tokens.map((token, i) => {
    const startMs = t + (i === 0 ? 0 : (gaps[i] ?? 0))
    t = startMs + 100
    return { text: token.replaceAll(/[^\w']/g, '').toLowerCase(), startMs, endMs: t }
  })
  return { text, startMs: words[0]!.startMs, endMs: words.at(-1)!.endMs, words }
}

const noClauses = (text: string): string[] => [text]
const ranges = (segments: ReadonlyArray<PracticeSegment>) => segments.map((s) => [s.wordStart, s.wordEnd])

describe('splitIntoPracticeSegments', () => {
  it('keeps a sentence exactly at both limits whole [INV-SHADOW-005]', () => {
    const s = sentence('one two three four')
    const segments = splitIntoPracticeSegments(s, { maxWords: 4, maxMs: 400 }, noClauses)
    expect(segments).toEqual([{ text: 'one two three four', startMs: 0, endMs: 400, wordStart: 0, wordEnd: 4 }])
  })

  it('splits a sentence one word over the word limit [INV-SHADOW-005]', () => {
    const s = sentence('one two three four', [0, 0, 50, 0])
    expect(ranges(splitIntoPracticeSegments(s, { maxWords: 3, maxMs: 10_000 }, noClauses))).toEqual([
      [0, 2],
      [2, 4]
    ])
  })

  it('splits a sentence one millisecond over the duration limit [INV-SHADOW-005]', () => {
    const s = sentence('one two three', [0, 1, 0])
    // Duration 301 ms with the only positive gap before "two".
    expect(ranges(splitIntoPracticeSegments(s, { maxWords: 10, maxMs: 300 }, noClauses))).toEqual([
      [0, 1],
      [1, 3]
    ])
  })

  it('packs consecutive clauses greedily within the limits [INV-SHADOW-005]', () => {
    const s = sentence('a b, c d, e f g h')
    const segments = splitIntoPracticeSegments(s, { maxWords: 4, maxMs: 10_000 }, () => ['a b,', 'c d,', 'e f g h'])
    expect(segments).toEqual([
      { text: 'a b, c d,', startMs: 0, endMs: 400, wordStart: 0, wordEnd: 4 },
      { text: 'e f g h', startMs: 400, endMs: 800, wordStart: 4, wordEnd: 8 }
    ])
  })

  it('starts a new segment at the clause that would exceed the limit [INV-SHADOW-005]', () => {
    const s = sentence('a b c, d e, f')
    expect(ranges(splitIntoPracticeSegments(s, { maxWords: 4, maxMs: 10_000 }, () => ['a b c,', 'd e,', 'f']))).toEqual([
      [0, 3],
      [3, 6]
    ])
  })

  it('splits an over-long clause at the largest timing gap, recursively [INV-SHADOW-005]', () => {
    //                      a  b   c  d  e    f  g  h
    const s = sentence('a b c d e f g h', [0, 10, 0, 30, 0, 200, 0, 20])
    const segments = splitIntoPracticeSegments(s, { maxWords: 3, maxMs: 10_000 }, noClauses)
    // Largest gap before "f" → [a..e] [f g h]; [a..e] splits at the gap before "d" → [a b c] [d e].
    expect(ranges(segments)).toEqual([
      [0, 3],
      [3, 5],
      [5, 8]
    ])
    expect(segments.map((x) => x.text)).toEqual(['a b c', 'd e', 'f g h'])
  })

  it('keeps an over-limit part whole when no positive gap exists [INV-SHADOW-005]', () => {
    const s = sentence('a b c d e')
    expect(ranges(splitIntoPracticeSegments(s, { maxWords: 2, maxMs: 100 }, noClauses))).toEqual([[0, 5]])
  })

  it('uses clauses before gaps even when a larger gap exists elsewhere [INV-SHADOW-005]', () => {
    const s = sentence('a b, c d', [0, 500, 0, 0])
    expect(ranges(splitIntoPracticeSegments(s, { maxWords: 3, maxMs: 10_000 }, () => ['a b,', 'c d']))).toEqual([
      [0, 2],
      [2, 4]
    ])
  })

  it('attaches tokens with no caption word to the preceding word [INV-SHADOW-005]', () => {
    const base = sentence('well we tried and failed', [0, 0, 0, 300, 0])
    const s: AlignedSentence = { ...base, text: '\u2014 Well we tried \u2014 and failed.' }
    const segments = splitIntoPracticeSegments(s, { maxWords: 3, maxMs: 10_000 }, noClauses)
    expect(segments.map((x) => x.text)).toEqual(['\u2014 Well we tried \u2014', 'and failed.'])
  })

  it('still covers every word when the clause splitter rewrites the text [INV-SHADOW-005]', () => {
    const s = sentence('a b c d e f', [0, 0, 0, 50, 0, 0])
    const segments = splitIntoPracticeSegments(s, { maxWords: 3, maxMs: 10_000 }, () => ['totally', 'different text here and more words than exist'])
    expect(ranges(segments)).toEqual([
      [0, 3],
      [3, 6]
    ])
  })

  it('is deterministic for the same sentence and timings [INV-SHADOW-006]', () => {
    const s = sentence('So we went to the store, and then we came home', [0, 40, 0, 0, 90, 0, 300, 0, 0, 10, 0])
    const limits = { maxWords: 4, maxMs: 700 }
    const first = splitIntoPracticeSegments(s, limits, compromiseClauseSplitter)
    const second = splitIntoPracticeSegments(s, limits, compromiseClauseSplitter)
    expect(second).toEqual(first)
    expect(first.length).toBeGreaterThan(1)
  })

  // --- Property-based ---

  const arbitrarySentence = fc
    .array(fc.tuple(fc.constantFrom('a', 'bb', 'ccc', 'dog,', 'cat.'), fc.constantFrom(0, 0, 0, 1, 20, 150, 600), fc.integer({ min: 1, max: 400 })), {
      minLength: 1,
      maxLength: 60
    })
    .map((raw) => {
      let t = 0
      const words: CaptionWord[] = raw.map(([token, gap, dur], i) => {
        const startMs = t + (i === 0 ? 0 : gap)
        t = startMs + dur
        return { text: token.replaceAll(/[,.]/g, ''), startMs, endMs: t }
      })
      const text = raw.map(([token]) => token).join(' ')
      return { text, startMs: words[0]!.startMs, endMs: words.at(-1)!.endMs, words } satisfies AlignedSentence
    })

  // A clause splitter that cuts the token list at given positions.
  const splitterArb = fc.uniqueArray(fc.integer({ min: 1, max: 59 }), { maxLength: 10 }).map(
    (cuts) =>
      (text: string): string[] => {
        const tokens = text.split(' ')
        const points = [0, ...cuts.filter((c) => c < tokens.length).sort((a, b) => a - b), tokens.length]
        return points.slice(0, -1).map((p, i) => tokens.slice(p, points[i + 1]).join(' '))
      }
  )

  const limitsArb = fc.record({ maxWords: fc.integer({ min: 1, max: 30 }), maxMs: fc.integer({ min: 100, max: 9000 }) })

  it('covers all words in order with no overlap, and respects limits unless no positive gap allows a split [INV-SHADOW-005]', () => {
    fc.assert(
      fc.property(arbitrarySentence, limitsArb, splitterArb, (s, limits, splitter) => {
        const segments = splitIntoPracticeSegments(s, limits, splitter)
        expect(segments.length).toBeGreaterThanOrEqual(1)
        expect(segments[0]!.wordStart).toBe(0)
        expect(segments.at(-1)!.wordEnd).toBe(s.words.length)
        segments.forEach((seg, i) => {
          expect(seg.wordEnd).toBeGreaterThan(seg.wordStart)
          if (i > 0) {
            expect(seg.wordStart).toBe(segments[i - 1]!.wordEnd)
          }
          expect(seg.startMs).toBe(s.words[seg.wordStart]!.startMs)
          expect(seg.endMs).toBe(s.words[seg.wordEnd - 1]!.endMs)
          const within = seg.wordEnd - seg.wordStart <= limits.maxWords && seg.endMs - seg.startMs <= limits.maxMs
          if (!within) {
            for (let k = seg.wordStart + 1; k < seg.wordEnd; k++) {
              expect(s.words[k]!.startMs - s.words[k - 1]!.endMs).toBeLessThanOrEqual(0)
            }
          }
        })
        expect(segments.map((seg) => seg.text).join(' ')).toBe(s.text)
      })
    )
  })

  it('never splits a sentence that is within the limits [INV-SHADOW-005]', () => {
    fc.assert(
      fc.property(arbitrarySentence, splitterArb, (s, splitter) => {
        const limits = { maxWords: s.words.length, maxMs: s.endMs - s.startMs }
        expect(ranges(splitIntoPracticeSegments(s, limits, splitter))).toEqual([[0, s.words.length]])
      })
    )
  })

  it('returns the same segments on every run [INV-SHADOW-006]', () => {
    fc.assert(
      fc.property(arbitrarySentence, limitsArb, splitterArb, (s, limits, splitter) => {
        expect(splitIntoPracticeSegments(s, limits, splitter)).toEqual(splitIntoPracticeSegments(s, limits, splitter))
      })
    )
  })
})

describe('compromiseClauseSplitter', () => {
  it('splits at clause punctuation and preserves every word [INV-SHADOW-005]', () => {
    const text = 'So we went to the store, and then, because it was raining, we bought umbrellas'
    const clauses = compromiseClauseSplitter(text)
    expect(clauses.length).toBeGreaterThan(1)
    expect(clauses.join(' ').split(/\s+/)).toEqual(text.split(' '))
  })
})
