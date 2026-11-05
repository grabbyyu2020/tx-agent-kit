// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShadowingGetVideo200SentencesItem } from '@/lib/api/generated/schemas'
import { ExplanationPanel } from './ExplanationPanel'

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

describe('ExplanationPanel', () => {
  it('shows meaning, key expressions and tone when ready and visible', () => {
    const onRegenerate = vi.fn<() => void>()
    render(<ExplanationPanel sentence={makeSentence(1)} visible onRegenerate={onRegenerate} />)

    expect(screen.getByText('意思')).toBeDefined()
    expect(screen.getByText('number').tagName).toBe('STRONG')
    expect(screen.getByText('语气与语境')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('hides the explanation while playing', () => {
    render(<ExplanationPanel sentence={makeSentence(1)} visible={false} onRegenerate={() => undefined} />)
    expect(screen.queryByText('意思')).toBeNull()
  })

  it('shows generating and failed states', () => {
    const { rerender } = render(
      <ExplanationPanel
        sentence={makeSentence(1, { explanationStatus: 'pending', explanation: null })}
        visible
        onRegenerate={() => undefined}
      />
    )
    expect(screen.getByText('解读生成中…')).toBeDefined()

    rerender(
      <ExplanationPanel
        sentence={makeSentence(1, { explanationStatus: 'failed', explanation: null })}
        visible
        onRegenerate={() => undefined}
      />
    )
    expect(screen.getAllByText('生成失败').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '重新生成' })).toBeDefined()
  })
})
