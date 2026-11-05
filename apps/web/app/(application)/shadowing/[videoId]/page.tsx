'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DashboardShell } from '@/components/DashboardShell'
import { CurrentSegmentCaption } from '@/components/shadowing/CurrentSegmentCaption'
import { ExplanationPanel } from '@/components/shadowing/ExplanationPanel'
import { SentenceList } from '@/components/shadowing/SentenceList'
import { useShadowingPlayerInstance } from '@/components/shadowing/ShadowingPlayerContext'
import { findFirstSegmentIndexForSentence } from '@/components/shadowing/shadowingSegmentLogic'
import { useShadowingShortcuts } from '@/components/shadowing/useShadowingShortcuts'
import { useSubtitlePreference } from '@/components/shadowing/useSubtitlePreference'
import { useYouTubeSegmentPlayer } from '@/components/shadowing/useYouTubeSegmentPlayer'
import { Button, buttonVariants } from '@/components/ui/button'
import { useCurrentPrincipal, useIsSessionReady } from '@/hooks/use-session-store'
import {
  getShadowingGetVideoQueryKey,
  getShadowingListVideosQueryKey,
  shadowingSaveProgress,
  useShadowingGetVideo,
  useShadowingPrioritizeSentence,
  useShadowingRegenerateExplanation,
  useShadowingRetryImport,
  useShadowingSaveProgress
} from '@/lib/api/generated/shadowing/shadowing'
import type { ShadowingGetVideo200, ShadowingGetVideo200Video } from '@/lib/api/generated/schemas'
import { getApiErrorStatus } from '@/lib/axios'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { SHADOWING_POLL_INTERVAL_MS, shadowingFailureLabel } from '../shadowingVideoStatus'

const SAVE_PROGRESS_DEBOUNCE_MS = 1000

const needsPolling = (detail: ShadowingGetVideo200 | undefined): boolean =>
  detail !== undefined &&
  (detail.video.status !== 'ready' ||
    detail.sentences.some(
      (sentence) => sentence.explanationStatus === 'pending' || sentence.explanationStatus === 'regenerating'
    ))

const backLink = (
  <Link href="/shadowing" className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'btn secondary')}>
    返回视频库
  </Link>
)

