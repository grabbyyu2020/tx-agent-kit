'use client'

import type {
  OrganizationOnboardingGoal,
  OrganizationOnboardingTeamSize
} from '@tx-agent-kit/contracts'
import type { SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const goalOptions: readonly { value: OrganizationOnboardingGoal; label: string; description: string }[] = [
  {
    value: 'agent_execution',
    label: 'Agent execution',
    description: 'Launch multi-step agent workflows quickly.'
  },
  {
    value: 'automation',
    label: 'Automation',
    description: 'Automate repetitive operational tasks.'
  },
  {
    value: 'analytics',
    label: 'Analytics',
    description: 'Track execution quality and throughput.'
  },
  {
    value: 'internal_tools',
    label: 'Internal tools',
    description: 'Build internal operator tooling for teams.'
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Capture a custom primary objective.'
  }
]

const teamSizeOptions: readonly OrganizationOnboardingTeamSize[] = ['1-5', '6-20', '21-50', '51+']

export function GoalsStep({
  primaryGoal,
  setPrimaryGoal,
  teamSize,
  setTeamSize,
  saving,
  onBack,
  submitGoals
}: {
  primaryGoal: OrganizationOnboardingGoal
  setPrimaryGoal: (value: OrganizationOnboardingGoal) => void
  teamSize: OrganizationOnboardingTeamSize
  setTeamSize: (value: OrganizationOnboardingTeamSize) => void
  saving: boolean
  onBack: () => void
  submitGoals: (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => Promise<void>
}) {
  return (
    <form className="space-y-4" onSubmit={(event) => { void submitGoals(event) }}>
      <div className="space-y-2">
        <Label htmlFor="onboarding-primary-goal">Primary goal</Label>
        <select
          id="onboarding-primary-goal"
          value={primaryGoal}
          onChange={(event) => setPrimaryGoal(event.target.value as OrganizationOnboardingGoal)}
          className="flex h-10 w-full items-center rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {goalOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted-foreground">
          {goalOptions.find((option) => option.value === primaryGoal)?.description}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboarding-team-size">Team size</Label>
        <select
          id="onboarding-team-size"
          value={teamSize}
          onChange={(event) => setTeamSize(event.target.value as OrganizationOnboardingTeamSize)}
          className="flex h-10 w-full items-center rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {teamSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" type="button" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Continue'}
        </Button>
      </div>
    </form>
  )
}
