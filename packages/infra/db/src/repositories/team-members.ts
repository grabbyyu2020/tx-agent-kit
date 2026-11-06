import {
  and,
  asc,
  count,
  desc,
  eq,
  sql,
  type SQL
} from 'drizzle-orm'
import type { MemberRole } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { buildCursorCondition, buildCursorPage } from '../pagination.js'
import { teamMemberRowSchema, type TeamMemberRowShape } from '../effect-schemas/team-members.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { teamMembers } from '../schema.js'
import type { ListParams } from './list-params.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder, parseCountValue } from './sql-helpers.js'

const decodeMemberRows = Schema.decodeUnknown(Schema.Array(teamMemberRowSchema))
const decodeMember = createOptionalDecoder(teamMemberRowSchema, 'team member row')

export const teamMembersRepository = {
  addMember: (input: { teamId: string; userId: string; role?: MemberRole }) =>
    withDb('Failed to add team member', (db) =>
      Effect.gen(function* () {
        const values: { teamId: string; userId: string; role?: MemberRole } = {
          teamId: input.teamId,
          userId: input.userId
        }
        if (input.role) {
          values.role = input.role
        }

        // When a role is specified, use onConflictDoUpdate to promote existing members
        // (e.g., trigger adds as 'member', then service promotes to 'admin')
        const rows = input.role
          ? yield* db
              .insert(teamMembers)
              .values(values)
              .onConflictDoUpdate({
                target: [teamMembers.teamId, teamMembers.userId],
                set: { role: input.role, updatedAt: sql`now()` }
              })
              .returning()
              .execute()
          : yield* db
              .insert(teamMembers)
              .values(values)
              .onConflictDoNothing({ target: [teamMembers.teamId, teamMembers.userId] })
              .returning()
              .execute()

        // If conflict with no role specified, fetch the existing row
        if (rows.length === 0) {
          const existing = yield* db
            .select({
              id: teamMembers.id,
              teamId: teamMembers.teamId,
              userId: teamMembers.userId,
              roleId: teamMembers.roleId,
              role: teamMembers.role,
              disabledAt: teamMembers.disabledAt,
              createdAt: teamMembers.createdAt,
              updatedAt: teamMembers.updatedAt
            })
            .from(teamMembers)
            .where(and(
              eq(teamMembers.teamId, input.teamId),
              eq(teamMembers.userId, input.userId)
            ))
            .limit(1)
            .execute()

          return yield* decodeFirst(existing, decodeMember)
        }

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  removeMember: (teamId: string, userId: string) =>
    withDb('Failed to remove team member', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(teamMembers)
          .where(and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          ))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  listMembers: (teamId: string, params: ListParams) =>
    withDb('Failed to list team members', (db) =>
      Effect.gen(function* () {
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere: SQL = eq(teamMembers.teamId, teamId)

        const page = yield* buildCursorPage<TeamMemberRowShape>({
          cursor: params.cursor,
          limit: params.limit,
          sortBy,
          sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              const rows = yield* db
                .select({
                  count: count()
                })
                .from(teamMembers)
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count team members', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              const cursorWhere = buildCursorCondition(cursor, sortOrder, teamMembers.createdAt, cursor ? new Date(cursor.sortValue) : new Date(), teamMembers.id)

              const rows = yield* db
                .select({
                  id: teamMembers.id,
                  teamId: teamMembers.teamId,
                  userId: teamMembers.userId,
                  roleId: teamMembers.roleId,
                  role: teamMembers.role,
                  disabledAt: teamMembers.disabledAt,
                  createdAt: teamMembers.createdAt,
                  updatedAt: teamMembers.updatedAt
                })
                .from(teamMembers)
                .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                .orderBy(
                  sortOrder === 'asc' ? asc(teamMembers.createdAt) : desc(teamMembers.createdAt),
                  sortOrder === 'asc' ? asc(teamMembers.id) : desc(teamMembers.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeMemberRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('team member list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list team members', error))),
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

  getMemberByTeamAndUser: (teamId: string, userId: string) =>
    withDb('Failed to get team member by team and user', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            id: teamMembers.id,
            teamId: teamMembers.teamId,
            userId: teamMembers.userId,
            roleId: teamMembers.roleId,
            role: teamMembers.role,
            disabledAt: teamMembers.disabledAt,
            createdAt: teamMembers.createdAt,
            updatedAt: teamMembers.updatedAt
          })
          .from(teamMembers)
          .where(and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          ))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  disableTeamMember: (teamId: string, userId: string) =>
    withDb('Failed to disable team member', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(teamMembers)
          .set({ disabledAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          ))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  enableTeamMember: (teamId: string, userId: string) =>
    withDb('Failed to enable team member', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(teamMembers)
          .set({ disabledAt: null, updatedAt: sql`now()` })
          .where(and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          ))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  getMemberById: (id: string) =>
    withDb('Failed to get team member by id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            id: teamMembers.id,
            teamId: teamMembers.teamId,
            userId: teamMembers.userId,
            roleId: teamMembers.roleId,
            role: teamMembers.role,
            disabledAt: teamMembers.disabledAt,
            createdAt: teamMembers.createdAt,
            updatedAt: teamMembers.updatedAt
          })
          .from(teamMembers)
          .where(eq(teamMembers.id, id))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  updateMemberRole: (id: string, roleId: string | null) =>
    withDb('Failed to update team member role', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(teamMembers)
          .set({ roleId, updatedAt: sql`now()` })
          .where(eq(teamMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  disableMemberById: (id: string) =>
    withDb('Failed to disable team member by id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(teamMembers)
          .set({ disabledAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(teamMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  enableMemberById: (id: string) =>
    withDb('Failed to enable team member by id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(teamMembers)
          .set({ disabledAt: null, updatedAt: sql`now()` })
          .where(eq(teamMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  removeMemberById: (id: string) =>
    withDb('Failed to remove team member by id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .delete(teamMembers)
          .where(eq(teamMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    )
}