function VideoStatusScreen({ video }: { readonly video: ShadowingGetVideo200Video }) {
  const queryClient = useQueryClient()
  const retryMutation = useShadowingRetryImport()

  const handleRetry = () => {
    retryMutation.mutate(
      { videoId: video.id },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getShadowingGetVideoQueryKey(video.id) })
          void queryClient.invalidateQueries({ queryKey: getShadowingListVideosQueryKey() })
        },
        onError: (error) => {
          notify.apiError(error, '重试失败')
        }
      }
    )
  }

  return (
    <section className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6 shadow-sm">
      {video.status === 'importing' ? (
        <>
          <h2 className="text-base font-semibold">视频导入中…</h2>
          <p className="text-muted-foreground text-sm">正在获取字幕并切分句子，完成后即可开始练习。</p>
        </>
      ) : null}
      {video.status === 'explaining' ? (
        <>
          <h2 className="text-base font-semibold">正在生成解读…</h2>
          <p className="text-muted-foreground text-sm">
            第一批句子解读完成后即可开始练习（已解读 {video.explainedCount} / {video.sentenceCount}）。
          </p>
        </>
      ) : null}
      {video.status === 'failed' ? (
        <>
          <h2 className="text-destructive text-base font-semibold">{shadowingFailureLabel(video.failureReason)}</h2>
          {video.failureReason === 'import_error' ? (
            <>
              {video.failureMessage ? (
                <p className="text-muted-foreground break-words text-sm">{video.failureMessage}</p>
              ) : null}
              <Button type="button" className="btn" disabled={retryMutation.isPending} onClick={handleRetry}>
                {retryMutation.isPending ? '重试中…' : '重试'}
              </Button>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

function PracticeView({ detail }: { readonly detail: ShadowingGetVideo200 }) {
  const { video, sentences, segments } = detail
  const videoId = video.id
  const queryClient = useQueryClient()
  const { containerRef, player } = useShadowingPlayerInstance(video.youtubeVideoId)
  const { subtitleVisible, toggleSubtitle } = useSubtitlePreference()

  // Start where the learner left off [INV-SHADOW-016]; afterwards the page owns the position.
  const initialSegmentPosition = useMemo(() => {
    if (segments.length === 0) {
      return 0
    }
    const position = segments.findIndex((segment) => segment.segmentIndex === video.lastSegmentIndex)
    return position === -1 ? Math.min(Math.max(video.lastSegmentIndex, 0), segments.length - 1) : position
  }, [segments, video.lastSegmentIndex])
  const [selectedSegmentPosition, setSelectedSegmentPosition] = useState<number | null>(null)
  const currentSegmentPosition = selectedSegmentPosition ?? initialSegmentPosition
  const currentSegment = segments[currentSegmentPosition] ?? null
  const currentSentence = useMemo(
    () =>
      currentSegment === null
        ? null
        : (sentences.find((sentence) => sentence.sentenceIndex === currentSegment.sentenceIndex) ?? null),
    [currentSegment, sentences]
  )

  const segmentPlayer = useYouTubeSegmentPlayer({
    player,
    segments,
    currentSegmentIndex: currentSegmentPosition,
    onSegmentEnd: () => undefined,
    onCurrentSegmentChange: setSelectedSegmentPosition
  })

  useShadowingShortcuts({
    onReplay: segmentPlayer.replay,
    onNext: segmentPlayer.next,
    onPrevious: segmentPlayer.previous,
    onToggleRate: segmentPlayer.toggleRate,
    onToggleSubtitle: toggleSubtitle,
    enabled: segments.length > 0
  })

  // ── Progress: save the current segment ~1 s after it changes [INV-SHADOW-016] ──
  const saveProgressMutation = useShadowingSaveProgress()
  const saveProgress = saveProgressMutation.mutate
  const lastSavedSegmentRef = useRef(video.lastSegmentIndex)
  const pendingSaveRef = useRef<number | null>(null)
  const currentSegmentIndex = currentSegment?.segmentIndex ?? null

  useEffect(() => {
    if (currentSegmentIndex === null || currentSegmentIndex === lastSavedSegmentRef.current) {
      pendingSaveRef.current = null
      return undefined
    }
    pendingSaveRef.current = currentSegmentIndex
    const timer = setTimeout(() => {
      pendingSaveRef.current = null
      lastSavedSegmentRef.current = currentSegmentIndex
      saveProgress(
        { videoId, data: { segmentIndex: currentSegmentIndex } },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: getShadowingListVideosQueryKey() })
          }
        }
      )
    }, SAVE_PROGRESS_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [currentSegmentIndex, queryClient, saveProgress, videoId])

  // Leaving the page inside the debounce window still records the position.
  useEffect(
    () => () => {
      const pending = pendingSaveRef.current
      if (pending === null) {
        return
      }
      void (async () => {
        try {
          await shadowingSaveProgress(videoId, { segmentIndex: pending })
        } catch {
          // Best effort: the previous position stays saved.
        }
      })()
    },
    [videoId]
  )

  // ── Prioritise the batch of a pending current sentence, once per sentence [AC-SHADOW-007] ──
  const prioritizeMutation = useShadowingPrioritizeSentence()
  const prioritize = prioritizeMutation.mutate
  const prioritizedSentencesRef = useRef(new Set<number>())
  const currentSentenceIndex = currentSentence?.sentenceIndex ?? null
  const currentSentencePending = currentSentence?.explanationStatus === 'pending'

  useEffect(() => {
    if (currentSentenceIndex === null || !currentSentencePending) {
      return
    }
    if (prioritizedSentencesRef.current.has(currentSentenceIndex)) {
      return
    }
    prioritizedSentencesRef.current.add(currentSentenceIndex)
    prioritize({ videoId, sentenceIndex: currentSentenceIndex })
  }, [currentSentenceIndex, currentSentencePending, prioritize, videoId])

  // ── Regenerate the current sentence's explanation ──
  const regenerateMutation = useShadowingRegenerateExplanation()
  const handleRegenerate = () => {
    if (currentSentenceIndex === null) {
      return
    }
    regenerateMutation.mutate(
      { videoId, sentenceIndex: currentSentenceIndex },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getShadowingGetVideoQueryKey(videoId) })
        },
        onError: (error) => {
          notify.apiError(error, '重新生成失败')
        }
      }
    )
  }
  const regenerating =
    regenerateMutation.isPending && regenerateMutation.variables.sentenceIndex === currentSentenceIndex

  const { playSegment } = segmentPlayer
  const handleSelectSentence = useCallback(
    (sentenceIndex: number) => {
      const position = findFirstSegmentIndexForSentence(segments, sentenceIndex)
      if (position === null) {
        return
      }
      setSelectedSegmentPosition(position)
      playSegment(position)
    },
    [playSegment, segments]
  )

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div
          ref={containerRef}
          data-testid="shadowing-player"
          className="aspect-video w-full overflow-hidden rounded-xl bg-black"
        />
        <CurrentSegmentCaption
          text={currentSegment?.text ?? null}
          subtitleVisible={subtitleVisible}
          rate={segmentPlayer.rate}
          isPlaying={segmentPlayer.isPlaying}
          segmentPosition={currentSegmentPosition}
          segmentCount={segments.length}
          canGoPrevious={segmentPlayer.canGoPrevious}
          canGoNext={segmentPlayer.canGoNext}
          onPrevious={segmentPlayer.previous}
          onReplay={segmentPlayer.replay}
          onNext={segmentPlayer.next}
          onToggleRate={segmentPlayer.toggleRate}
          onToggleSubtitle={toggleSubtitle}
        />
        <p className="text-muted-foreground text-xs">
          快捷键：空格 重播 · → 下一句 · ← 上一句 · S 切换速度 · H 显示/隐藏字幕
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <ExplanationPanel
          sentence={currentSentence}
          visible={!segmentPlayer.isPlaying}
          onRegenerate={handleRegenerate}
          regenerating={regenerating}
        />
        <SentenceList
          sentences={sentences}
          currentSentenceIndex={currentSentenceIndex}
          onSelect={handleSelectSentence}
          className="max-h-[50vh] rounded-xl border border-border bg-card p-4"
        />
      </div>
    </div>
  )
}

