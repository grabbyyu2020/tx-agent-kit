/** OpenAI-style chat message. */
export type ShadowingChatMessagePayload = {
  readonly role: 'system' | 'user'
  readonly content: string
}

export const SEGMENTATION_SYSTEM_PROMPT = [
  'You split YouTube caption words into complete English sentences.',
  'You may only add punctuation and capitalisation.',
  'Never add, remove, reorder or change words: every caption word must appear exactly once, in the original order, spelled exactly as given.',
  'Reply with JSON only, in exactly this shape: {"sentences": ["First sentence.", "Second sentence."]}'
].join('\n')

export const EXPLANATION_SYSTEM_PROMPT = [
  'You help an English learner who is a native Chinese speaker practise shadowing a YouTube video.',
  'For each requested sentence of the transcript, explain it in Chinese with exactly three fields:',
  '- "meaning": a natural Chinese paraphrase of the whole sentence.',
  '- "keyExpressions": the phrases, idioms, slang and collocations from the sentence worth learning; each item has "expression" (quoted verbatim in English, exactly as it appears in the sentence) and "explanation" (in Chinese).',
  '- "toneAndContext": in Chinese, the tone, register and situation in which the sentence is used.',
  'Quote English expressions verbatim in English; write everything else in Chinese.',
  'Do not include grammar analysis, example sentences or pronunciation; no grammar analysis of any kind.',
  'Reply with JSON only, in exactly this shape:',
  '{"explanations": [{"sentenceIndex": 0, "meaning": "...", "keyExpressions": [{"expression": "...", "explanation": "..."}], "toneAndContext": "..."}]}'
].join('\n')

/** Messages asking the LLM to split caption words into sentences. */
export const buildSegmentationMessages = (input: {
  readonly title: string
  readonly words: ReadonlyArray<{ readonly text: string }>
}): ReadonlyArray<ShadowingChatMessagePayload> => [
  { role: 'system', content: SEGMENTATION_SYSTEM_PROMPT },
  { role: 'user', content: `Title: ${input.title}\n\nCaption words:\n${input.words.map((w) => w.text).join(' ')}` }
]

/**
 * Messages asking the LLM to explain `targetIndexes`. The system and transcript messages depend only
 * on the title and the full sentence list, so they are identical for every batch of one video
 * (prompt-cache friendly); only the final task message differs.
 */
export const buildExplanationMessages = (input: {
  readonly title: string
  readonly sentences: ReadonlyArray<string>
  readonly targetIndexes: ReadonlyArray<number>
}): ReadonlyArray<ShadowingChatMessagePayload> => {
  const transcript = input.sentences.map((sentence, i) => `[${i}] ${sentence}`).join('\n')
  const indexes = [...input.targetIndexes].sort((a, b) => a - b)
  const first = indexes[0]
  const last = indexes.at(-1)
  const range = first === undefined || last === undefined ? '' : `${first}..${last}`
  return [
    { role: 'system', content: EXPLANATION_SYSTEM_PROMPT },
    { role: 'user', content: `Title: ${input.title}\n\n${transcript}` },
    {
      role: 'user',
      content: `Explain sentences ${range}: [${indexes.join(', ')}]. Return exactly one explanation for each of these sentenceIndex values and no others.`
    }
  ]
}
