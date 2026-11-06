'use client'

import { useState } from 'react'
import {
  assetsRequestUpload,
  assetsUploadContent,
  assetsConfirmUpload
} from '@/lib/api/generated/assets/assets'
import { notify } from '@/lib/notify'
import { resolveBrowserUrl } from '@/lib/url-state'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { formatFileSize, type UploadQueueItem } from './mediaLibrary'

export function MediaUploadDialog({
  teamId,
  showUploadDialog,
  setShowUploadDialog,
  resetAssetPagination,
  invalidateAssets,
  setError
}: {
  teamId: string
  showUploadDialog: boolean
  setShowUploadDialog: (open: boolean) => void
  resetAssetPagination: () => void
  invalidateAssets: () => void
  setError: (error: string | null) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [uploadQueue, setUploadQueue] = useState<ReadonlyArray<UploadQueueItem>>([])
  const [draggingUpload, setDraggingUpload] = useState(false)

  const browserHostName = resolveBrowserUrl('/').hostname
  const prefersLocalUploadProxy = browserHostName === 'localhost' || browserHostName === '127.0.0.1'

  const uploadSingleFile = async (file: File): Promise<'uploaded' | 'deduplicated'> => {
    const result = await assetsRequestUpload(teamId, {
      fileName: file.name,
      fileSize: file.size,
      contentHash: null,
      mimeType: file.type || 'application/octet-stream'
    })

    if (result.deduplicated) {
      return 'deduplicated'
    }

    if (prefersLocalUploadProxy) {
      await assetsUploadContent(teamId, result.uploadId, {
        data: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream'
        }
      })
    } else {
      const uploadResponse = await fetch(result.presignedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' }
      })

      if (!uploadResponse.ok) {
        const detail = (await uploadResponse.text()).trim()
        throw new Error(detail || `Upload failed with status ${uploadResponse.status}`)
      }
    }

    await assetsConfirmUpload(teamId, result.uploadId)
    return 'uploaded'
  }

  const handleUploadFiles = async (files: ReadonlyArray<File>): Promise<void> => {
    if (uploading) {return}
    const uploadFiles = files.filter((file) => file.size >= 0)
    if (uploadFiles.length === 0) {return}

    const queueItems = uploadFiles.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      name: file.name,
      size: file.size,
      status: 'pending' as const
    }))

    setUploading(true)
    setUploadQueue(queueItems)
    setError(null)
    let uploadedCount = 0
    let failedCount = 0

    try {
      for (const [index, file] of uploadFiles.entries()) {
        const queueId = queueItems[index]?.id
        if (!queueId) {continue}
        setUploadQueue((current) => current.map((item) =>
          item.id === queueId ? { ...item, status: 'uploading' } : item
        ))

        try {
          const result = await uploadSingleFile(file)
          uploadedCount += 1
          setUploadQueue((current) => current.map((item) =>
            item.id === queueId ? { ...item, status: result } : item
          ))
        } catch (error) {
          failedCount += 1
          const message = notify.apiError(error, `Failed to upload ${file.name}`)
          setUploadQueue((current) => current.map((item) =>
            item.id === queueId ? { ...item, status: 'failed', error: message } : item
          ))
        }
      }

      if (uploadedCount > 0) {
        resetAssetPagination()
        invalidateAssets()
      }
      if (failedCount === 0) {
        setShowUploadDialog(false)
        setUploadQueue([])
      } else {
        setError(`Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}; ${failedCount} failed.`)
      }
    } finally {
      setUploading(false)
    }
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.currentTarget.value = ''
    if (files.length > 0) {
      void handleUploadFiles(files)
    }
  }

  const handleDropUpload = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDraggingUpload(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) {
      void handleUploadFiles(files)
    }
  }

  return (
    <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Assets</DialogTitle>
          <DialogDescription>
            Select one or more files to upload to your team's media library.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <label
            htmlFor="file-upload"
            data-testid="asset-upload-dropzone"
            onDragEnter={(event) => {
              event.preventDefault()
              setDraggingUpload(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDraggingUpload(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setDraggingUpload(false)
            }}
            onDrop={handleDropUpload}
            className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors hover:bg-muted/50 ${
              draggingUpload ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            <p className="text-sm text-muted-foreground">
              {uploading ? 'Uploading...' : 'Click to select files or drop them here'}
            </p>
            <input
              id="file-upload"
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              disabled={uploading}
              accept="image/*,video/*,audio/*,.gif,.pdf,.doc,.docx"
              multiple
            />
          </label>
          {uploadQueue.length > 0 && (
            <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border p-2">
              {uploadQueue.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(item.size)}</p>
                    {item.error && <p className="text-xs text-destructive">{item.error}</p>}
                  </div>
                  <Badge
                    variant={item.status === 'failed' ? 'destructive' : 'secondary'}
                    className="shrink-0 text-xs"
                  >
                    {item.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
