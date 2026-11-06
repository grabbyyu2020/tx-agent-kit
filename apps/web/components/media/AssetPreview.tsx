'use client'

import { File, FileText, Film, Image as ImageIcon, Music } from 'lucide-react'
import {
  useAssetsGetAssetSignedUrl,
  useAssetsGetAssetThumbnailSignedUrl
} from '@/lib/api/generated/assets/assets'
import { ASSET_TYPE_LABELS, type MediaAssetResponse } from './mediaLibrary'

const AssetTypeIcon = ({ assetType }: { assetType: string }) => {
  const className = "h-5 w-5"
  if (assetType === 'image' || assetType === 'gif') {return <ImageIcon className={className} aria-hidden="true" />}
  if (assetType === 'video') {return <Film className={className} aria-hidden="true" />}
  if (assetType === 'audio') {return <Music className={className} aria-hidden="true" />}
  if (assetType === 'document') {return <FileText className={className} aria-hidden="true" />}
  return <File className={className} aria-hidden="true" />
}

export const AssetPreview = ({
  asset,
  teamId,
  compact = false
}: {
  asset: MediaAssetResponse
  teamId: string
  compact?: boolean
}) => {
  const canRenderImage = asset.assetType === 'image' || asset.assetType === 'gif'
  const thumbnailQuery = useAssetsGetAssetThumbnailSignedUrl(teamId, asset.id, {
    query: {
      enabled: Boolean(asset.thumbnailPath),
      staleTime: 5 * 60 * 1000
    }
  })
  const originalQuery = useAssetsGetAssetSignedUrl(teamId, asset.id, {
    query: {
      enabled: canRenderImage && !asset.thumbnailPath,
      staleTime: 5 * 60 * 1000
    }
  })
  const previewUrl = thumbnailQuery.data?.url ?? originalQuery.data?.url ?? null

  if (canRenderImage && previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={asset.originalFilename}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    )
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
      <AssetTypeIcon assetType={asset.assetType} />
      {!compact && (
        <span className="sr-only">
          {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
        </span>
      )}
    </div>
  )
}
