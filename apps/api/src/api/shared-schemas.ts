import { HttpApiSchema } from '@effect/platform'
import { deletedResponseSchema } from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'

// Path params and responses used by more than one group module in this directory.
export const OrganizationIdParam = HttpApiSchema.param('organizationId', Schema.String)
export const TeamIdParam = HttpApiSchema.param('teamId', Schema.String)

export const DeletedResponse = deletedResponseSchema
