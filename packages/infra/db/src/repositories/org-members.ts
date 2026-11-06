import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL
} from 'drizzle-orm'
import { type OrgMemberRole } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { buildCursorCondition, buildCursorPage } from '../pagination.js'
import { orgMemberRowSchema, orgMemberWithUserRowSchema, type OrgMemberWithUserRowShape } from '../effect-schemas/org-members.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { orgMembers, users } from '../schema.js'
import type { ListParams } from './list-params.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder, parseCountValue } from './sql-helpers.js'

const decodeMember = createOptionalDecoder(orgMemberRowSchema, 'org member row')

const orgMemberSelectColumns = {
  id: orgMembers.id,
  organizationId: orgMembers.organizationId,
  userId: orgMembers.userId,
  roleId: orgMembers.roleId,
  role: orgMembers.role,
  membershipType: orgMembers.membershipType,
  disabledAt: orgMembers.disabledAt,
  createdAt: orgMembers.createdAt,
  updatedAt: orgMembers.updatedAt
} as const

export const orgMembersRepository = {
  isMember: (organizationId: string, userId: string) =>
    withDb('Failed to check organization membership', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: orgMembers.id })
          .from(orgMembers)
          .where(and(
            eq(orgMembers.organizationId, organizationId),
            eq(orgMembers.userId, userId)
          ))
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ),

  getMemberRole: (organizationId: string, userId: string) =>
    withDb('Failed to get member role', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(orgMemberSelectColumns)
          .from(orgMembers)
          .where(and(
            eq(orgMembers.organizationId, organizationId),
            eq(orgMembers.userId, userId)
          ))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  getPrimaryMembershipForUser: (userId: string) =>
    withDb('Failed to get primary org membership for user', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated (user-scoped lookup, not tenant-scoped)
        const rows = yield* db
          .select(orgMemberSelectColumns)
          .from(orgMembers)
          .where(eq(orgMembers.userId, userId))
          .orderBy(desc(orgMembers.createdAt), desc(orgMembers.id))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  getMemberRolesForUser: (userId: string, organizationIds: ReadonlyArray<string>) =>
    withDb('Failed to get member roles for user', (db) =>
      Effect.gen(function* () {
        if (organizationIds.length === 0) {
          return [] as const
        }

        const decodeOrgMemberRows = Schema.decodeUnknown(Schema.Array(orgMemberRowSchema))

        const rows = yield* db
          .select(orgMemberSelectColumns)
          .from(orgMembers)
          .where(and(
            eq(orgMembers.userId, userId),
            inArray(orgMembers.organizationId, [...organizationIds])
          ))
          .execute()

        return yield* decodeOrgMemberRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('org member list decode failed', error))
        )
      })
    ),

  countActiveAdmins: (organizationId: string) =>
    withDb('Failed to count active admins', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ count: count() })
          .from(orgMembers)
          .where(and(
            eq(orgMembers.organizationId, organizationId),
            eq(orgMembers.role, 'admin' as OrgMemberRole),
            isNull(orgMembers.disabledAt)
          ))
          .execute()

        return parseCountValue(rows[0]?.count)
      })
    ),

  disableMember: (id: string) =>
    withDb('Failed to disable org member', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(orgMembers)
          .set({ disabledAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(orgMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  enableMember: (id: string) =>
    withDb('Failed to enable org member', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(orgMembers)
          .set({ disabledAt: null, updatedAt: sql`now()` })
          .where(eq(orgMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  listMembers: (organizationId: string, params: ListParams) =>
    withDb('Failed to list org members', (db) =>
      Effect.gen(function* () {
        const sortOrder = params.sortOrder
        const baseWhere: SQL = eq(orgMembers.organizationId, organizationId)
        const decodeOrgMemberWithUserRows = Schema.decodeUnknown(Schema.Array(orgMemberWithUserRowSchema))

        const page = yield* buildCursorPage<OrgMemberWithUserRowShape>({
          cursor: params.cursor,
          limit: params.limit,
          sortBy: 'createdAt',
          sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              const rows = yield* db
                .select({ count: count() })
                .from(orgMembers)
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count org members', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              const cursorWhere = buildCursorCondition(cursor, sortOrder, orgMembers.createdAt, cursor ? new Date(cursor.sortValue) : new Date(), orgMembers.id)

              const rows = yield* db
                .select({
                  id: orgMembers.id,
                  organizationId: orgMembers.organizationId,
                  userId: orgMembers.userId,
                  roleId: orgMembers.roleId,
                  role: orgMembers.role,
                  membershipType: orgMembers.membershipType,
                  disabledAt: orgMembers.disabledAt,
                  userName: users.name,
                  userEmail: users.email,
                  createdAt: orgMembers.createdAt,
                  updatedAt: orgMembers.updatedAt
                })
                .from(orgMembers)
                .leftJoin(users, eq(orgMembers.userId, users.id))
                .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                .orderBy(
                  sortOrder === 'asc' ? asc(orgMembers.createdAt) : desc(orgMembers.createdAt),
                  sortOrder === 'asc' ? asc(orgMembers.id) : desc(orgMembers.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeOrgMemberWithUserRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('org member list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list org members', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => row.createdAt.toISOString()
        })

        return {
          data: page.data,
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    ),

  getMemberById: (id: string) =>
    withDb('Failed to get org member by id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .select(orgMemberSelectColumns)
          .from(orgMembers)
          .where(eq(orgMembers.id, id))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  addMember: (input: { organizationId: string; userId: string; role: OrgMemberRole }) =>
    withDb('Failed to add org member', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .insert(orgMembers)
          .values({
            organizationId: input.organizationId,
            userId: input.userId,
            role: input.role
          })
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  updateMemberRole: (id: string, role: OrgMemberRole) =>
    withDb('Failed to update org member role', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(orgMembers)
          .set({ role, updatedAt: sql`now()` })
          .where(eq(orgMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  removeMember: (id: string) =>
    withDb('Failed to remove org member', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        yield* db
          .delete(orgMembers)
          .where(eq(orgMembers.id, id))
          .execute()

        return { deleted: true as const }
      })
    )
}
