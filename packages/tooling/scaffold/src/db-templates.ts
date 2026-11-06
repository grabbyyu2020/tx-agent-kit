import type { DbNameSet, NameSet } from './names.js'

export const dbEffectSchemaFile = (n: NameSet): string => `import * as Schema from 'effect/Schema'

export const ${n.entity}RowSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type ${n.Entity}RowShape = Schema.Schema.Type<typeof ${n.entity}RowSchema>
`

export const dbFactoryFile = (n: NameSet, db: DbNameSet): string => `import type { ${db.tableConst} } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type ${n.Domain}${n.Entity}Insert = typeof ${db.tableConst}.$inferInsert

export interface Create${n.Domain}${n.Entity}FactoryOptions {
  id?: string
  name?: string
  createdAt?: Date
  updatedAt?: Date
}

export const create${n.Domain}${n.Entity}Factory = (
  options: Create${n.Domain}${n.Entity}FactoryOptions = {}
): ${n.Domain}${n.Entity}Insert => {
  const createdAt = options.createdAt ?? generateTimestamp()
  return {
    id: options.id ?? generateId(),
    name: options.name ?? generateUniqueValue('${n.Domain}${n.Entity}'),
    createdAt,
    updatedAt: options.updatedAt ?? createdAt
  }
}
`

export const dbRepositoryFile = (n: NameSet, db: DbNameSet): string => `import { eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { ${n.entity}RowSchema, type ${n.Entity}RowShape } from '../effect-schemas/${db.tableFileSlug}.js'
import { dbDecodeFailed, dbQueryFailed, toDbError, type DbError } from '../errors.js'
import { ${db.tableConst} } from '../schema.js'

const decode${n.Entity}Rows = Schema.decodeUnknown(Schema.Array(${n.entity}RowSchema))
const decode${n.Entity}Row = Schema.decodeUnknown(${n.entity}RowSchema)

const decodeNullable${n.Entity} = (
  value: unknown
): Effect.Effect<${n.Entity}RowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decode${n.Entity}Row(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('${n.Domain}${n.Entity} row decode failed', error))
  )
}

export const ${n.entity}DbRepository = {
  list: () =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db.select().from(${db.tableConst}).execute()
        return yield* decode${n.Entity}Rows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('${n.Domain}${n.Entity} list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list ${n.Domain}${n.Entity} rows', error))),

  getById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db.select().from(${db.tableConst}).where(eq(${db.tableConst}.id, id)).limit(1).execute()
        return yield* decodeNullable${n.Entity}(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get ${n.Domain}${n.Entity} row by id', error))),

  create: (input: { name: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(${db.tableConst})
          .values({ name: input.name })
          .returning()
          .execute()
        return yield* decodeNullable${n.Entity}(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create ${n.Domain}${n.Entity} row', error))),

  update: (input: { id: string; name?: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: {
          name?: string
          updatedAt: Date
        } = {
          updatedAt: new Date()
        }

        if (input.name !== undefined) {
          patch.name = input.name
        }

        const rows = yield* db
          .update(${db.tableConst})
          .set(patch)
          .where(eq(${db.tableConst}.id, input.id))
          .returning()
          .execute()
        return yield* decodeNullable${n.Entity}(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update ${n.Domain}${n.Entity} row', error))),

  remove: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db.delete(${db.tableConst}).where(eq(${db.tableConst}.id, id)).returning().execute()
        const deleted = yield* decodeNullable${n.Entity}(rows[0] ?? null)
        if (!deleted) {
          return yield* Effect.fail(dbQueryFailed('${n.Domain}${n.Entity} row not found', new Error(id)))
        }

        return { deleted: true as const }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete ${n.Domain}${n.Entity} row', error)))
}
`
