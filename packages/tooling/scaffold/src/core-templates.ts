import type { NameSet } from './names.js'

export const coreDomainFile = (n: NameSet): string => `import * as Schema from 'effect/Schema'

export const ${n.Entity}IdSchema = Schema.String.pipe(Schema.brand('${n.Entity}Id'))
export type ${n.Entity}Id = Schema.Schema.Type<typeof ${n.Entity}IdSchema>
export const ${n.Entities}CollectionName = '${n.pluralSlug}' as const

export const ${n.Entity}Schema = Schema.Struct({
  id: ${n.Entity}IdSchema,
  name: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type ${n.Entity} = Schema.Schema.Type<typeof ${n.Entity}Schema>

export const Create${n.Entity}InputSchema = Schema.Struct({
  name: Schema.String
})

export type Create${n.Entity}Input = Schema.Schema.Type<typeof Create${n.Entity}InputSchema>

export const Update${n.Entity}InputSchema = Schema.Struct({
  id: ${n.Entity}IdSchema,
  name: Schema.optional(Schema.String)
})

export type Update${n.Entity}Input = Schema.Schema.Type<typeof Update${n.Entity}InputSchema>
`

export const corePortFile = (n: NameSet): string => `import type { Effect } from 'effect'
import type { CoreError } from '../../../errors.js'
import type { ${n.Entity}, ${n.Entity}Id, Create${n.Entity}Input, Update${n.Entity}Input } from '../domain/${n.entitySlug}.js'

export const ${n.Entity}RepositoryKind = 'crud' as const

export interface ${n.Entity}StorePort {
  list: () => Effect.Effect<ReadonlyArray<${n.Entity}>, CoreError>
  getById: (id: ${n.Entity}Id) => Effect.Effect<${n.Entity}, CoreError>
  create: (input: Create${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  update: (input: Update${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  remove: (id: ${n.Entity}Id) => Effect.Effect<{ deleted: true }, CoreError>
}
`

export const coreRepositoryFile = (n: NameSet): string => `import { Effect } from 'effect'
import { notFound, type CoreError } from '../../../errors.js'
import type { ${n.Entity}, ${n.Entity}Id, Create${n.Entity}Input, Update${n.Entity}Input } from '../domain/${n.entitySlug}.js'
import type { ${n.Entity}StorePort } from '../ports/${n.entitySlug}-store-port.js'

export interface Make${n.Entity}StoreAdapterOptions {
  now?: () => string
  idFactory?: () => ${n.Entity}Id
}

export const make${n.Entity}StoreAdapter = (
  options: Make${n.Entity}StoreAdapterOptions = {}
): ${n.Entity}StorePort => {
  const records = new Map<string, ${n.Entity}>()
  const now = options.now ?? (() => new Date().toISOString())
  let nextId = 1
  const idFactory = options.idFactory ?? (() => ('${n.entitySlug}-' + String(nextId++)) as ${n.Entity}Id)

  const getExisting = (id: ${n.Entity}Id): Effect.Effect<${n.Entity}, CoreError> => {
    const existing = records.get(id)
    if (!existing) {
      return Effect.fail(notFound('${n.Entity} not found'))
    }
    return Effect.succeed(existing)
  }

  return {
    list: () => Effect.succeed(Array.from(records.values())),
    getById: (id) => getExisting(id),
    create: (input) => {
      const timestamp = now()
      const entity: ${n.Entity} = {
        id: idFactory(),
        name: input.name,
        createdAt: timestamp,
        updatedAt: timestamp
      }

      records.set(entity.id, entity)
      return Effect.succeed(entity)
    },
    update: (input) =>
      Effect.gen(function* () {
        const existing = yield* getExisting(input.id)
        const updated: ${n.Entity} = {
          ...existing,
          name: input.name ?? existing.name,
          updatedAt: now()
        }

        records.set(updated.id, updated)
        return updated
      }),
    remove: (id) =>
      Effect.gen(function* () {
        yield* getExisting(id)
        records.delete(id)
        return { deleted: true as const }
      })
  }
}
`

export const coreServiceFile = (n: NameSet): string => `import { Context, Effect, Layer } from 'effect'
import type { CoreError } from '../../../errors.js'
import type { ${n.Entity}, ${n.Entity}Id, Create${n.Entity}Input, Update${n.Entity}Input } from '../domain/${n.entitySlug}.js'
import type { ${n.Entity}StorePort } from '../ports/${n.entitySlug}-store-port.js'

export interface ${n.Entity}ServiceContract {
  list: () => Effect.Effect<ReadonlyArray<${n.Entity}>, CoreError>
  getById: (id: ${n.Entity}Id) => Effect.Effect<${n.Entity}, CoreError>
  create: (input: Create${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  update: (input: Update${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  remove: (id: ${n.Entity}Id) => Effect.Effect<{ deleted: true }, CoreError>
}

export class ${n.Entity}Service extends Context.Tag('${n.Entity}Service')<${n.Entity}Service, ${n.Entity}ServiceContract>() {}

export interface Make${n.Entity}ServiceOptions {
  store: ${n.Entity}StorePort
}

export const make${n.Entity}Service = (options: Make${n.Entity}ServiceOptions): ${n.Entity}ServiceContract => ({
  list: () => options.store.list(),
  getById: (id) => options.store.getById(id),
  create: (input) => options.store.create(input),
  update: (input) => options.store.update(input),
  remove: (id) => options.store.remove(id)
})

export const ${n.Entity}ServiceLive = (options: Make${n.Entity}ServiceOptions) =>
  Layer.succeed(${n.Entity}Service, make${n.Entity}Service(options))
`

export const coreRuntimeFile = (n: NameSet): string => `import { make${n.Entity}StoreAdapter } from '../adapters/${n.entitySlug}-store-adapter.js'
import { ${n.Entity}ServiceLive } from '../application/${n.entitySlug}-service.js'

export const ${n.Entity}DomainLive = ${n.Entity}ServiceLive({
  store: make${n.Entity}StoreAdapter()
})
`

export const coreServiceTestFile = (n: NameSet): string => `import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { make${n.Entity}StoreAdapter } from '../adapters/${n.entitySlug}-store-adapter.js'
import { make${n.Entity}Service } from '../application/${n.entitySlug}-service.js'

describe('${n.Entity}Service', () => {
  it('runs create -> list -> getById -> update -> remove CRUD flow', async () => {
    const store = make${n.Entity}StoreAdapter({
      now: () => '2026-01-01T00:00:00.000Z'
    })

    const service = make${n.Entity}Service({ store })

    const created = await Effect.runPromise(service.create({ name: '${n.Entity} Name' }))
    expect(created.name).toBe('${n.Entity} Name')

    const listed = await Effect.runPromise(service.list())
    expect(listed).toHaveLength(1)

    const found = await Effect.runPromise(service.getById(created.id))
    expect(found.id).toBe(created.id)

    const updated = await Effect.runPromise(service.update({ id: created.id, name: '${n.Entity} Updated' }))
    expect(updated.name).toBe('${n.Entity} Updated')

    const removed = await Effect.runPromise(service.remove(created.id))
    expect(removed.deleted).toBe(true)

    const afterDelete = await Effect.runPromise(service.list())
    expect(afterDelete).toHaveLength(0)
  })
})
`

export const domainRootIndexFile = (): string => `export * from './domain/index.js'
export * from './ports/index.js'
export * from './application/index.js'
export * from './adapters/index.js'
export * from './runtime/index.js'
`
