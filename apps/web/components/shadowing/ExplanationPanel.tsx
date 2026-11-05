'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { ShadowingGetVideo200SentencesItem } from '@/lib/api/generated/schemas'
import { cn } from '@/lib/utils'
import { explanationStatusBadgeVariant, explanationStatusLabel } from './explanationStatus'

export interface ExplanationPanelProps {
  /** The sentence the current segment belongs to; null while nothing is selected. */
  readonly sentence: ShadowingGetVideo200SentencesItem | null
  /** True when the segment has paused; false while playing (content hidden so the learner listens). */
  readonly visible: boolean
  readonly onRegenerate: () => void
  /** True while the regenerate request is in flight. */
  readonly regenerating?: boolean
  readonly className?: string
}

function GeneratingState() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <p className="text-muted-foreground text-sm">解读生成中…</p>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  )
}

export function ExplanationPanel({
  sentence,
  visible,
  onRegenerate,
  regenerating = false,
  className
}: ExplanationPanelProps) {
  const status = regenerating ? 'regenerating' : sentence?.explanationStatus
  const explanation = sentence?.explanation ?? null

  return (
    <Card
      className={cn('gap-4 transition-opacity', visible ? 'opacity-100' : 'opacity-60', className)}
      aria-label="句子解读"
      role="region"
      data-testid="shadowing-explanation-panel"
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>句子解读</CardTitle>
        {visible && status !== undefined ? (
          <Badge variant={explanationStatusBadgeVariant[status]}>{explanationStatusLabel[status]}</Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4" aria-live="polite">
        {sentence === null ? <p className="text-muted-foreground text-sm">选择一句开始练习。</p> : null}
        {sentence !== null && !visible ? (
          <p className="text-muted-foreground text-sm">跟读中… 这一段结束后显示解读。</p>
        ) : null}
        {sentence !== null && visible ? (
          <>
            <p className="text-lg leading-relaxed font-medium" lang="en">
              {sentence.text}
            </p>

            {status === 'pending' || status === 'regenerating' ? <GeneratingState /> : null}

            {status === 'failed' ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-destructive text-sm">生成失败</p>
                <Button type="button" className="btn" onClick={onRegenerate}>
                  重新生成
                </Button>
              </div>
            ) : null}

            {status === 'ready' && explanation !== null ? (
              <>
                <section className="flex flex-col gap-1">
                  <h3 className="text-muted-foreground text-sm font-semibold">意思</h3>
                  <p className="text-sm leading-relaxed">{explanation.meaning}</p>
                </section>
                {explanation.keyExpressions.length > 0 ? (
                  <section className="flex flex-col gap-1">
                    <h3 className="text-muted-foreground text-sm font-semibold">关键表达</h3>
                    <ul className="flex flex-col gap-2">
                      {explanation.keyExpressions.map((item, index) => (
                        <li key={`${item.expression}-${index}`} className="text-sm leading-relaxed">
                          <strong lang="en">{item.expression}</strong>
                          <span className="text-muted-foreground"> — </span>
                          <span>{item.explanation}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <section className="flex flex-col gap-1">
                  <h3 className="text-muted-foreground text-sm font-semibold">语气与语境</h3>
                  <p className="text-sm leading-relaxed">{explanation.toneAndContext}</p>
                </section>
                <div>
                  <Button type="button" size="sm" variant="outline" className="btn secondary" onClick={onRegenerate}>
                    重新生成
                  </Button>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
