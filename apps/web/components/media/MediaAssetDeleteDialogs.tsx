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

export function MediaAssetDeleteDialogs({
  browser,
  actions
}: {
  browser: MediaAssetBrowser
  actions: MediaAssetActions
}) {
  const { selectedAssets } = browser
  const {
    showDeleteDialog,
    setShowDeleteDialog,
    assetToDelete,
    handleDeleteConfirm,
    deletingId,
    showBulkDeleteDialog,
    setShowBulkDeleteDialog,
    handleBulkDeleteConfirm,
    bulkDeletingAssets
  } = actions

  return (
    <>
      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Asset</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{assetToDelete?.originalFilename}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { void handleDeleteConfirm() }}
              disabled={!!deletingId}
            >
              {deletingId ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirmation dialog */}
      <Dialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Selected Assets</DialogTitle>
            <DialogDescription>
              Delete {selectedAssets.length} selected asset{selectedAssets.length === 1 ? '' : 's'}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { void handleBulkDeleteConfirm() }}
              disabled={bulkDeletingAssets}
            >
              {bulkDeletingAssets ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
