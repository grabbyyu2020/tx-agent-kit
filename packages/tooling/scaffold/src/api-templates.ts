import type { NameSet } from './names.js'

export const apiDomainFile = (n: NameSet): string => `import * as Schema from 'effect/Schema'

export const ${n.Entity}RouteIdSchema = Schema.Struct({
  id: Schema.String
})

export type ${n.Entity}RouteId = Schema.Schema.Type<typeof ${n.Entity}RouteIdSchema>

export const ${n.Entity}CreateRouteSchema = Schema.Struct({
  name: Schema.String
})

export type ${n.Entity}CreateRoute = Schema.Schema.Type<typeof ${n.Entity}CreateRouteSchema>

export const ${n.Entity}UpdateRouteSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String)
})

export type ${n.Entity}UpdateRoute = Schema.Schema.Type<typeof ${n.Entity}UpdateRouteSchema>
`

export const apiPortFile = (n: NameSet): string => `import type { Effect } from 'effect'
import type { CoreError } from '@tx-agent-kit/core'
import type { ${n.Entity}, ${n.Entity}Id, Create${n.Entity}Input, Update${n.Entity}Input } from '@tx-agent-kit/core'

export interface ${n.Entity}RoutePort {
  list: () => Effect.Effect<ReadonlyArray<${n.Entity}>, CoreError>
  getById: (id: ${n.Entity}Id) => Effect.Effect<${n.Entity}, CoreError>
  create: (input: Create${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  update: (input: Update${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  remove: (id: ${n.Entity}Id) => Effect.Effect<{ deleted: true }, CoreError>
}
`

export const apiRepositoryFile = (n: NameSet): string => `import type { ${n.Entity}ServiceContract } from '@tx-agent-kit/core'
import type { ${n.Entity}RoutePort } from '../ports/${n.entitySlug}-route-port.js'

export interface Make${n.Entity}ServiceAdapterOptions {
  service: ${n.Entity}ServiceContract
}

export const make${n.Entity}ServiceAdapter = (options: Make${n.Entity}ServiceAdapterOptions): ${n.Entity}RoutePort => ({
  list: () => options.service.list(),
  getById: (id) => options.service.getById(id),
  create: (input) => options.service.create(input),
  update: (input) => options.service.update(input),
  remove: (id) => options.service.remove(id)
})
`

export const apiServiceFile = (n: NameSet): string => `import type { ${n.Entity}RoutePort } from '../ports/${n.entitySlug}-route-port.js'

export interface ${n.Entity}RouteServiceContract extends ${n.Entity}RoutePort {}

export interface Make${n.Entity}RouteServiceOptions {
  routes: ${n.Entity}RoutePort
}

export const make${n.Entity}RouteService = (options: Make${n.Entity}RouteServiceOptions): ${n.Entity}RouteServiceContract => ({
  list: () => options.routes.list(),
  getById: (id) => options.routes.getById(id),
  create: (input) => options.routes.create(input),
  update: (input) => options.routes.update(input),
  remove: (id) => options.routes.remove(id)
})
`

export const apiRoutesFile = (n: NameSet): string => `import type {
  Create${n.Entity}Input,
  ${n.Entity}Id,
  Update${n.Entity}Input
} from '@tx-agent-kit/core'
import type { ${n.Entity}RouteServiceContract } from '../application/${n.entitySlug}-route-service.js'

export interface Make${n.Entity}RoutesOptions {
  service: ${n.Entity}RouteServiceContract
}

export const ${n.Entity}RoutesPath = '/${n.pluralSlug}' as const
export const ${n.Entity}RouteKind = 'crud' as const

export const make${n.Entity}Routes = (options: Make${n.Entity}RoutesOptions) => ({
  list: () => options.service.list(),
  getById: (id: ${n.Entity}Id) => options.service.getById(id),
  create: (payload: Create${n.Entity}Input) => options.service.create(payload),
  update: (payload: Update${n.Entity}Input) => options.service.update(payload),
  remove: (id: ${n.Entity}Id) => options.service.remove(id)
})
`

export const apiRoutesTestFile = (n: NameSet): string => `import { ${n.Entity}IdSchema } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { make${n.Entity}Routes } from '../routes/${n.entitySlug}.js'

describe('${n.Entity} routes scaffold', () => {
  it('delegates CRUD calls to the service layer', async () => {
    const routes = make${n.Entity}Routes({
      service: {
        list: () => Effect.succeed([]),
        getById: () => Effect.dieMessage('not-used'),
        create: () => Effect.dieMessage('not-used'),
        update: () => Effect.dieMessage('not-used'),
        remove: () => Effect.succeed({ deleted: true as const })
      }
    })

    const id = Schema.decodeUnknownSync(${n.Entity}IdSchema)('id-1')
    const removed = await Effect.runPromise(routes.remove(id))
    expect(removed.deleted).toBe(true)
  })
})
`

export const apiDomainRootIndexFile = (): string => `export * from './domain/index.js'
export * from './ports/index.js'
export * from './application/index.js'
export * from './adapters/index.js'
export * from './routes/index.js'
`
