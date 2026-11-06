'use client'

import Link from 'next/link'
import CreatableSelect from 'react-select/creatable'
import type { SidebarWorkspaces } from './useSidebarWorkspaces'

interface SidebarWorkspaceSwitcherProps {
  workspaces: SidebarWorkspaces
}

export function SidebarWorkspaceSwitcher({ workspaces }: SidebarWorkspaceSwitcherProps) {
  const {
    selectedOrgId,
    shouldShowContinueSetup,
    organizationLoading,
    teamLoading,
    teamCreating,
    teamInput,
    setTeamInput,
    teamOptions,
    selectedTeamOption,
    selectRef,
    workspaceMenuComponents,
    handleTeamChange,
    setCreateDialogOpen,
    setCreateDialogName
  } = workspaces

  return (
    <div className="flex flex-col gap-3 mt-1">
      <label className="flex flex-col gap-1.5" htmlFor="app-sidebar-team-switcher-input">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Workspace</span>
        <CreatableSelect
          ref={selectRef}
          options={teamOptions}
          value={selectedTeamOption}
          inputValue={teamInput}
          classNamePrefix="app-sidebar-team-select"
          isDisabled={!selectedOrgId || teamLoading || teamCreating || organizationLoading}
          placeholder="Workspace"
          formatCreateLabel={(inputValue) => `Create "${inputValue}"`}
          components={workspaceMenuComponents}
          onChange={(option) => {
            if (!option) {
              return
            }

            setTeamInput('')
            handleTeamChange(option.value)
          }}
          onCreateOption={(inputValue) => {
            setCreateDialogName(inputValue)
            setCreateDialogOpen(true)
          }}
          onInputChange={(value, meta) => {
            if (meta.action === 'input-change') {
              setTeamInput(value)
            }
          }}
          noOptionsMessage={() => 'No workspaces'}
          instanceId="app-sidebar-team-switcher-input"
          menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
          styles={{
            control: (base) => ({
              ...base,
              minHeight: 40,
              cursor: 'pointer'
            }),
            valueContainer: (base) => ({
              ...base,
              cursor: 'pointer',
              minWidth: 0,
              padding: '0 0.5rem'
            }),
            placeholder: (base) => ({
              ...base,
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }),
            singleValue: (base) => ({
              ...base,
              cursor: 'pointer',
              margin: 0,
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }),
            input: (base) => ({
              ...base,
              cursor: 'pointer',
              margin: 0,
              padding: 0
            }),
            indicatorsContainer: (base) => ({
              ...base,
              cursor: 'pointer'
            }),
            dropdownIndicator: (base) => ({
              ...base,
              cursor: 'pointer'
            }),
            menuPortal: (base) => ({
              ...base,
              zIndex: 1600
            })
          }}
        />
      </label>

      {shouldShowContinueSetup && (
        <Link href="/org/onboarding" className="text-[11px] text-muted-foreground hover:text-primary hover:underline">
          Continue setup &rarr;
        </Link>
      )}
    </div>
  )
}
