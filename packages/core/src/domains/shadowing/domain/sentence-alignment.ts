import type { ShadowingSentence } from '@tx-agent-kit/contracts'
import { Either } from 'effect'
import type { CaptionWord } from './caption-transcript.js'
import { SentenceAlignmentError } from './shadowing-errors.js'

/** A sentence proposed by the LLM, mapped back onto the caption words it covers. */
export type AlignedSentence = Readonly<Pick<ShadowingSentence, 'text' | 'startMs' | 'endMs'>> & {
  /** Caption words of the sentence; `text` is the LLM tokens joined by single spaces. */
  readonly words: ReadonlyArray<CaptionWord>
}

/**
 * Normalise a token for comparison: NFKC, curly apostrophes → `'`, lower-case, and strip every
 * character that is not a letter, digit, combining mark or inner apostrophe.
 */
export const normaliseToken = (token: string): string =>
  token
    .normalize('NFKC')
    .replaceAll(/[\u2018\u2019\u02BC\uFF07]/g, "'")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}']/gu, '')
    .replaceAll(/^'+|'+$/g, '')

/** Whitespace tokens of a sentence. */
export const sentenceTokens = (text: string): ReadonlyArray<string> => text.split(/\s+/).filter((t) => t.length > 0)

/**
 * Map LLM sentences back onto caption words. The concatenated normalised tokens of `sentences`
 * must equal the normalised caption words exactly (tokens normalising to empty are ignored on both
 * sides); otherwise the first mismatch is reported.
 */
export const alignSentences = (
  words: ReadonlyArray<CaptionWord>,
  sentences: ReadonlyArray<string>
): Either.Either<ReadonlyArray<AlignedSentence>, SentenceAlignmentError> => {
  const captions = words
    .map((word, wordIndex) => ({ word, wordIndex, norm: normaliseToken(word.text) }))
    .filter((c) => c.norm.length > 0)

  const mismatch = (sentenceIndex: number, tokenIndex: number, cursor: number, actual: string | null) => {
    const caption = captions[cursor]
    const expected = caption?.norm ?? null
    return new SentenceAlignmentError({
      message: `Sentence ${sentenceIndex} token ${tokenIndex}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      sentenceIndex,
      tokenIndex,
      wordIndex: caption?.wordIndex ?? words.length,
      expected,
      actual
    })
  }

  const aligned: AlignedSentence[] = []
  let cursor = 0

  for (const [sentenceIndex, sentence] of sentences.entries()) {
    const tokens = sentenceTokens(sentence)
    const matched: CaptionWord[] = []

    for (const [tokenIndex, token] of tokens.entries()) {
      const norm = normaliseToken(token)
      if (norm.length === 0) {
        continue
      }
      const caption = captions[cursor]
      if (caption?.norm !== norm) {
        return Either.left(mismatch(sentenceIndex, tokenIndex, cursor, norm))
      }
      matched.push(caption.word)
      cursor++
    }

    const first = matched[0]
    const last = matched.at(-1)
    if (first === undefined || last === undefined) {
      return Either.left(mismatch(sentenceIndex, tokens.length, cursor, null))
    }
    aligned.push({ text: tokens.join(' '), startMs: first.startMs, endMs: last.endMs, words: matched })
  }

  if (cursor < captions.length) {
    const lastSentence = Math.max(0, sentences.length - 1)
    return Either.left(mismatch(lastSentence, sentenceTokens(sentences[lastSentence] ?? '').length, cursor, null))
  }
  return Either.right(aligned)
}
