import {
  SHADOWING_EXPLANATION_BATCH_SIZE,
  type ShadowingExplanation,
  type ShadowingKeyExpression
} from '@tx-agent-kit/contracts'
import { Either } from 'effect'
import { ExplanationDecodeError } from './shadowing-errors.js'

export type { ShadowingExplanation }

/** The batch a sentence's explanation is generated in. */
export const batchIndexOf = (sentenceIndex: number): number => Math.floor(sentenceIndex / SHADOWING_EXPLANATION_BATCH_SIZE)

export type ExplanationTargetInput = {
  readonly sentenceIndex: number
  readonly text: string
}

type IndexedExplanation = ShadowingExplanation & { readonly sentenceIndex: number }

// --- Strict structural decoding (the domain layer may not use effect/Schema) ---

type Decoded<A> = Either.Either<A, string>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Require an object with exactly `keys` (no missing, no extra). */
const exactObject = (value: unknown, keys: ReadonlyArray<string>, path: string): Decoded<Record<string, unknown>> => {
  if (!isRecord(value)) {
    return Either.left(`${path}: expected an object`)
  }
  const missing = keys.filter((key) => !(key in value))
  const extra = Object.keys(value).filter((key) => !keys.includes(key))
  if (missing.length > 0) {
    return Either.left(`${path}: missing ${missing.join(', ')}`)
  }
  if (extra.length > 0) {
    return Either.left(`${path}: unexpected ${extra.join(', ')}`)
  }
  return Either.right(value)
}

const nonBlankString = (value: unknown, path: string): Decoded<string> =>
  typeof value === 'string' && value.trim().length > 0 ? Either.right(value) : Either.left(`${path}: expected a non-empty string`)

const array = (value: unknown, path: string): Decoded<ReadonlyArray<unknown>> =>
  Array.isArray(value) ? Either.right(value) : Either.left(`${path}: expected an array`)

const all = <A>(items: ReadonlyArray<unknown>, decode: (item: unknown, index: number) => Decoded<A>): Decoded<ReadonlyArray<A>> =>
  Either.all(items.map(decode))

const decodeKeyExpression = (value: unknown, path: string): Decoded<ShadowingKeyExpression> =>
  Either.flatMap(exactObject(value, ['expression', 'explanation'], path), (o) =>
    Either.all({
      expression: nonBlankString(o.expression, `${path}.expression`),
      explanation: nonBlankString(o.explanation, `${path}.explanation`)
    })
  )

const decodeExplanation = (value: unknown, path: string): Decoded<IndexedExplanation> =>
  Either.flatMap(exactObject(value, ['sentenceIndex', 'meaning', 'keyExpressions', 'toneAndContext'], path), (o) =>
    Either.all({
      sentenceIndex:
        typeof o.sentenceIndex === 'number' && Number.isInteger(o.sentenceIndex) && o.sentenceIndex >= 0
          ? Either.right(o.sentenceIndex)
          : Either.left(`${path}.sentenceIndex: expected a non-negative integer`),
      meaning: nonBlankString(o.meaning, `${path}.meaning`),
      keyExpressions: Either.flatMap(array(o.keyExpressions, `${path}.keyExpressions`), (items) =>
        all(items, (item, i) => decodeKeyExpression(item, `${path}.keyExpressions[${i}]`))
      ),
      toneAndContext: nonBlankString(o.toneAndContext, `${path}.toneAndContext`)
    })
  )

const parseJsonText = (text: string): Decoded<unknown> =>
  Either.try({
    try: (): unknown => JSON.parse(text),
    catch: () => 'invalid JSON'
  })

const decodeBatch = (json: unknown): Decoded<ReadonlyArray<IndexedExplanation>> =>
  Either.flatMap(typeof json === 'string' ? parseJsonText(json) : Either.right(json), (value) =>
    Either.flatMap(exactObject(value, ['explanations'], '$'), (o) =>
      Either.flatMap(array(o.explanations, '$.explanations'), (items) =>
        all(items, (item, i) => decodeExplanation(item, `$.explanations[${i}]`))
      )
    )
  )

// --- Batch rules ---

const normaliseForMatch = (s: string): string =>
  s.normalize('NFKC').replaceAll(/[\u2018\u2019]/g, "'").replaceAll(/\s+/g, ' ').trim().toLowerCase()

const sortedIndexes = (indexes: ReadonlyArray<number>): string => `[${[...indexes].sort((a, b) => a - b).join(', ')}]`

/**
 * Decode one LLM explanation batch `{ explanations: [{ sentenceIndex, meaning, keyExpressions,
 * toneAndContext }] }`. Objects must have exactly these fields (key expressions exactly
 * `expression` + `explanation`), strings must be non-empty, the index set must equal the expected
 * indexes exactly, and every key expression must occur in its sentence (case-insensitive,
 * whitespace-normalised). `json` may be a parsed value or a JSON string.
 */
export const decodeExplanationBatch = (
  json: unknown,
  expected: ReadonlyArray<ExplanationTargetInput>
): Either.Either<ReadonlyMap<number, ShadowingExplanation>, ExplanationDecodeError> => {
  const decoded = decodeBatch(json)
  if (Either.isLeft(decoded)) {
    return Either.left(new ExplanationDecodeError({ reason: 'schema', message: decoded.left }))
  }

  const explanations = decoded.right
  const expectedText = new Map(expected.map((s) => [s.sentenceIndex, s.text]))
  const received = explanations.map((e) => e.sentenceIndex)
  const indexSetMatches =
    received.length === expectedText.size &&
    new Set(received).size === received.length &&
    received.every((index) => expectedText.has(index))
  if (!indexSetMatches) {
    return Either.left(
      new ExplanationDecodeError({
        reason: 'index_mismatch',
        message: `Expected sentence indexes ${sortedIndexes([...expectedText.keys()])}, got ${sortedIndexes(received)}`
      })
    )
  }

  const result = new Map<number, ShadowingExplanation>()
  for (const { sentenceIndex, meaning, keyExpressions, toneAndContext } of explanations) {
    const sentence = normaliseForMatch(expectedText.get(sentenceIndex) ?? '')
    const missing = keyExpressions.find((k) => !sentence.includes(normaliseForMatch(k.expression)))
    if (missing !== undefined) {
      return Either.left(
        new ExplanationDecodeError({
          reason: 'expression_not_in_sentence',
          message: `Key expression ${JSON.stringify(missing.expression)} does not appear in sentence ${sentenceIndex}`,
          sentenceIndex
        })
      )
    }
    result.set(sentenceIndex, { meaning, keyExpressions, toneAndContext })
  }
  return Either.right(result)
}
