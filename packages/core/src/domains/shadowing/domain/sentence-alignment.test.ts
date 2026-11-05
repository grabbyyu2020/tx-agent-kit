import { Either } from 'effect'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CaptionWord } from './caption-transcript.js'
import { alignSentences, normaliseToken } from './sentence-alignment.js'

const w = (text: string, startMs: number, endMs: number): CaptionWord => ({ text, startMs, endMs })

describe('normaliseToken', () => {
  it.each([
    ['Hello', 'hello'],
    ['"Hello!"', 'hello'],
    ["Don't,", "don't"],
    ['Don\u2019t', "don't"],
    ['rock\u2019n\u2019roll', "rock'n'roll"],
    ["'cause", 'cause'],
    ["dogs'", 'dogs'],
    ['U.S.', 'us'],
    ['\uFF21\uFF22\uFF23', 'abc'],
    ['\u2014', ''],
    ['...', ''],
    ['caf\u00E9', 'caf\u00E9'],
    ['cafe\u0301', 'caf\u00E9'],
    ['42%', '42']
  ])('normalises %j to %j [INV-SHADOW-004]', (input, expected) => {
    expect(normaliseToken(input)).toBe(expected)
  })
})

describe('alignSentences', () => {
  const words = [w('so', 0, 300), w('we', 300, 500), w('went', 500, 900), w('home', 1000, 1400), w('then', 2000, 2300), w('slept', 2300, 2900)]

  it('rebuilds sentences with LLM punctuation and timings from first/last word [INV-SHADOW-004]', () => {
    const result = alignSentences(words, ['So we went home.', 'Then, slept!'])
    expect(result).toEqual(
      Either.right([
        { text: 'So we went home.', startMs: 0, endMs: 1400, words: words.slice(0, 4) },
        { text: 'Then, slept!', startMs: 2000, endMs: 2900, words: words.slice(4) }
      ])
    )
  })

  it('drops tokens that normalise to empty on both sides [INV-SHADOW-004]', () => {
    const withDash = [w('so', 0, 100), w('\u2014', 100, 200), w('yes', 200, 300)]
    const result = alignSentences(withDash, ['So \u2014 \u2014 yes.'])
    expect(result).toEqual(
      Either.right([{ text: 'So \u2014 \u2014 yes.', startMs: 0, endMs: 300, words: [withDash[0], withDash[2]] }])
    )
  })

  it('collapses runs of whitespace in sentence text [INV-SHADOW-004]', () => {
    const result = alignSentences(words.slice(0, 2), ['  So\n we  '])
    expect(Either.map(result, (s) => s.map((x) => x.text))).toEqual(Either.right(['So we']))
  })

  it('reports the first mismatch position [INV-SHADOW-004]', () => {
    const result = alignSentences(words, ['So we went home.', 'Than slept.'])
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('SentenceAlignmentError')
      expect(result.left).toMatchObject({ sentenceIndex: 1, tokenIndex: 0, wordIndex: 4, expected: 'then', actual: 'than' })
    }
  })

  it('rejects a dropped word at the end [INV-SHADOW-004]', () => {
    const result = alignSentences(words, ['So we went home.', 'Then.'])
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ wordIndex: 5, expected: 'slept', actual: null })
    }
  })

  it('rejects an extra word at the end [INV-SHADOW-004]', () => {
    const result = alignSentences(words, ['So we went home.', 'Then slept well.'])
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ sentenceIndex: 1, tokenIndex: 2, wordIndex: 6, expected: null, actual: 'well' })
    }
  })

  it('rejects a sentence with no words [INV-SHADOW-004]', () => {
    expect(Either.isLeft(alignSentences(words, ['So we went home.', '\u2014', 'Then slept.']))).toBe(true)
  })

  it('aligns empty input to no sentences, and rejects words without sentences [INV-SHADOW-004]', () => {
    expect(alignSentences([], [])).toEqual(Either.right([]))
    expect(Either.isLeft(alignSentences(words, []))).toBe(true)
  })

  // --- Property-based ---

  const vocabulary = ['i', 'you', 'we', "don't", 'know', 'go', 'home', 'it', "it's", 'fine', 'rock', 'well', 'yes', 'no', 'café']

  // Caption words with increasing timings, plus cut points that split them into sentences.
  const scenario = fc
    .array(fc.tuple(fc.constantFrom(...vocabulary), fc.integer({ min: 0, max: 400 }), fc.integer({ min: 1, max: 600 })), {
      minLength: 1,
      maxLength: 40
    })
    .chain((raw) => {
      let t = 0
      const captionWords = raw.map(([text, gap, dur]) => {
        const startMs = t + gap
        t = startMs + dur
        return w(text, startMs, t)
      })
      return fc.record({
        captionWords: fc.constant(captionWords),
        cuts: fc.uniqueArray(fc.integer({ min: 1, max: Math.max(1, captionWords.length - 1) }), {
          maxLength: captionWords.length - 1
        }),
        decorations: fc.array(
          fc.record({
            upper: fc.boolean(),
            prefix: fc.constantFrom('', '"', '\u201C', '('),
            suffix: fc.constantFrom('', ',', '.', '?', '!', '...', '"', ')'),
            dashAfter: fc.boolean()
          }),
          { minLength: captionWords.length, maxLength: captionWords.length }
        )
      })
    })

  type Scenario = { captionWords: CaptionWord[]; cuts: number[]; decorations: { upper: boolean; prefix: string; suffix: string; dashAfter: boolean }[] }

  const bounds = (s: Scenario): number[] => [0, ...[...s.cuts].filter((c) => c < s.captionWords.length).sort((a, b) => a - b), s.captionWords.length]

  // Sentences as token arrays (decorated the way an LLM would), one per cut range.
  const decoratedSentences = (s: Scenario): string[][] => {
    const b = bounds(s)
    return b.slice(0, -1).map((start, i) =>
      s.captionWords.slice(start, b[i + 1]).flatMap((word, k) => {
        const d = s.decorations[start + k]!
        const base = d.upper ? word.text.toUpperCase() : word.text
        const token = `${d.prefix}${base.replace("'", '\u2019')}${d.suffix}`
        return d.dashAfter ? [token, '\u2014'] : [token]
      })
    )
  }

  it('aligns any punctuation/case decoration of the caption words, with exact timings [INV-SHADOW-004]', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const sentences = decoratedSentences(s).map((tokens) => tokens.join(' '))
        const result = alignSentences(s.captionWords, sentences)
        expect(Either.isRight(result)).toBe(true)
        if (Either.isLeft(result)) {
          return
        }
        const aligned = result.right
        expect(aligned.map((a) => a.text)).toEqual(sentences)
        expect(aligned.flatMap((a) => a.words)).toEqual(s.captionWords)
        const b = bounds(s)
        aligned.forEach((a, i) => {
          expect(a.startMs).toBe(s.captionWords[b[i]!]!.startMs)
          expect(a.endMs).toBe(s.captionWords[b[i + 1]! - 1]!.endMs)
        })
      })
    )
  })

  const mutated = (mutate: (tokens: string[], s: Scenario) => string[] | null) =>
    fc.property(scenario, fc.nat(), (s, seed) => {
      const sentences = decoratedSentences(s)
      const target = seed % sentences.length
      const changed = mutate([...sentences[target]!], s)
      fc.pre(changed !== null)
      const next = sentences.map((tokens, i) => (i === target ? changed : tokens).join(' '))
      expect(Either.isLeft(alignSentences(s.captionWords, next))).toBe(true)
    })

  it('rejects any inserted token [INV-SHADOW-004]', () => {
    fc.assert(
      mutated((tokens) => {
        tokens.splice(Math.floor(tokens.length / 2), 0, 'extra')
        return tokens
      })
    )
  })

  it('rejects any dropped token [INV-SHADOW-004]', () => {
    fc.assert(
      mutated((tokens) => {
        const idx = tokens.findIndex((t) => normaliseToken(t) !== '')
        tokens.splice(idx, 1)
        return tokens
      })
    )
  })

  it('rejects any swap of two different adjacent tokens [INV-SHADOW-004]', () => {
    fc.assert(
      mutated((tokens) => {
        const real = tokens.map((t, i): [string, number] => [normaliseToken(t), i]).filter(([n]) => n !== '')
        const pair = real.findIndex(([n], k) => k + 1 < real.length && real[k + 1]![0] !== n)
        if (pair < 0) {
          return null
        }
        const i = real[pair]![1]
        const j = real[pair + 1]![1]
        const tmp = tokens[i]!
        tokens[i] = tokens[j]!
        tokens[j] = tmp
        return tokens
      })
    )
  })

  it('rejects any changed token [INV-SHADOW-004]', () => {
    fc.assert(
      mutated((tokens) => {
        const idx = tokens.findIndex((t) => normaliseToken(t) !== '')
        tokens[idx] = `${tokens[idx]}s`
        return tokens
      })
    )
  })
})
