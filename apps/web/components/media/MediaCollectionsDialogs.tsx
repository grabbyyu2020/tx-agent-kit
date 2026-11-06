'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderPlus, Pencil, Trash2 } from 'lucide-react'
import {
  assetsCreateCollection,
  assetsUpdateCollection,
  assetsRemoveCollection,
  getAssetsListCollectionsQueryKey,
  getAssetsListCollectionAssetsQueryKey
} from '@/lib/api/generated/assets/assets'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { CollectionDialogMode, MediaCollectionResponse } from './mediaLibrary'
import type { MediaAssetBrowser } from './useMediaAssetBrowser'

export function MediaCollectionsDialogs({
  teamId,
  browser,
  showCollectionsManager,
  setShowCollectionsManager,
  setError
}: {
  teamId: string
  browser: MediaAssetBrowser
  showCollectionsManager: boolean
  setShowCollectionsManager: (open: boolean) => void
  setError: (error: string | null) => void
}) {
  const queryClient = useQueryClient()
  const {
    assetsQuery,
    assets,
    collections,
    selectedCollectionId,
    setSelectedCollectionId,
    resetAssetPagination
  } = browser

  const [showCollectionDialog, setShowCollectionDialog] = useState(false)
  const [collectionDialogMode, setCollectionDialogMode] = useState<CollectionDialogMode>('create')
  const [collectionFormName, setCollectionFormName] = useState('')
  const [collectionFormDescription, setCollectionFormDescription] = useState('')
  const [collectionToEdit, setCollectionToEdit] = useState<MediaCollectionResponse | null>(null)
  const [collectionToDelete, setCollectionToDelete] = useState<MediaCollectionResponse | null>(null)
  const [savingCollection, setSavingCollection] = useState(false)
  const [deletingCollection, setDeletingCollection] = useState(false)

  const collectionSubmitLabel = (() => {
    if (savingCollection) {return 'Saving...'}
    if (collectionDialogMode === 'create') {return 'Create'}
    return 'Save'
  })()

  const invalidateCollections = () => {
    void queryClient.invalidateQueries({ queryKey: getAssetsListCollectionsQueryKey(teamId) })
  }

  const openCreateCollectionDialog = () => {
    setCollectionDialogMode('create')
    setCollectionToEdit(null)
    setCollectionFormName('')
    setCollectionFormDescription('')
    setError(null)
    setShowCollectionDialog(true)
  }

  const openEditCollectionDialog = (collection: MediaCollectionResponse) => {
    setCollectionDialogMode('edit')
    setCollectionToEdit(collection)
    setCollectionFormName(collection.name)
    setCollectionFormDescription(collection.description ?? '')
    setError(null)
    setShowCollectionDialog(true)
  }

  const handleCollectionSubmit = async (): Promise<void> => {
    const name = collectionFormName.trim()
    if (name.length === 0 || savingCollection) {return}
    setSavingCollection(true)
    setError(null)

    try {
      const description = collectionFormDescription.trim()
      if (collectionDialogMode === 'create') {
        await assetsCreateCollection(teamId, {
          name,
          description: description.length > 0 ? description : null
        })
      } else if (collectionToEdit) {
        await assetsUpdateCollection(teamId, collectionToEdit.id, {
          name,
          description: description.length > 0 ? description : null
        })
      }
      invalidateCollections()
      setShowCollectionDialog(false)
      setCollectionToEdit(null)
      setCollectionFormName('')
      setCollectionFormDescription('')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to save collection')
      setError(message)
    } finally {
      setSavingCollection(false)
    }
  }

  const handleDeleteCollection = async (): Promise<void> => {
    if (!collectionToDelete || deletingCollection) {return}
    setDeletingCollection(true)
    setError(null)

    try {
      await assetsRemoveCollection(teamId, collectionToDelete.id)
      if (selectedCollectionId === collectionToDelete.id) {
        setSelectedCollectionId('all')
        resetAssetPagination()
      }
      invalidateCollections()
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, collectionToDelete.id)
      })
      setCollectionToDelete(null)
    } catch (error) {
      const message = notify.apiError(error, 'Failed to delete collection')
      setError(message)
    } finally {
      setDeletingCollection(false)
    }
  }

  return (
    <>
      {/* Collections manager dialog */}
      <Dialog open={showCollectionsManager} onOpenChange={setShowCollectionsManager}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Collections</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-sm font-medium">All media</p>
                <p className="text-xs text-muted-foreground">{assetsQuery.data?.total ?? assets.length} assets</p>
              </div>
              <Button
                type="button"
                variant={selectedCollectionId === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setSelectedCollectionId('all')
                  resetAssetPagination()
                  setShowCollectionsManager(false)
                }}
              >
                View
              </Button>
            </div>
            {collections.map((collection) => (
              <div key={collection.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{collection.name}</p>
                  {collection.description && (
                    <p className="truncate text-xs text-muted-foreground">{collection.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant={selectedCollectionId === collection.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSelectedCollectionId(collection.id)
                      resetAssetPagination()
                      setShowCollectionsManager(false)
                    }}
                  >
                    View
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => {
                      setShowCollectionsManager(false)
                      openEditCollectionDialog(collection)
                    }}
                    aria-label={`Edit ${collection.name}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={() => {
                      setShowCollectionsManager(false)
                      setCollectionToDelete(collection)
                    }}
                    aria-label={`Delete ${collection.name}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCollectionsManager(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setShowCollectionsManager(false)
                openCreateCollectionDialog()
              }}
            >
              <FolderPlus aria-hidden="true" />
              New Collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collection create/edit dialog */}
      <Dialog open={showCollectionDialog} onOpenChange={setShowCollectionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {collectionDialogMode === 'create' ? 'New Collection' : 'Edit Collection'}
            </DialogTitle>
            <DialogDescription>
              Organize media into reusable groups for campaigns and creative workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Collection name</span>
              <Input
                value={collectionFormName}
                onChange={(event) => setCollectionFormName(event.target.value)}
                maxLength={128}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Collection description</span>
              <textarea
                value={collectionFormDescription}
                onChange={(event) => setCollectionFormDescription(event.target.value)}
                className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCollectionDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => { void handleCollectionSubmit() }}
              disabled={savingCollection || collectionFormName.trim().length === 0}
            >
              {collectionSubmitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collection delete confirmation dialog */}
      <Dialog open={!!collectionToDelete} onOpenChange={(open) => {
        if (!open) { setCollectionToDelete(null) }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Collection</DialogTitle>
            <DialogDescription>
              Delete &ldquo;{collectionToDelete?.name}&rdquo;? The assets will remain in your media library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectionToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { void handleDeleteCollection() }}
              disabled={deletingCollection}
            >
              {deletingCollection ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
