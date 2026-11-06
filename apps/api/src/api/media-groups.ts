import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'
import {
  addAssetToCollectionBodySchema,
  assetSearchParamsSchema,
  assetSignedUrlResponseSchema,
  assetThumbnailSignedUrlResponseSchema,
  assetsListParamsSchema,
  collectionsListParamsSchema,
  confirmUploadResponseSchema,
  createCollectionBodySchema,
  listAssetsResponseSchema,
  listCollectionAssetsResponseSchema,
  listCollectionsResponseSchema,
  mediaAssetSchema,
  uploadContentResponseSchema,
  requestUploadBodySchema,
  requestUploadResponseSchema,
  updateAssetMetadataBodySchema,
  updateCollectionBodySchema,
  deleteObjectBodySchema,
  generateDownloadUrlBodySchema,
  generateUploadUrlBodySchema,
  listObjectsParamsSchema,
  listObjectsResponseSchema,
  objectMetadataResponseSchema,
  presignedUrlResponseSchema
} from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'
import { DeletedResponse, TeamIdParam } from './shared-schemas.js'

const GenerateUploadUrlBody = generateUploadUrlBodySchema
const GenerateDownloadUrlBody = generateDownloadUrlBodySchema
const DeleteObjectBody = deleteObjectBodySchema
const ListObjectsParams = listObjectsParamsSchema
const PresignedUrlResponse = presignedUrlResponseSchema
const ListObjectsResponse = listObjectsResponseSchema
const ObjectMetadataResponse = objectMetadataResponseSchema
const ObjectKeyParam = HttpApiSchema.param('key', Schema.String)

// --- Assets domain aliases ---
const RequestUploadBody = requestUploadBodySchema
const RequestUploadResponse = requestUploadResponseSchema
const UploadContentResponse = uploadContentResponseSchema
const ConfirmUploadResponse = confirmUploadResponseSchema
const MediaAsset = mediaAssetSchema
const AssetsResponse = listAssetsResponseSchema
const AssetsListParams = assetsListParamsSchema
const AssetSearchParams = assetSearchParamsSchema
const AssetSignedUrlResponse = assetSignedUrlResponseSchema
const AssetThumbnailSignedUrlResponse = assetThumbnailSignedUrlResponseSchema
const UpdateAssetMetadataBody = updateAssetMetadataBodySchema
const CollectionsResponse = listCollectionsResponseSchema
const CollectionAssetsResponse = listCollectionAssetsResponseSchema
const CollectionsListParams = collectionsListParamsSchema
const CreateCollectionBody = createCollectionBodySchema
const UpdateCollectionBody = updateCollectionBodySchema
const AddAssetToCollectionBody = addAssetToCollectionBodySchema

const AssetIdParam = HttpApiSchema.param('assetId', Schema.String)
const UploadIdParam = HttpApiSchema.param('uploadId', Schema.String)
const CollectionIdParam = HttpApiSchema.param('collectionId', Schema.String)

export const StorageGroup = HttpApiGroup.make('storage')
  .add(
    HttpApiEndpoint.post('generateUploadUrl', '/v1/storage/upload-url')
      .setPayload(GenerateUploadUrlBody)
      .addSuccess(PresignedUrlResponse)
  )
  .add(
    HttpApiEndpoint.post('generateDownloadUrl', '/v1/storage/download-url')
      .setPayload(GenerateDownloadUrlBody)
      .addSuccess(PresignedUrlResponse)
  )
  .add(
    HttpApiEndpoint.post('deleteObject', '/v1/storage/delete')
      .setPayload(DeleteObjectBody)
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.get('listObjects', '/v1/storage/objects')
      .setUrlParams(ListObjectsParams)
      .addSuccess(ListObjectsResponse)
  )
  .add(
    HttpApiEndpoint.get('getObjectMetadata')`/v1/storage/objects/${ObjectKeyParam}/metadata`
      .addSuccess(ObjectMetadataResponse)
  )

