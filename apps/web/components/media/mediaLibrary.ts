import type { AssetsListAssets200DataItem } from '@/lib/api/generated/schemas/assetsListAssets200DataItem'
import type { AssetsListCollections200DataItem } from '@/lib/api/generated/schemas/assetsListCollections200DataItem'

export type ViewMode = 'card' | 'list'
export type AssetTypeFilter = 'all' | 'image' | 'video' | 'audio' | 'gif' | 'document'
export type SortField = 'createdAt' | 'originalFilename' | 'fileSize'

export const ASSET_TYPE_LABELS: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  gif: 'GIF',
  document: 'Document'
}

export const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800'
}

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {return `${bytes} B`}
  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`}
  if (bytes < 1024 * 1024 * 1024) {return `${(bytes / (1024 * 1024)).toFixed(1)} MB`}
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export type MediaAssetResponse = AssetsListAssets200DataItem
export type MediaCollectionResponse = AssetsListCollections200DataItem
export type CollectionDialogMode = 'create' | 'edit'
export const ASSET_PAGE_LIMIT = 25

export type UploadQueueItem = {
  readonly id: string
  readonly name: string
  readonly size: number
  readonly status: 'pending' | 'uploading' | 'uploaded' | 'deduplicated' | 'failed'
  readonly error?: string
}
