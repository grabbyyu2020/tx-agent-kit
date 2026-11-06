'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { FolderPlus, Folders, Plus, Trash2, X } from 'lucide-react'
import { DashboardShell } from '../../../../../../components/DashboardShell'
import { useCurrentPrincipal } from '../../../../../../hooks/use-session-store'
import { MediaAddToCollectionDialogs } from '@/components/media/MediaAddToCollectionDialogs'
import { MediaAssetDeleteDialogs } from '@/components/media/MediaAssetDeleteDialogs'
import { MediaAssetGrid } from '@/components/media/MediaAssetGrid'
import { MediaAssetTable } from '@/components/media/MediaAssetTable'
import { MediaCollectionsDialogs } from '@/components/media/MediaCollectionsDialogs'
import { MediaUploadDialog } from '@/components/media/MediaUploadDialog'
import type { AssetTypeFilter, ViewMode } from '@/components/media/mediaLibrary'
import { useMediaAssetActions } from '@/components/media/useMediaAssetActions'
import { useMediaAssetBrowser } from '@/components/media/useMediaAssetBrowser'
import { PermissionsGate } from '@/components/PermissionsGate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function MediaPage() {
  const params = useParams<{ orgId: string; teamId: string }>()
  const { orgId, teamId } = params
  const principal = useCurrentPrincipal()

  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [showCollectionsManager, setShowCollectionsManager] = useState(false)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const browser = useMediaAssetBrowser(teamId)
  const actions = useMediaAssetActions({ teamId, browser, setError })
  const {
    typeFilter,
    setTypeFilter,
    searchQuery,
    setSearchQuery,
    selectedCollectionId,
    setSelectedCollectionId,
    resetAssetPagination,
    collections,
    selectedCollection,
    assets,
    assetTotal,
    nextAssetCursor,
    hasPreviousAssetPage,
    showAssetPagination,
    pageStart,
    pageEnd,
    loading,
    invalidateAssets,
    clearSelection,
    handleNextPage,
    handlePreviousPage,
    filteredAssets,
    selectedAssets
  } = browser
  const {
    openBulkAddDialog,
    handleBulkRemoveFromCollection,
    bulkRemovingFromCollection,
    setShowBulkDeleteDialog
  } = actions

  return (
    <DashboardShell
      title="Media"
      subtitle="Manage your team's media assets."
      principalEmail={principal?.email}
      orgId={orgId}
      teamId={teamId}
    >
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border" role="group" aria-label="View mode">
              <Button
                variant={viewMode === 'card' ? 'default' : 'ghost'}
                size="sm"
                className="rounded-r-none"
                onClick={() => setViewMode('card')}
                aria-pressed={viewMode === 'card'}
              >
                Cards
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                className="rounded-l-none"
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
              >
                List
              </Button>
            </div>
            <Input
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                resetAssetPagination()
              }}
              className="w-full sm:w-64"
              aria-label="Search assets"
            />
            <select
              value={selectedCollectionId}
              onChange={(e) => {
                setSelectedCollectionId(e.target.value)
                resetAssetPagination()
              }}
              className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Filter by collection"
            >
              <option value="all">All media</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>{collection.name}</option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as AssetTypeFilter)
                resetAssetPagination()
              }}
              className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Filter by type"
            >
              <option value="all">All types</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="audio">Audio</option>
              <option value="gif">GIFs</option>
              <option value="document">Documents</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PermissionsGate permission="manage_assets">
              <Button size="lg" variant="outline" onClick={() => setShowCollectionsManager(true)}>
                <Folders aria-hidden="true" />
                Collections
              </Button>
            </PermissionsGate>
            <PermissionsGate permission="upload_assets">
              <Button size="lg" onClick={() => setShowUploadDialog(true)}>
                <Plus aria-hidden="true" />
                Upload Asset
              </Button>
            </PermissionsGate>
          </div>
        </div>

        {selectedAssets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <span className="text-sm font-medium">{selectedAssets.length} selected</span>
            <PermissionsGate permission="manage_assets">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openBulkAddDialog}
                disabled={collections.length === 0}
              >
                <FolderPlus aria-hidden="true" />
                Add to collection
              </Button>
              {selectedCollection && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { void handleBulkRemoveFromCollection() }}
                  disabled={bulkRemovingFromCollection}
                >
                  <X aria-hidden="true" />
                  {bulkRemovingFromCollection ? 'Removing...' : 'Remove from collection'}
                </Button>
              )}
            </PermissionsGate>
            <PermissionsGate permission="delete_assets">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setShowBulkDeleteDialog(true)}
              >
                <Trash2 aria-hidden="true" />
                Delete selected
              </Button>
            </PermissionsGate>
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        )}

        {/* Error */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Loading */}
        {loading && assets.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredAssets.length === 0 && !error && (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">
              {assets.length === 0 ? 'No assets yet. Upload your first file to get started.' : 'No assets match your filters.'}
            </p>
          </div>
        )}

        {/* Card View */}
        {viewMode === 'card' && filteredAssets.length > 0 && (
          <MediaAssetGrid teamId={teamId} browser={browser} actions={actions} />
        )}

        {/* List View */}
        {viewMode === 'list' && filteredAssets.length > 0 && (
          <MediaAssetTable teamId={teamId} browser={browser} actions={actions} />
        )}

        {showAssetPagination && (
          <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Showing {pageStart}-{pageEnd} of {assetTotal}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePreviousPage}
                disabled={!hasPreviousAssetPage || loading}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={!nextAssetCursor || loading}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <MediaAssetDeleteDialogs browser={browser} actions={actions} />

      <MediaCollectionsDialogs
        teamId={teamId}
        browser={browser}
        showCollectionsManager={showCollectionsManager}
        setShowCollectionsManager={setShowCollectionsManager}
        setError={setError}
      />

      <MediaAddToCollectionDialogs browser={browser} actions={actions} />

      {/* Upload dialog */}
      <MediaUploadDialog
        teamId={teamId}
        showUploadDialog={showUploadDialog}
        setShowUploadDialog={setShowUploadDialog}
        resetAssetPagination={resetAssetPagination}
        invalidateAssets={invalidateAssets}
        setError={setError}
      />
    </DashboardShell>
  )
}
