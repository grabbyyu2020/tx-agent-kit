import { describe, expect, it } from 'vitest'
import { buildExplanationMessages, buildSegmentationMessages } from './prompts.js'

const title = 'How to Make Coffee'
const sentences = ['Hi everyone.', "Today we're making coffee.", 'Let me show you.']

describe('buildExplanationMessages', () => {
  it('returns system, transcript and task messages [INV-SHADOW-008]', () => {
    const messages = buildExplanationMessages({ title, sentences, targetIndexes: [0, 1] })
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user'])
    expect(messages[1]!.content).toBe(
      "Title: How to Make Coffee\n\n[0] Hi everyone.\n[1] Today we're making coffee.\n[2] Let me show you."
    )
  })

  it('keeps system and transcript messages byte-identical across batches; only the task differs [INV-SHADOW-008]', () => {
    const a = buildExplanationMessages({ title, sentences, targetIndexes: [0, 1] })
    const b = buildExplanationMessages({ title, sentences, targetIndexes: [2] })
    expect(b.slice(0, 2)).toEqual(a.slice(0, 2))
    expect(b[2]!.content).not.toBe(a[2]!.content)
  })

  it('names exactly the requested indexes in the task message [INV-SHADOW-008]', () => {
    const task = buildExplanationMessages({ title, sentences, targetIndexes: [1, 2] })[2]!.content
    expect(task).toContain('1..2')
    expect(task).toContain('[1, 2]')
    expect(task).not.toContain('[0')
  })

  it('changes the transcript message when the sentence list changes [INV-SHADOW-008]', () => {
    const a = buildExplanationMessages({ title, sentences, targetIndexes: [0] })
    const b = buildExplanationMessages({ title, sentences: [...sentences.slice(0, 2), 'Let me show you!'], targetIndexes: [0] })
    expect(b[0]).toEqual(a[0])
    expect(b[1]).not.toEqual(a[1])
  })

  it('instructs Chinese output with English expressions quoted verbatim and the three fields [INV-SHADOW-010]', () => {
    const system = buildExplanationMessages({ title, sentences, targetIndexes: [0] })[0]!.content
    expect(system).toMatch(/native Chinese speaker/)
    expect(system).toMatch(/in Chinese/)
    expect(system).toMatch(/verbatim in English/)
    for (const field of ['meaning', 'keyExpressions', 'toneAndContext', 'sentenceIndex', 'expression', 'explanation']) {
      expect(system).toContain(`"${field}"`)
    }
    expect(system).toMatch(/no grammar analysis/i)
    expect(system).toMatch(/JSON only/)
  })
})

describe('buildSegmentationMessages', () => {
  it('asks for sentences without changing words and includes title and words', () => {
    const messages = buildSegmentationMessages({ title, words: [{ text: 'hi' }, { text: 'everyone' }, { text: "today" }] })
    expect(messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(messages[0]!.content).toMatch(/never add, remove, reorder or change/i)
    expect(messages[0]!.content).toContain('{"sentences"')
    expect(messages[1]!.content).toBe('Title: How to Make Coffee\n\nCaption words:\nhi everyone today')
  })
})
