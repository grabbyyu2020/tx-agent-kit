import { SHADOWING_EXPLANATION_BATCH_SIZE } from '@tx-agent-kit/contracts'
import { Either } from 'effect'
import { describe, expect, it } from 'vitest'
import { batchIndexOf, decodeExplanationBatch } from './explanation.js'

const expected = [
  { sentenceIndex: 20, text: "I'm gonna  call it a day." },
  { sentenceIndex: 21, text: 'That was a piece of cake!' }
]

const item = (sentenceIndex: number, overrides: Record<string, unknown> = {}) => ({
  sentenceIndex,
  meaning: '意思',
  keyExpressions: sentenceIndex === 20 ? [{ expression: 'Call it a day', explanation: '收工' }] : [],
  toneAndContext: '口语',
  ...overrides
})

const decode = (json: unknown) => decodeExplanationBatch(json, expected)

const leftReason = (json: unknown): string | undefined => {
  const result = decode(json)
  return Either.isLeft(result) ? result.left.reason : undefined
}

describe('batchIndexOf', () => {
  it('groups sentence indexes by the batch size', () => {
    expect(SHADOWING_EXPLANATION_BATCH_SIZE).toBe(20)
    expect(batchIndexOf(0)).toBe(0)
    expect(batchIndexOf(19)).toBe(0)
    expect(batchIndexOf(20)).toBe(1)
    expect(batchIndexOf(41)).toBe(2)
  })
})

describe('decodeExplanationBatch', () => {
  it('decodes exactly the three explanation fields keyed by sentence index [INV-SHADOW-009]', () => {
    const result = decode({ explanations: [item(21), item(20)] })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect([...result.right.keys()].sort()).toEqual([20, 21])
      expect(result.right.get(20)).toEqual({
        meaning: '意思',
        keyExpressions: [{ expression: 'Call it a day', explanation: '收工' }],
        toneAndContext: '口语'
      })
    }
  })

  it('accepts a JSON string [INV-SHADOW-009]', () => {
    expect(Either.isRight(decode(JSON.stringify({ explanations: [item(20), item(21)] })))).toBe(true)
  })

  it('rejects an extra field on an explanation [INV-SHADOW-009]', () => {
    expect(leftReason({ explanations: [item(20, { grammar: '语法' }), item(21)] })).toBe('schema')
  })

  it('rejects an extra field on a key expression [INV-SHADOW-009]', () => {
    const keyExpressions = [{ expression: 'call it a day', explanation: '收工', example: 'x' }]
    expect(leftReason({ explanations: [item(20, { keyExpressions }), item(21)] })).toBe('schema')
  })

  it('rejects a missing field [INV-SHADOW-009]', () => {
    const { toneAndContext: _omit, ...withoutTone } = item(21)
    expect(leftReason({ explanations: [item(20), withoutTone] })).toBe('schema')
  })

  it('rejects empty meaning or toneAndContext [INV-SHADOW-009]', () => {
    expect(leftReason({ explanations: [item(20, { meaning: '  ' }), item(21)] })).toBe('schema')
    expect(leftReason({ explanations: [item(20), item(21, { toneAndContext: '' })] })).toBe('schema')
  })

  it('rejects malformed JSON and non-object input [INV-SHADOW-009]', () => {
    expect(leftReason('{not json')).toBe('schema')
    expect(leftReason(null)).toBe('schema')
    expect(leftReason([item(20), item(21)])).toBe('schema')
  })

  it('rejects a missing sentence index [INV-SHADOW-009]', () => {
    expect(leftReason({ explanations: [item(20)] })).toBe('index_mismatch')
  })

  it('rejects an unexpected sentence index [INV-SHADOW-009]', () => {
    expect(leftReason({ explanations: [item(20), item(21), item(22)] })).toBe('index_mismatch')
    expect(leftReason({ explanations: [item(20), item(22)] })).toBe('index_mismatch')
  })

  it('rejects a duplicated sentence index [INV-SHADOW-009]', () => {
    expect(leftReason({ explanations: [item(20), item(20)] })).toBe('index_mismatch')
    expect(leftReason({ explanations: [item(20), item(21), item(21)] })).toBe('index_mismatch')
  })

  it('matches key expressions case-insensitively with normalised whitespace [INV-SHADOW-010]', () => {
    const keyExpressions = [{ expression: "I'M GONNA call", explanation: '我要' }]
    expect(Either.isRight(decode({ explanations: [item(20, { keyExpressions }), item(21)] }))).toBe(true)
  })

  it('rejects a key expression that is not in the sentence [INV-SHADOW-010]', () => {
    const keyExpressions = [{ expression: 'piece of cake', explanation: '小菜一碟' }]
    const result = decode({ explanations: [item(20, { keyExpressions }), item(21)] })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ reason: 'expression_not_in_sentence', sentenceIndex: 20 })
    }
  })

  it('rejects an empty key expression [INV-SHADOW-010]', () => {
    const keyExpressions = [{ expression: ' ', explanation: '空' }]
    expect(leftReason({ explanations: [item(20, { keyExpressions }), item(21)] })).toBe('schema')
  })
})