export const AssetsGroup = HttpApiGroup.make('assets')
  .add(
    HttpApiEndpoint.post('requestUpload')`/v1/teams/${TeamIdParam}/uploads/request`
      .setPayload(RequestUploadBody)
      .addSuccess(RequestUploadResponse, { status: 201 })
  )
  .add(
    HttpApiEndpoint.put('uploadContent')`/v1/teams/${TeamIdParam}/uploads/${UploadIdParam}/content`
      .addSuccess(UploadContentResponse)
  )
  .add(
    HttpApiEndpoint.post('confirmUpload')`/v1/teams/${TeamIdParam}/uploads/${UploadIdParam}/confirm`
      .addSuccess(ConfirmUploadResponse)
  )
  .add(
    HttpApiEndpoint.get('listAssets')`/v1/teams/${TeamIdParam}/assets`
      .setUrlParams(AssetsListParams)
      .addSuccess(AssetsResponse)
  )
  .add(
    HttpApiEndpoint.get('getAsset')`/v1/teams/${TeamIdParam}/assets/${AssetIdParam}`
      .addSuccess(MediaAsset)
  )
  .add(
    HttpApiEndpoint.patch('updateAssetMetadata')`/v1/teams/${TeamIdParam}/assets/${AssetIdParam}`
      .setPayload(UpdateAssetMetadataBody)
      .addSuccess(MediaAsset)
  )
  .add(
    HttpApiEndpoint.del('softDeleteAsset')`/v1/teams/${TeamIdParam}/assets/${AssetIdParam}`
      .addSuccess(MediaAsset)
  )
  .add(
    HttpApiEndpoint.get('getAssetSignedUrl')`/v1/teams/${TeamIdParam}/assets/${AssetIdParam}/url`
      .addSuccess(AssetSignedUrlResponse)
  )
  .add(
    HttpApiEndpoint.get('getAssetThumbnailSignedUrl')`/v1/teams/${TeamIdParam}/assets/${AssetIdParam}/thumbnail-url`
      .addSuccess(AssetThumbnailSignedUrlResponse)
  )
  .add(
    HttpApiEndpoint.get('searchAssets')`/v1/teams/${TeamIdParam}/assets/search`
      .setUrlParams(AssetSearchParams)
      .addSuccess(AssetsResponse)
  )
  .add(
    HttpApiEndpoint.get('listCollections')`/v1/teams/${TeamIdParam}/collections`
      .setUrlParams(CollectionsListParams)
      .addSuccess(CollectionsResponse)
  )
  .add(
    HttpApiEndpoint.post('createCollection')`/v1/teams/${TeamIdParam}/collections`
      .setPayload(CreateCollectionBody)
      .addSuccess(Schema.Struct({ id: Schema.UUID, teamId: Schema.UUID, name: Schema.String, description: Schema.NullOr(Schema.String), createdAt: Schema.String, updatedAt: Schema.String }), { status: 201 })
  )
  .add(
    HttpApiEndpoint.patch('updateCollection')`/v1/teams/${TeamIdParam}/collections/${CollectionIdParam}`
      .setPayload(UpdateCollectionBody)
      .addSuccess(Schema.Struct({ id: Schema.UUID, teamId: Schema.UUID, name: Schema.String, description: Schema.NullOr(Schema.String), createdAt: Schema.String, updatedAt: Schema.String }))
  )
  .add(
    HttpApiEndpoint.del('removeCollection')`/v1/teams/${TeamIdParam}/collections/${CollectionIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.get('listCollectionAssets')`/v1/teams/${TeamIdParam}/collections/${CollectionIdParam}/assets`
      .setUrlParams(AssetsListParams)
      .addSuccess(CollectionAssetsResponse)
  )
  .add(
    HttpApiEndpoint.post('addAssetToCollection')`/v1/teams/${TeamIdParam}/collections/${CollectionIdParam}/assets`
      .setPayload(AddAssetToCollectionBody)
      .addSuccess(DeletedResponse, { status: 201 })
  )
  .add(
    HttpApiEndpoint.del('removeAssetFromCollection')`/v1/teams/${TeamIdParam}/collections/${CollectionIdParam}/assets/${AssetIdParam}`
      .addSuccess(DeletedResponse)
  )
