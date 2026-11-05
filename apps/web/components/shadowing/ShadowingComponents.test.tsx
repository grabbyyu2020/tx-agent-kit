// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShadowingGetVideo200SentencesItem } from '@/lib/api/generated/schemas'
import { CurrentSegmentCaption } from './CurrentSegmentCaption'
import { ExplanationPanel } from './ExplanationPanel'
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

describe('CurrentSegmentCaption', () => {
  it('shows the caption only when subtitles are visible and wires the controls', () => {
    const onNext = vi.fn<() => void>()
    const props = {
      text: 'Hello there.',
      rate: 1 as const,
      isPlaying: false,
      segmentPosition: 0,
      segmentCount: 2,
      canGoPrevious: false,
      canGoNext: true,
      onPrevious: () => undefined,
      onReplay: () => undefined,
      onNext,
      onToggleRate: () => undefined,
      onToggleSubtitle: () => undefined
    }
    const { rerender } = render(<CurrentSegmentCaption {...props} subtitleVisible />)
    expect(screen.getByText('Hello there.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '下一句' }))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '上一句' }).hasAttribute('disabled')).toBe(true)

    rerender(<CurrentSegmentCaption {...props} subtitleVisible={false} />)
    expect(screen.queryByText('Hello there.')).toBeNull()
  })
})
