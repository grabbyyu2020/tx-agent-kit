'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  assetsSoftDeleteAsset,
  assetsAddAssetToCollection,
  assetsRemoveAssetFromCollection,
  getAssetsListCollectionAssetsQueryKey
} from '@/lib/api/generated/assets/assets'
import { notify } from '@/lib/notify'
import type { MediaAssetResponse } from './mediaLibrary'
import type { MediaAssetBrowser } from './useMediaAssetBrowser'

export const useMediaAssetActions = ({
  teamId,
  browser,
  setError
}: {
  teamId: string
  browser: MediaAssetBrowser
  setError: (error: string | null) => void
}) => {
  const queryClient = useQueryClient()
  const {
    selectedCollectionId,
    collections,
    selectedAssetIds,
    resetAssetPagination,
    invalidateAssets,
    clearSelection
  } = browser

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [assetToDelete, setAssetToDelete] = useState<MediaAssetResponse | null>(null)
  const [assetToAddToCollection, setAssetToAddToCollection] = useState<MediaAssetResponse | null>(null)
  const [addTargetCollectionId, setAddTargetCollectionId] = useState('')
  const [addingAssetToCollection, setAddingAssetToCollection] = useState(false)
  const [bulkAddTargetCollectionId, setBulkAddTargetCollectionId] = useState('')
  const [bulkAddingToCollection, setBulkAddingToCollection] = useState(false)
  const [bulkRemovingFromCollection, setBulkRemovingFromCollection] = useState(false)
  const [bulkDeletingAssets, setBulkDeletingAssets] = useState(false)
  const [showBulkAddDialog, setShowBulkAddDialog] = useState(false)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
  const [removingAssetFromCollectionId, setRemovingAssetFromCollectionId] = useState<string | null>(null)

  const handleDeleteClick = (asset: MediaAssetResponse) => {
    setAssetToDelete(asset)
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!assetToDelete || deletingId) {return}
    setDeletingId(assetToDelete.id)
    setError(null)
    try {
      await assetsSoftDeleteAsset(teamId, assetToDelete.id)
      setShowDeleteDialog(false)
      resetAssetPagination()
      setAssetToDelete(null)
      invalidateAssets()
    } catch (error) {
      const message = notify.apiError(error, 'Failed to delete asset')
      setError(message)
    } finally {
      setDeletingId(null)
    }
  }

  const openAddToCollectionDialog = (asset: MediaAssetResponse) => {
    setAssetToAddToCollection(asset)
    setAddTargetCollectionId(selectedCollectionId !== 'all' ? selectedCollectionId : collections[0]?.id ?? '')
    setError(null)
  }

  const handleAddToCollection = async (): Promise<void> => {
    if (!assetToAddToCollection || !addTargetCollectionId || addingAssetToCollection) {return}
    setAddingAssetToCollection(true)
    setError(null)

    try {
      await assetsAddAssetToCollection(teamId, addTargetCollectionId, {
        assetId: assetToAddToCollection.id
      })
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, addTargetCollectionId)
      })
      setAssetToAddToCollection(null)
      setAddTargetCollectionId('')
      notify.success('Asset added to collection')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to add asset to collection')
      setError(message)
    } finally {
      setAddingAssetToCollection(false)
    }
  }

  const openBulkAddDialog = () => {
    setBulkAddTargetCollectionId(selectedCollectionId !== 'all' ? selectedCollectionId : collections[0]?.id ?? '')
    setError(null)
    setShowBulkAddDialog(true)
  }

  const handleBulkAddToCollection = async (): Promise<void> => {
    if (selectedAssetIds.length === 0 || !bulkAddTargetCollectionId || bulkAddingToCollection) {return}
    setBulkAddingToCollection(true)
    setError(null)

    try {
      const results = await Promise.allSettled(
        selectedAssetIds.map((assetId) =>
          assetsAddAssetToCollection(teamId, bulkAddTargetCollectionId, { assetId })
        )
      )
      const failed = results.filter((result) => result.status === 'rejected').length
      if (failed > 0) {
        throw new Error(`Failed to add ${failed} selected asset${failed === 1 ? '' : 's'} to the collection`)
      }
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, bulkAddTargetCollectionId)
      })
      setShowBulkAddDialog(false)
      setBulkAddTargetCollectionId('')
      clearSelection()
      notify.success('Assets added to collection')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to add selected assets to collection')
      setError(message)
    } finally {
      setBulkAddingToCollection(false)
    }
  }

  const handleRemoveFromCollection = async (asset: MediaAssetResponse): Promise<void> => {
    if (selectedCollectionId === 'all' || removingAssetFromCollectionId) {return}
    setRemovingAssetFromCollectionId(asset.id)
    setError(null)

    try {
      await assetsRemoveAssetFromCollection(teamId, selectedCollectionId, asset.id)
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, selectedCollectionId)
      })
      notify.success('Asset removed from collection')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to remove asset from collection')
      setError(message)
    } finally {
      setRemovingAssetFromCollectionId(null)
    }
  }

  const handleBulkRemoveFromCollection = async (): Promise<void> => {
    if (selectedCollectionId === 'all' || selectedAssetIds.length === 0 || bulkRemovingFromCollection) {return}
    setBulkRemovingFromCollection(true)
    setError(null)

    try {
      const results = await Promise.allSettled(
        selectedAssetIds.map((assetId) =>
          assetsRemoveAssetFromCollection(teamId, selectedCollectionId, assetId)
        )
      )
      const failed = results.filter((result) => result.status === 'rejected').length
      if (failed > 0) {
        throw new Error(`Failed to remove ${failed} selected asset${failed === 1 ? '' : 's'} from the collection`)
      }
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, selectedCollectionId)
      })
      clearSelection()
      notify.success('Assets removed from collection')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to remove selected assets from collection')
      setError(message)
    } finally {
      setBulkRemovingFromCollection(false)
    }
  }

  const handleBulkDeleteConfirm = async (): Promise<void> => {
    if (selectedAssetIds.length === 0 || bulkDeletingAssets) {return}
    setBulkDeletingAssets(true)
    setError(null)

    try {
      const results = await Promise.allSettled(
        selectedAssetIds.map((assetId) => assetsSoftDeleteAsset(teamId, assetId))
      )
      const failed = results.filter((result) => result.status === 'rejected').length
      if (failed > 0) {
        throw new Error(`Failed to delete ${failed} selected asset${failed === 1 ? '' : 's'}`)
      }
      setShowBulkDeleteDialog(false)
      resetAssetPagination()
      invalidateAssets()
      notify.success('Assets deleted')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to delete selected assets')
      setError(message)
    } finally {
      setBulkDeletingAssets(false)
    }
  }

  return {
    deletingId,
    showDeleteDialog,
    setShowDeleteDialog,
    assetToDelete,
    assetToAddToCollection,
    setAssetToAddToCollection,
    addTargetCollectionId,
    setAddTargetCollectionId,
    addingAssetToCollection,
    bulkAddTargetCollectionId,
    setBulkAddTargetCollectionId,
    bulkAddingToCollection,
    bulkRemovingFromCollection,
    bulkDeletingAssets,
    showBulkAddDialog,
    setShowBulkAddDialog,
    showBulkDeleteDialog,
    setShowBulkDeleteDialog,
    removingAssetFromCollectionId,
    handleDeleteClick,
    handleDeleteConfirm,
    openAddToCollectionDialog,
    handleAddToCollection,
    openBulkAddDialog,
    handleBulkAddToCollection,
    handleRemoveFromCollection,
    handleBulkRemoveFromCollection,
    handleBulkDeleteConfirm
  }
}

export type MediaAssetActions = ReturnType<typeof useMediaAssetActions>
