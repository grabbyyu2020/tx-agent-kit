// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShadowingGetVideo200SentencesItem } from '@/lib/api/generated/schemas'
import { SentenceList } from './SentenceList'

const makeSentence = (
  sentenceIndex: number,
  overrides: Partial<ShadowingGetVideo200SentencesItem> = {}
): ShadowingGetVideo200SentencesItem => ({
  id: `00000000-0000-4000-8000-00000000000${sentenceIndex}`,
  sentenceIndex,
  batchIndex: 0,
  text: `Sentence number ${sentenceIndex}.`,
  startMs: sentenceIndex * 1000,
  endMs: sentenceIndex * 1000 + 900,
  explanationStatus: 'ready',
  explanation: {
    meaning: '这是第几句。',
    keyExpressions: [{ expression: 'number', explanation: '编号' }],
    toneAndContext: '中性陈述。'
  },
  ...overrides
})

afterEach(() => {
  cleanup()
})

describe('SentenceList', () => {
  it('marks the current sentence, selects on click and collapses', () => {
    const onSelect = vi.fn<(sentenceIndex: number) => void>()
    render(
      <SentenceList
        sentences={[makeSentence(0), makeSentence(1)]}
        currentSentenceIndex={1}
        onSelect={onSelect}
      />
    )

    const current = screen.getByRole('button', { name: /Sentence number 1\./ })
    expect(current.getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Sentence number 0\./ }))
    expect(onSelect).toHaveBeenCalledWith(0)

    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(screen.queryByRole('list')).toBeNull()
  })
})
