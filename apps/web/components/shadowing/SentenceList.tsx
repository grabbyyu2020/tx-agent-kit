'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ShadowingGetVideo200SentencesItem } from '@/lib/api/generated/schemas'
import { cn } from '@/lib/utils'
import { explanationStatusBadgeVariant, explanationStatusLabel } from './explanationStatus'

export interface SentenceListProps {
  readonly sentences: ReadonlyArray<ShadowingGetVideo200SentencesItem>
  /** sentenceIndex of the sentence that owns the current segment, or null. */
  readonly currentSentenceIndex: number | null
  readonly onSelect: (sentenceIndex: number) => void
  readonly defaultCollapsed?: boolean
  readonly className?: string
}

export function SentenceList({
  sentences,
  currentSentenceIndex,
  onSelect,
  defaultCollapsed = false,
  className
}: SentenceListProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const listId = useId()
  const currentItemRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const element = currentItemRef.current
    if (collapsed || element === null || typeof element.scrollIntoView !== 'function') {
      return
    }
    element.scrollIntoView({ block: 'nearest' })
  }, [collapsed, currentSentenceIndex])

  return (
    <nav aria-label="句子列表" className={cn('flex min-h-0 flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">句子列表（{sentences.length}）</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="btn secondary"
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? '展开' : '收起'}
        </Button>
      </div>
      {collapsed ? null : (
        <ol id={listId} className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {sentences.map((sentence) => {
            const isCurrent = sentence.sentenceIndex === currentSentenceIndex
            return (
              <li key={sentence.id}>
                <Button
                  ref={isCurrent ? currentItemRef : undefined}
                  type="button"
                  variant="ghost"
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => onSelect(sentence.sentenceIndex)}
                  className={cn(
                    'h-auto w-full items-start justify-start px-2 py-1.5 text-left font-normal whitespace-normal',
                    isCurrent && 'bg-accent text-accent-foreground font-medium ring-1 ring-ring/40'
                  )}
                >
                  <span className="text-muted-foreground w-6 shrink-0 tabular-nums">
                    {sentence.sentenceIndex + 1}
                  </span>
                  <span className="min-w-0 flex-1" lang="en">
                    {sentence.text}
                  </span>
                  <Badge variant={explanationStatusBadgeVariant[sentence.explanationStatus]}>
                    {explanationStatusLabel[sentence.explanationStatus]}
                  </Badge>
                </Button>
              </li>
            )
          })}
        </ol>
      )}
    </nav>
  )
}