/** Practice opens once the video is ready (batch 0 settled) [REQ-SHADOW-015]. */
function VideoDetail({ detail }: { readonly detail: ShadowingGetVideo200 }) {
  if (detail.video.status !== 'ready') {
    return <VideoStatusScreen video={detail.video} />
  }
  return <PracticeView key={detail.video.id} detail={detail} />
}

export default function ShadowingPracticePage() {
  const params = useParams<{ videoId: string }>()
  const videoId = typeof params.videoId === 'string' ? params.videoId : ''
  const principal = useCurrentPrincipal()
  const isSessionReady = useIsSessionReady()

  const detailQuery = useShadowingGetVideo(videoId, {
    query: {
      enabled: isSessionReady && videoId.length > 0,
      refetchInterval: (query) => (needsPolling(query.state.data) ? SHADOWING_POLL_INTERVAL_MS : false)
    }
  })
  const detail = detailQuery.data

  const title = detail?.video.title.trim() ? detail.video.title : '跟读练习'

  return (
    <DashboardShell
      title={title}
      subtitle="逐句跟读：每段播放后自动暂停，看完解读再继续。"
      principalEmail={principal?.email}
      actions={backLink}
    >
      {detailQuery.isLoading ? <p className="text-muted-foreground text-sm">加载中…</p> : null}
      {detailQuery.isError ? (
        <p className="text-destructive text-sm">
          {getApiErrorStatus(detailQuery.error) === 404 ? '找不到该视频。' : '视频加载失败。'}
        </p>
      ) : null}
      {detail === undefined ? null : <VideoDetail detail={detail} />}
    </DashboardShell>
  )
}
