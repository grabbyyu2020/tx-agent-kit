'use client'

import Link from 'next/link'
import { useState, type SyntheticEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DashboardShell } from '@/components/DashboardShell'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCurrentPrincipal, useIsSessionReady } from '@/hooks/use-session-store'
import {
  getShadowingListVideosQueryKey,
  useShadowingDeleteVideo,
  useShadowingImportVideo,
  useShadowingListVideos,
  useShadowingRetryImport
} from '@/lib/api/generated/shadowing/shadowing'
import type { ShadowingListVideos200DataItem } from '@/lib/api/generated/schemas'
import { getApiErrorMessage, getApiErrorStatus } from '@/lib/axios'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  SHADOWING_POLL_INTERVAL_MS,
  formatShadowingDuration,
  isShadowingVideoInProgress,
  isShadowingVideoPracticable,
  shadowingFailureLabel,
  shadowingVideoStatusLabel
} from './shadowingVideoStatus'

type ShadowingVideo = ShadowingListVideos200DataItem

const statusBadgeVariant = (video: ShadowingVideo): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (video.status) {
    case 'ready':
      return 'default'
    case 'failed':
      return 'destructive'
    case 'importing':
    case 'explaining':
      return 'secondary'
  }
}

interface VideoCardProps {
  readonly video: ShadowingVideo
  readonly highlighted: boolean
  readonly retrying: boolean
  readonly onRetry: () => void
  readonly onDelete: () => void
}

function videoTitle(video: ShadowingVideo): string {
  if (video.title.trim().length > 0) {
    return video.title
  }
  return video.status === 'importing' ? '导入中…' : `YouTube ${video.youtubeVideoId}`
}

