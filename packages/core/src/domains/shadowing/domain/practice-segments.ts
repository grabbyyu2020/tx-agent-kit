import type { ShadowingSegment } from '@tx-agent-kit/contracts'
import { normaliseToken, sentenceTokens, type AlignedSentence } from './sentence-alignment.js'

export type PracticeSegmentLimitsConfig = {
  readonly maxWords: number
  readonly maxMs: number
}

/** A playable slice of one sentence. `wordStart` is inclusive, `wordEnd` exclusive (slice semantics). */
export type PracticeSegment = Readonly<Pick<ShadowingSegment, 'text' | 'startMs' | 'endMs'>> & {
  readonly wordStart: number
  readonly wordEnd: number
}

/** Splits sentence text into clause strings whose concatenated tokens are the sentence tokens. */
export type ClauseSplitter = (text: string) => ReadonlyArray<string>

type Range = readonly [start: number, end: number]

const wordTokenCount = (text: string): number =>
  sentenceTokens(text).filter((token) => normaliseToken(token).length > 0).length

/**
 * Split a sentence into practice segments. A sentence within `limits` stays whole. Otherwise clauses
 * from `clauseSplitter` are packed greedily within the limits; any part still over a limit is split
 * at the largest positive pause between consecutive words, recursively; with no positive pause it
 * stays whole. Segments cover every word in order without overlap and never cut a word.
 */
export const splitIntoPracticeSegments = (
  sentence: AlignedSentence,
  limits: PracticeSegmentLimitsConfig,
  clauseSplitter: ClauseSplitter
): ReadonlyArray<PracticeSegment> => {
  const { words } = sentence
  const n = words.length
  if (n === 0) {
    return []
  }

  const startOf = (i: number): number => words[i]?.startMs ?? 0
  const endOf = (i: number): number => words[i]?.endMs ?? 0
  const within = ([a, b]: Range): boolean => b - a <= limits.maxWords && endOf(b - 1) - startOf(a) <= limits.maxMs

  // Map each sentence token to the caption word it belongs to; tokens with no word (e.g. "—")
  // attach to the preceding word. Fall back to caption text if the sentence does not align.
  const rawTokens = sentenceTokens(sentence.text)
  const aligned = rawTokens.filter((token) => normaliseToken(token).length > 0).length === n
  const tokens = aligned ? rawTokens : words.map((word) => word.text)
  let wordIndex = 0
  const owners = tokens.map((token) => {
    if (aligned && normaliseToken(token).length === 0) {
      return Math.max(0, wordIndex - 1)
    }
    return wordIndex++
  })

  const toSegment = ([a, b]: Range): PracticeSegment => ({
    text: tokens.filter((_, i) => (owners[i] ?? 0) >= a && (owners[i] ?? 0) < b).join(' '),
    startMs: startOf(a),
    endMs: endOf(b - 1),
    wordStart: a,
    wordEnd: b
  })

  if (within([0, n])) {
    return [toSegment([0, n])]
  }

  const splitAtGaps = (range: Range): ReadonlyArray<Range> => {
    if (within(range)) {
      return [range]
    }
    const [a, b] = range
    let best = -1
    let bestGap = 0
    for (let i = a + 1; i < b; i++) {
      const gap = startOf(i) - endOf(i - 1)
      if (gap > bestGap) {
        best = i
        bestGap = gap
      }
    }
    return best < 0 ? [range] : [...splitAtGaps([a, best]), ...splitAtGaps([best, b])]
  }

  // Clause ranges by token count; ignore the clauses if they do not account for every word.
  const counts = clauseSplitter(sentence.text).map(wordTokenCount)
  const clauseRanges: Range[] = []
  if (counts.reduce((sum, c) => sum + c, 0) === n) {
    let start = 0
    for (const count of counts) {
      if (count > 0) {
        clauseRanges.push([start, start + count])
        start += count
      }
    }
  } else {
    clauseRanges.push([0, n])
  }

  // Greedily pack consecutive clauses while the packed range stays within the limits.
  const packed: Range[] = []
  for (const clause of clauseRanges) {
    const current = packed.at(-1)
    if (current !== undefined && within([current[0], clause[1]])) {
      packed[packed.length - 1] = [current[0], clause[1]]
    } else {
      packed.push(clause)
    }
  }

  return packed.flatMap(splitAtGaps).map(toSegment)
}
