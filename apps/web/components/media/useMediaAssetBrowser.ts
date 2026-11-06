'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useAssetsListAssets,
  useAssetsListCollections,
  useAssetsListCollectionAssets,
  getAssetsListAssetsQueryKey,
  useAssetsSearchAssets,
  getAssetsSearchAssetsQueryKey,
  getAssetsListCollectionAssetsQueryKey
} from '@/lib/api/generated/assets/assets'
import { ASSET_PAGE_LIMIT, type AssetTypeFilter, type SortField } from './mediaLibrary'

export const useMediaAssetBrowser = (teamId: string) => {
  const queryClient = useQueryClient()

  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>('all')
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCollectionId, setSelectedCollectionId] = useState('all')
  const [assetCursor, setAssetCursor] = useState<string | undefined>(undefined)
  const [assetCursorStack, setAssetCursorStack] = useState<ReadonlyArray<string>>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<ReadonlyArray<string>>([])

  const trimmedSearchQuery = searchQuery.trim()
  const resetAssetPagination = () => {
    setAssetCursor(undefined)
    setAssetCursorStack([])
    setSelectedAssetIds([])
  }
  const assetTypeFilterParam = typeFilter === 'all' ? undefined : typeFilter
  const commonAssetParams = {
    cursor: assetCursor,
    limit: String(ASSET_PAGE_LIMIT),
    sortBy: sortField,
    sortOrder,
    ...(assetTypeFilterParam ? { 'filter[assetType]': assetTypeFilterParam } : {})
  }
  const collectionsQuery = useAssetsListCollections(teamId, { sortBy: 'createdAt', sortOrder: 'desc' })
  const collections = collectionsQuery.data?.data ?? []
  const selectedCollection = selectedCollectionId === 'all'
    ? null
    : collections.find((collection) => collection.id === selectedCollectionId) ?? null
  const assetsQuery = useAssetsListAssets(teamId, commonAssetParams, {
    query: { enabled: selectedCollectionId === 'all' && trimmedSearchQuery.length === 0 }
  })
  const searchAssetsQuery = useAssetsSearchAssets(teamId, {
    cursor: assetCursor,
    limit: String(ASSET_PAGE_LIMIT),
    query: trimmedSearchQuery,
    sortBy: 'createdAt',
    sortOrder,
    ...(assetTypeFilterParam ? { 'filter[assetType]': assetTypeFilterParam } : {})
  }, {
    query: { enabled: selectedCollectionId === 'all' && trimmedSearchQuery.length > 0 }
  })
  const collectionAssetsQuery = useAssetsListCollectionAssets(teamId, selectedCollectionId, commonAssetParams, {
    query: { enabled: selectedCollectionId !== 'all' }
  })

  const activeAssetsQuery = (() => {
    if (selectedCollectionId !== 'all') {return collectionAssetsQuery}
    if (trimmedSearchQuery.length > 0) {return searchAssetsQuery}
    return assetsQuery
  })()
  const assets = (activeAssetsQuery.data?.data ?? [])
  const assetTotal = activeAssetsQuery.data?.total ?? 0
  const nextAssetCursor = activeAssetsQuery.data?.nextCursor ?? null
  const hasPreviousAssetPage = assetCursorStack.length > 0
  const showAssetPagination = assetTotal > 0
  const pageStart = assetTotal === 0 ? 0 : assetCursorStack.length * ASSET_PAGE_LIMIT + 1
  const pageEnd = assetTotal === 0 ? 0 : Math.min(pageStart + assets.length - 1, assetTotal)
  const loading = activeAssetsQuery.isLoading

  useEffect(() => {
    if (selectedCollectionId === 'all') {return}
    if (collectionsQuery.isLoading) {return}
    const exists = collections.some((collection) => collection.id === selectedCollectionId)
    if (!exists) {
      setSelectedCollectionId('all')
      resetAssetPagination()
    }
  }, [collections, collectionsQuery.isLoading, selectedCollectionId])

  useEffect(() => {
    const currentAssetIds = new Set(assets.map((asset) => asset.id))
    setSelectedAssetIds((current) => {
      const next = current.filter((id) => currentAssetIds.has(id))
      return next.length === current.length ? current : next
    })
  }, [assets])

  const invalidateAssets = () => {
    void queryClient.invalidateQueries({ queryKey: getAssetsListAssetsQueryKey(teamId) })
    void queryClient.invalidateQueries({ queryKey: getAssetsSearchAssetsQueryKey(teamId) })
    if (selectedCollectionId !== 'all') {
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, selectedCollectionId)
      })
    }
  }

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId]
    )
  }

  const toggleAllVisibleAssets = () => {
    setSelectedAssetIds((current) => {
      const visibleIds = filteredAssets.map((asset) => asset.id)
      if (visibleIds.length === 0) {return current}
      if (visibleIds.every((id) => current.includes(id))) {
        return current.filter((id) => !visibleIds.includes(id))
      }
      return Array.from(new Set([...current, ...visibleIds]))
    })
  }

  const clearSelection = () => {
    setSelectedAssetIds([])
  }

  const handleNextPage = () => {
    if (!nextAssetCursor) {return}
    setAssetCursorStack((current) => [...current, assetCursor ?? ''])
    setAssetCursor(nextAssetCursor)
    clearSelection()
  }

  const handlePreviousPage = () => {
    if (assetCursorStack.length === 0) {return}
    const previousCursor = assetCursorStack[assetCursorStack.length - 1]
    setAssetCursorStack((current) => current.slice(0, -1))
    setAssetCursor(previousCursor && previousCursor.length > 0 ? previousCursor : undefined)
    clearSelection()
  }

  const filteredAssets = assets.filter((asset) => {
    if (typeFilter !== 'all' && asset.assetType !== typeFilter) {return false}
    if (selectedCollectionId !== 'all' && trimmedSearchQuery.length > 0) {
      const query = trimmedSearchQuery.toLowerCase()
      const matchesFilename = asset.originalFilename.toLowerCase().includes(query)
      const matchesTitle = asset.aiTitle?.toLowerCase().includes(query) ?? false
      const matchesDescription = asset.aiDescription?.toLowerCase().includes(query) ?? false
      if (!matchesFilename && !matchesTitle && !matchesDescription) {return false}
    }
    return true
  })
  const selectedAssetIdSet = new Set(selectedAssetIds)
  const selectedAssets = filteredAssets.filter((asset) => selectedAssetIdSet.has(asset.id))
  const allVisibleSelected = filteredAssets.length > 0 && filteredAssets.every((asset) => selectedAssetIdSet.has(asset.id))

  const handleSort = (field: SortField) => {
    resetAssetPagination()
    if (field === sortField) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  return {
    typeFilter,
    setTypeFilter,
    sortField,
    sortOrder,
    searchQuery,
    setSearchQuery,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedAssetIds,
    resetAssetPagination,
    collections,
    selectedCollection,
    assetsQuery,
    assets,
    assetTotal,
    nextAssetCursor,
    hasPreviousAssetPage,
    showAssetPagination,
    pageStart,
    pageEnd,
    loading,
    invalidateAssets,
    toggleAssetSelection,
    toggleAllVisibleAssets,
    clearSelection,
    handleNextPage,
    handlePreviousPage,
    filteredAssets,
    selectedAssetIdSet,
    selectedAssets,
    allVisibleSelected,
    handleSort
  }
}

export type MediaAssetBrowser = ReturnType<typeof useMediaAssetBrowser>
