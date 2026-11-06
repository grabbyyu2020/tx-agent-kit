import { generateUniqueValue } from '@tx-agent-kit/db'
import type { ApiFactoryContext } from './api-factories.js'

// ---------------------------------------------------------------------------
// Team with members factory
// ---------------------------------------------------------------------------

export const defaultTestBrandSettings = {
  colors: { primary: '#6366F1', secondary: '#8B5CF6', accent: '#F59E0B', background: '#FFFFFF', text: '#1A1A2E' },
  brandGuidelines: 'Test brand guidelines',
  industry: 'technology',
  targetAudience: 'Test audience'
}

export interface CreateTeamWithMembersOptions {
  token: string
  organizationId: string
  teamName?: string
  brandSettings?: {
    colors: { primary: string; secondary: string; accent: string; background: string; text: string }
    brandGuidelines: string
    industry: string
    targetAudience: string
  }
  members?: Array<{
    userId: string
  }>
}

export interface CreatedTeamWithMembers {
  team: { id: string; name: string; organizationId: string }
  members: Array<{ userId: string; teamId: string }>
}

export const createTeamWithMembers = async (
  context: ApiFactoryContext,
  options: CreateTeamWithMembersOptions
): Promise<CreatedTeamWithMembers> => {
  const teamName = options.teamName ?? `Team ${generateUniqueValue('team')}`

  const teamRes = await fetch(`${context.baseUrl}/v1/teams`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.token}`,
      ...context.testContext.headersForCase(`create-team-${teamName}`)
    },
    body: JSON.stringify({
      organizationId: options.organizationId,
      name: teamName,
      brandSettings: options.brandSettings ?? defaultTestBrandSettings
    })
  })

  if (!teamRes.ok) {
    const body = await teamRes.text()
    throw new Error(`createTeamWithMembers: team creation failed (${teamRes.status}): ${body}`)
  }

  const team = (await teamRes.json()) as { id: string; name: string; organizationId: string }
  const addedMembers: Array<{ userId: string; teamId: string }> = []

  if (options.members) {
    for (const member of options.members) {
      // Try API first (POST /v1/teams/:teamId/members)
      const addRes = await fetch(`${context.baseUrl}/v1/teams/${team.id}/members`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.token}`,
          ...context.testContext.headersForCase(`add-member-${member.userId}`)
        },
        body: JSON.stringify({ userId: member.userId })
      })

      if (addRes.ok) {
        addedMembers.push({ userId: member.userId, teamId: team.id })
      } else {
        // Fallback to raw SQL
        await context.testContext.withSchemaClient(async (client) => {
          await client.query(
            'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [team.id, member.userId]
          )
        })
        addedMembers.push({ userId: member.userId, teamId: team.id })
      }
    }
  }

  return { team, members: addedMembers }
}

/**
 * Forces a member's per-team role directly in the database.
 *
 * There is no public API to demote yourself below admin on a team, so tests that
 * need a non-admin team role (e.g. verifying that an org admin who is only a team
 * viewer can still act on the team) set it here. Mirrors the SQL-fallback style
 * the team/member factories already use.
 */
export const setTeamMemberRole = async (
  context: ApiFactoryContext,
  options: { teamId: string; userId: string; role: 'admin' | 'member' | 'viewer' }
): Promise<void> => {
  await context.testContext.withSchemaClient(async (client) => {
    await client.query(
      'UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3',
      [options.role, options.teamId, options.userId]
    )
  })
}
