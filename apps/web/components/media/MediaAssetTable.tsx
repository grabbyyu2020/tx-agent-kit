'use client'

import { CheckSquare, FolderPlus, Square, Trash2, X } from 'lucide-react'
import { PermissionsGate } from '@/components/PermissionsGate'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { AssetPreview } from './AssetPreview'
import { ASSET_TYPE_LABELS, STATUS_COLORS, formatFileSize } from './mediaLibrary'
import type { MediaAssetActions } from './useMediaAssetActions'
import type { MediaAssetBrowser } from './useMediaAssetBrowser'

export function MediaAssetTable({
  teamId,
  browser,
  actions
}: {
  teamId: string
  browser: MediaAssetBrowser
  actions: MediaAssetActions
}) {
  const {
    filteredAssets,
    selectedAssetIdSet,
    toggleAssetSelection,
    toggleAllVisibleAssets,
    allVisibleSelected,
    sortField,
    sortOrder,
    handleSort,
    selectedCollectionId,
    collections
  } = browser
  const { openAddToCollectionDialog, handleRemoveFromCollection, removingAssetFromCollectionId, handleDeleteClick } = actions

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="h-9">
            <TableHead className="w-10 px-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={toggleAllVisibleAssets}
                aria-label={allVisibleSelected ? 'Deselect all visible assets' : 'Select all visible assets'}
              >
                {allVisibleSelected
                  ? <CheckSquare className="h-4 w-4" aria-hidden="true" />
                  : <Square className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </TableHead>
            <TableHead className="w-14 px-2">Preview</TableHead>
            <TableHead
              className="cursor-pointer select-none px-2"
              onClick={() => handleSort('originalFilename')}
            >
              Filename {sortField === 'originalFilename' && (sortOrder === 'asc' ? '\u2191' : '\u2193')}
            </TableHead>
            <TableHead className="w-28 px-2">Type</TableHead>
            <TableHead
              className="w-24 cursor-pointer select-none px-2"
              onClick={() => handleSort('fileSize')}
            >
              Size {sortField === 'fileSize' && (sortOrder === 'asc' ? '\u2191' : '\u2193')}
            </TableHead>
            <TableHead className="w-28 px-2">Status</TableHead>
            <TableHead
              className="w-32 cursor-pointer select-none px-2"
              onClick={() => handleSort('createdAt')}
            >
              Created {sortField === 'createdAt' && (sortOrder === 'asc' ? '\u2191' : '\u2193')}
            </TableHead>
            <TableHead className="w-28 px-2 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredAssets.map((asset) => (
            <TableRow key={asset.id} className="h-14">
              <TableCell className="px-2 py-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={() => toggleAssetSelection(asset.id)}
                  aria-label={`${selectedAssetIdSet.has(asset.id) ? 'Deselect' : 'Select'} ${asset.originalFilename}`}
                >
                  {selectedAssetIdSet.has(asset.id)
                    ? <CheckSquare className="h-4 w-4" aria-hidden="true" />
                    : <Square className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </TableCell>
              <TableCell className="px-2 py-1.5">
                <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted">
                  <AssetPreview asset={asset} teamId={teamId} compact />
                </div>
              </TableCell>
              <TableCell className="max-w-xs truncate px-2 py-1.5 font-medium" title={asset.originalFilename}>
                {asset.originalFilename}
              </TableCell>
              <TableCell className="px-2 py-1.5">
                <Badge variant="secondary" className="text-xs">
                  {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
                </Badge>
              </TableCell>
              <TableCell className="px-2 py-1.5 text-sm">{formatFileSize(asset.fileSize)}</TableCell>
              <TableCell className="px-2 py-1.5">
                <Badge variant="outline" className={`text-xs ${STATUS_COLORS[asset.processingStatus] ?? ''}`}>
                  {asset.processingStatus}
                </Badge>
              </TableCell>
              <TableCell className="px-2 py-1.5 text-sm text-muted-foreground">
                {new Date(asset.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell className="px-2 py-1.5">
                <div className="flex justify-end gap-1">
                <PermissionsGate permission="manage_assets">
                  {selectedCollectionId === 'all' ? (
                    collections.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
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
                      className="h-8 w-8 p-0"
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
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={() => handleDeleteClick(asset)}
                    aria-label={`Delete ${asset.originalFilename}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </PermissionsGate>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
