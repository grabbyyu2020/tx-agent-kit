'use client'

import type { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GroupBase, MenuListProps, SelectInstance } from 'react-select'
import {
  useOrganizationsGetOrganization,
  useOrganizationsListOrganizations
} from '@/lib/api/generated/organizations/organizations'
import { useTeamsListTeams, teamsCreateTeam } from '@/lib/api/generated/teams/teams'
import { isUuid, NIL_UUID } from '@/lib/id-validation'
import { notify } from '@/lib/notify'
import type { BrandSettingsValues } from '../BrandSettingsFields'
import type { CreateWorkspaceDialogInput } from '../CreateWorkspaceDialog'
import { IconPlus, toSelectableLabel, type TeamOption } from './sidebarNav'

interface UseSidebarWorkspacesOptions {
  orgId: string | undefined
  teamId: string | undefined
  pathname: string
  router: ReturnType<typeof useRouter>
}

/**
 * Organization + workspace selection state for the app sidebar: list/detail
 * queries, route-param syncing, the workspace switcher options and the
 * create-workspace dialog flow.
 */
export function useSidebarWorkspaces({
  orgId,
  teamId,
  pathname,
  router
}: UseSidebarWorkspacesOptions) {
  const orgsQuery = useOrganizationsListOrganizations(
    { limit: '100', sortBy: 'name', sortOrder: 'asc' }
  )
  const organizations = orgsQuery.data?.data ?? []
  const organizationLoading = orgsQuery.isLoading
  const [teamCreating, setTeamCreating] = useState(false)
  const [organizationSelection, setOrganizationSelection] = useState<string>('')
  const [teamSelection, setTeamSelection] = useState<string>('')
  const [teamInput, setTeamInput] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createDialogName, setCreateDialogName] = useState('')

  useEffect(() => {
    setOrganizationSelection(orgId ?? '')
  }, [orgId])

  useEffect(() => {
    setTeamSelection(teamId ?? '')
  }, [teamId])

  // Sync org selection from query data
  useEffect(() => {
    if (!orgId && organizations.length > 0 && !organizationSelection) {
      setOrganizationSelection(organizations[0]?.id ?? '')
    }
  }, [orgId, organizations, organizationSelection])

  const selectedOrgId = useMemo(() => {
    if (orgId) {
      return orgId
    }

    if (organizationSelection) {
      return organizationSelection
    }

    return organizations[0]?.id ?? ''
  }, [orgId, organizationSelection, organizations])

  const selectedOrganization = useMemo(() => {
    return organizations.find((organization) => organization.id === selectedOrgId) ?? null
  }, [organizations, selectedOrgId])

  const selectedOrganizationQuery = useOrganizationsGetOrganization(selectedOrgId, {
    query: {
      enabled: isUuid(selectedOrgId)
    }
  })

  const currentOrganization = selectedOrganizationQuery.data ?? selectedOrganization

  const shouldShowContinueSetup = useMemo(() => {
    if (!currentOrganization) {
      return false
    }

    const onboardingData = currentOrganization.onboardingData
    if (!onboardingData) {
      return true
    }

    return onboardingData.status !== 'completed'
  }, [currentOrganization])

  const hasValidSelectedOrgId = isUuid(selectedOrgId)
  const teamsQuery = useTeamsListTeams(
    { organizationId: hasValidSelectedOrgId ? selectedOrgId : NIL_UUID, limit: '100', sortBy: 'name', sortOrder: 'asc' },
    { query: { enabled: hasValidSelectedOrgId } }
  )
  const teams = teamsQuery.data?.data ?? []
  const teamLoading = teamsQuery.isLoading

  // Sync team selection from query data
  useEffect(() => {
    if (!teamId && teams.length > 0) {
      setTeamSelection((current) => {
        if (teams.some((t) => t.id === current)) {return current}
        return teams[0]?.id ?? ''
      })
    }
  }, [teamId, teams])

  useEffect(() => {
    if (!selectedOrgId || !teamId || teams.length === 0) {
      return
    }

    if (teams.some((team) => team.id === teamId)) {
      return
    }

    const fallbackTeamId = teams[0]?.id
    if (!fallbackTeamId) {
      return
    }

    setTeamSelection(fallbackTeamId)

    if (pathname.startsWith(`/org/${selectedOrgId}/${teamId}`)) {
      router.replace(`/org/${selectedOrgId}/${fallbackTeamId}`)
    }
  }, [pathname, router, selectedOrgId, teamId, teams])

  const handleTeamChange = useCallback((nextTeamId: string) => {
    setTeamSelection(nextTeamId)

    if (!selectedOrgId || !nextTeamId) {
      return
    }

    router.push(`/org/${selectedOrgId}/${nextTeamId}`)
  }, [router, selectedOrgId])

  const handleCreateWorkspace = useCallback(async (
    rawName: string,
    website: string | null | undefined,
    brand: BrandSettingsValues
  ) => {
    const trimmedName = rawName.trim()
    if (!selectedOrgId || trimmedName.length < 2 || teamCreating) {
      return
    }

    setTeamCreating(true)
    try {
      const createdTeam = await teamsCreateTeam({
        organizationId: selectedOrgId,
        name: trimmedName,
        website,
        brandSettings: brand
      })

      setTeamSelection(createdTeam.id)
      setTeamInput('')
      notify.success(`Workspace "${createdTeam.name}" created`)
      void teamsQuery.refetch()
      router.push(`/org/${selectedOrgId}/${createdTeam.id}`)
    } catch {
      notify.error('Failed to create workspace')
    } finally {
      setTeamCreating(false)
    }
  }, [router, selectedOrgId, teamCreating, teamsQuery])

  const teamOptions = useMemo<TeamOption[]>(() => {
    return teams.map((team) => ({
      value: team.id,
      label: toSelectableLabel(team.name, 'Untitled team')
    }))
  }, [teams])

  const selectedTeamOption = useMemo<TeamOption | null>(() => {
    return teamOptions.find((team) => team.value === teamSelection) ?? null
  }, [teamOptions, teamSelection])

  useEffect(() => {
    if (!teamCreating) {
      setTeamInput('')
    }
  }, [teamCreating])

  const selectRef = useRef<SelectInstance<TeamOption> | null>(null)

  const workspaceMenuComponents = useMemo(() => ({
    MenuList: (props: MenuListProps<TeamOption, false, GroupBase<TeamOption>>) => {
      const handleClick = (e?: React.MouseEvent | React.KeyboardEvent) => {
        e?.preventDefault()
        e?.stopPropagation()
        selectRef.current?.blur()
        setCreateDialogOpen(true)
        setCreateDialogName('')
      }
      return (
        <div ref={props.innerRef} {...props.innerProps}>
          <div
            role="button"
            tabIndex={0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-accent cursor-pointer border-b border-border"
            onClick={handleClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleClick()
              }
            }}
          >
            <IconPlus />
            <span>New Workspace</span>
          </div>
          {props.children}
        </div>
      )
    }
  }), [selectRef])

  const handleCreateDialogSubmit = useCallback(async ({ name, website, brandSettings }: CreateWorkspaceDialogInput) => {
    if (!name.trim() || teamCreating) {
      return
    }
    setCreateDialogOpen(false)
    await handleCreateWorkspace(name.trim(), website, brandSettings)
    setCreateDialogName('')
  }, [handleCreateWorkspace, teamCreating])

  return {
    selectedOrgId,
    selectedOrganization,
    shouldShowContinueSetup,
    organizationLoading,
    teamSelection,
    teamLoading,
    teamCreating,
    teamInput,
    setTeamInput,
    teamOptions,
    selectedTeamOption,
    selectRef,
    workspaceMenuComponents,
    handleTeamChange,
    createDialogOpen,
    setCreateDialogOpen,
    createDialogName,
    setCreateDialogName,
    handleCreateDialogSubmit
  }
}

export type SidebarWorkspaces = ReturnType<typeof useSidebarWorkspaces>
