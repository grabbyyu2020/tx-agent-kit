'use client'

import { CheckSquare, FolderPlus, Square, Trash2, X } from 'lucide-react'
import { PermissionsGate } from '@/components/PermissionsGate'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AssetPreview } from './AssetPreview'
import { ASSET_TYPE_LABELS, STATUS_COLORS, formatFileSize } from './mediaLibrary'
import type { MediaAssetActions } from './useMediaAssetActions'
import type { MediaAssetBrowser } from './useMediaAssetBrowser'

export function MediaAssetGrid({
  teamId,
  browser,
  actions
}: {
  teamId: string
  browser: MediaAssetBrowser
  actions: MediaAssetActions
}) {
  const { filteredAssets, selectedAssetIdSet, toggleAssetSelection, selectedCollectionId, collections } = browser
  const { openAddToCollectionDialog, handleRemoveFromCollection, removingAssetFromCollectionId, handleDeleteClick } = actions

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {filteredAssets.map((asset) => (
        <Card key={asset.id} className="overflow-hidden">
          <div className="relative aspect-[4/3] overflow-hidden bg-muted">
            <AssetPreview asset={asset} teamId={teamId} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute left-2 top-2 h-8 w-8 bg-background/90 shadow-sm"
              onClick={() => toggleAssetSelection(asset.id)}
              aria-label={`${selectedAssetIdSet.has(asset.id) ? 'Deselect' : 'Select'} ${asset.originalFilename}`}
            >
              {selectedAssetIdSet.has(asset.id)
                ? <CheckSquare className="h-4 w-4" aria-hidden="true" />
                : <Square className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
          <CardContent className="p-2.5">
            <p className="text-sm font-medium truncate" title={asset.originalFilename}>
              {asset.originalFilename}
            </p>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-muted-foreground">{formatFileSize(asset.fileSize)}</span>
              <Badge variant="outline" className={`text-xs ${STATUS_COLORS[asset.processingStatus] ?? ''}`}>
                {asset.processingStatus}
              </Badge>
            </div>
            <div className="flex items-center gap-1 mt-2">
              <Badge variant="secondary" className="text-xs">
                {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
              </Badge>
              <div className="ml-auto flex items-center gap-1">
              <PermissionsGate permission="manage_assets">
                {selectedCollectionId === 'all' ? (
                  collections.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => openAddToCollectionDialog(asset)}
                      aria-label={`Add ${asset.originalFilename} to collection`}
                    >
                      <FolderPlus className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => { void handleRemoveFromCollection(asset) }}
                    disabled={removingAssetFromCollectionId === asset.id}
                    aria-label={`Remove ${asset.originalFilename} from collection`}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </PermissionsGate>
              <PermissionsGate permission="delete_assets">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive"
                  onClick={() => handleDeleteClick(asset)}
                  aria-label={`Delete ${asset.originalFilename}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </PermissionsGate>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
