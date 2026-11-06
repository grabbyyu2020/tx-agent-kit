'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { MediaAssetActions } from './useMediaAssetActions'
import type { MediaAssetBrowser } from './useMediaAssetBrowser'

export function MediaAddToCollectionDialogs({
  browser,
  actions
}: {
  browser: MediaAssetBrowser
  actions: MediaAssetActions
}) {
  const { collections, selectedAssets } = browser
  const {
    assetToAddToCollection,
    setAssetToAddToCollection,
    addTargetCollectionId,
    setAddTargetCollectionId,
    handleAddToCollection,
    addingAssetToCollection,
    showBulkAddDialog,
    setShowBulkAddDialog,
    bulkAddTargetCollectionId,
    setBulkAddTargetCollectionId,
    handleBulkAddToCollection,
    bulkAddingToCollection
  } = actions

  return (
    <>
      {/* Add asset to collection dialog */}
      <Dialog open={!!assetToAddToCollection} onOpenChange={(open) => {
        if (!open) {
          setAssetToAddToCollection(null)
          setAddTargetCollectionId('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Collection</DialogTitle>
            <DialogDescription>
              Add &ldquo;{assetToAddToCollection?.originalFilename}&rdquo; to a media collection.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Target collection</span>
              <select
                value={addTargetCollectionId}
                onChange={(event) => setAddTargetCollectionId(event.target.value)}
                className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetToAddToCollection(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => { void handleAddToCollection() }}
              disabled={addingAssetToCollection || addTargetCollectionId.length === 0}
            >
              {addingAssetToCollection ? 'Adding...' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk add to collection dialog */}
      <Dialog open={showBulkAddDialog} onOpenChange={(open) => {
        setShowBulkAddDialog(open)
        if (!open) { setBulkAddTargetCollectionId('') }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Selected Assets</DialogTitle>
            <DialogDescription>
              Add {selectedAssets.length} selected asset{selectedAssets.length === 1 ? '' : 's'} to a media collection.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Target collection</span>
              <select
                value={bulkAddTargetCollectionId}
                onChange={(event) => setBulkAddTargetCollectionId(event.target.value)}
                className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => { void handleBulkAddToCollection() }}
              disabled={bulkAddingToCollection || bulkAddTargetCollectionId.length === 0}
            >
              {bulkAddingToCollection ? 'Adding...' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
