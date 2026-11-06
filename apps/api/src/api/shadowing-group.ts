import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'
import {
  importShadowingVideoBodySchema,
  importShadowingVideoResponseSchema,
  saveShadowingProgressBodySchema,
  shadowingPrioritizeResponseSchema,
  shadowingProgressResponseSchema,
  shadowingSentenceSchema,
  shadowingVideoDetailSchema,
  shadowingVideoListResponseSchema,
  shadowingVideoSummarySchema
} from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'
import { DeletedResponse } from './shared-schemas.js'

// --- Shadowing domain ---

const ShadowingVideoIdParam = HttpApiSchema.param('videoId', Schema.String)
const ShadowingSentenceIndexParam = HttpApiSchema.param(
  'sentenceIndex',
  Schema.NumberFromString.pipe(
    Schema.int(),
    Schema.nonNegative(),
    Schema.annotations({ jsonSchema: { type: 'integer', minimum: 0 } })
  )
)

export const ShadowingGroup = HttpApiGroup.make('shadowing')
  .add(
    HttpApiEndpoint.post('importVideo', '/v1/shadowing/videos')
      .setPayload(importShadowingVideoBodySchema)
      .addSuccess(importShadowingVideoResponseSchema)
  )
  .add(
    HttpApiEndpoint.get('listVideos', '/v1/shadowing/videos')
      .addSuccess(shadowingVideoListResponseSchema)
  )
  .add(
    HttpApiEndpoint.get('getVideo')`/v1/shadowing/videos/${ShadowingVideoIdParam}`
      .addSuccess(shadowingVideoDetailSchema)
  )
  .add(
    HttpApiEndpoint.del('deleteVideo')`/v1/shadowing/videos/${ShadowingVideoIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.post('retryImport')`/v1/shadowing/videos/${ShadowingVideoIdParam}/retry`
      .addSuccess(shadowingVideoSummarySchema, { status: 202 })
  )
  .add(
    HttpApiEndpoint.put('saveProgress')`/v1/shadowing/videos/${ShadowingVideoIdParam}/progress`
      .setPayload(saveShadowingProgressBodySchema)
      .addSuccess(shadowingProgressResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('prioritizeSentence')`/v1/shadowing/videos/${ShadowingVideoIdParam}/sentences/${ShadowingSentenceIndexParam}/prioritize`
      .addSuccess(shadowingPrioritizeResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('regenerateExplanation')`/v1/shadowing/videos/${ShadowingVideoIdParam}/sentences/${ShadowingSentenceIndexParam}/regenerate`
      .addSuccess(shadowingSentenceSchema, { status: 202 })
  )