function VideoCard({ video, highlighted, retrying, onRetry, onDelete }: VideoCardProps) {
  const title = videoTitle(video)

  return (
    <li
      data-testid="shadowing-video-card"
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm',
        highlighted && 'ring-2 ring-primary'
      )}
    >
      <div className="bg-muted relative aspect-video w-full">
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt={title} className="h-full w-full object-cover" loading="lazy" />
        ) : null}
        <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-xs text-white tabular-nums">
          {formatShadowingDuration(video.durationSeconds)}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="line-clamp-2 text-sm font-semibold leading-snug">{title}</h2>
          <Badge variant={statusBadgeVariant(video)}>{shadowingVideoStatusLabel(video)}</Badge>
        </div>

        {video.status === 'failed' ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-destructive">{shadowingFailureLabel(video.failureReason)}</p>
            {video.failureReason === 'import_error' && video.failureMessage ? (
              <p className="text-muted-foreground break-words text-xs">{video.failureMessage}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm tabular-nums">
            已解读 {video.explainedCount} / {video.sentenceCount}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2">
          {isShadowingVideoPracticable(video) ? (
            <Link href={`/shadowing/${video.id}`} className={cn(buttonVariants({ size: 'sm' }), 'btn')}>
              继续练习
            </Link>
          ) : null}
          {video.status === 'failed' && video.failureReason === 'import_error' ? (
            <Button type="button" size="sm" className="btn" disabled={retrying} onClick={onRetry}>
              {retrying ? '重试中…' : '重试'}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="btn danger ml-auto"
            onClick={onDelete}
          >
            删除
          </Button>
        </div>
      </div>
    </li>
  )
}

export default function ShadowingLibraryPage() {
  const principal = useCurrentPrincipal()
  const isSessionReady = useIsSessionReady()
  const queryClient = useQueryClient()

  const [url, setUrl] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ShadowingVideo | null>(null)

  const videosQuery = useShadowingListVideos({
    query: {
      enabled: isSessionReady,
      // Poll while any import or first explanation batch is still running.
      refetchInterval: (query) =>
        (query.state.data?.data ?? []).some(isShadowingVideoInProgress) ? SHADOWING_POLL_INTERVAL_MS : false
    }
  })
  const videos = videosQuery.data?.data ?? []

  const invalidateVideos = () => queryClient.invalidateQueries({ queryKey: getShadowingListVideosQueryKey() })

  const importMutation = useShadowingImportVideo()
  const retryMutation = useShadowingRetryImport()
  const deleteMutation = useShadowingDeleteVideo()

  const handleImport = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = url.trim()
    if (trimmed.length === 0 || importMutation.isPending) {
      return
    }
    setImportError(null)
    importMutation.mutate(
      { data: { url: trimmed } },
      {
        onSuccess: (result) => {
          setUrl('')
          setHighlightedId(result.video.id)
          notify.success(result.created ? '已开始导入' : '该视频已在视频库中')
          void invalidateVideos()
        },
        onError: (error) => {
          setImportError(
            getApiErrorStatus(error) === 400
              ? '无法识别的 YouTube 视频链接，请检查后重试。'
              : getApiErrorMessage(error, '导入失败，请稍后重试。')
          )
        }
      }
    )
  }

  const handleRetry = (videoId: string) => {
    retryMutation.mutate(
      { videoId },
      {
        onSuccess: () => {
          notify.success('已重新开始导入')
          void invalidateVideos()
        },
        onError: (error) => {
          notify.apiError(error, '重试失败')
        }
      }
    )
  }

  const handleConfirmDelete = () => {
    if (pendingDelete === null) {
      return
    }
    deleteMutation.mutate(
      { videoId: pendingDelete.id },
      {
        onSuccess: () => {
          setPendingDelete(null)
          notify.success('视频已删除')
          void invalidateVideos()
        },
        onError: (error) => {
          notify.apiError(error, '删除失败')
        }
      }
    )
  }

  return (
    <DashboardShell
      title="跟读练习"
      subtitle="导入 YouTube 视频，逐句跟读并查看中文解读。"
      principalEmail={principal?.email}
    >
      <div className="flex flex-col gap-6">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <form className="flex flex-col gap-3" onSubmit={handleImport} noValidate>
            <Label htmlFor="shadowing-import-url">YouTube 视频链接</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="shadowing-import-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value)
                  setImportError(null)
                }}
                placeholder="https://www.youtube.com/watch?v=..."
                aria-invalid={importError !== null}
                aria-describedby={importError !== null ? 'shadowing-import-error' : undefined}
              />
              <Button
                type="submit"
                className="btn"
                disabled={importMutation.isPending || url.trim().length === 0}
              >
                {importMutation.isPending ? '导入中…' : '导入'}
              </Button>
            </div>
            {importError !== null ? (
              <p id="shadowing-import-error" role="alert" className="text-destructive text-sm">
                {importError}
              </p>
            ) : null}
          </form>
        </section>

        {videosQuery.isLoading ? <p className="text-muted-foreground text-sm">加载中…</p> : null}
        {videosQuery.isError ? <p className="text-destructive text-sm">视频库加载失败。</p> : null}
        {videosQuery.isSuccess && videos.length === 0 ? (
          <p className="text-muted-foreground text-sm">还没有导入视频。</p>
        ) : null}

        {videos.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {videos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                highlighted={video.id === highlightedId}
                retrying={retryMutation.isPending && retryMutation.variables.videoId === video.id}
                onRetry={() => handleRetry(video.id)}
                onDelete={() => setPendingDelete(video)}
              />
            ))}
          </ul>
        ) : null}
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null)
          }
        }}
      >
        <DialogContent aria-label="删除视频">
          <DialogHeader>
            <DialogTitle>删除视频？</DialogTitle>
            <DialogDescription>
              将删除「{pendingDelete ? videoTitle(pendingDelete) : ''}」的句子、解读和练习进度，且无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="btn secondary" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="btn danger"
              disabled={deleteMutation.isPending}
              onClick={handleConfirmDelete}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  )
}
