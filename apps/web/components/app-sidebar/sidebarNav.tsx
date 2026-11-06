'use client'

import type { PermissionAction } from '@tx-agent-kit/contracts'
import type { MouseEvent as ReactMouseEvent } from 'react'

/* ── Inline SVG icons (avoids adding lucide-react dependency) ──── */

const IconHome = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)

const IconUsers = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

export const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const IconBuilding = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="2" />
    <path d="M6 6h4v4H6zM14 6h4v4h-4zM6 14h4v4H6zM14 14h4v4h-4z" />
  </svg>
)

const IconGrid = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
)

export const IconLogOut = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

export const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

/* ── Helpers ─────────────────────────────────────────────────────── */

export interface TeamOption {
  value: string
  label: string
}

export const toSelectableLabel = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export const getInitials = (email: string | null | undefined): string => {
  if (!email) {
    return '?'
  }
  const local = email.split('@')[0] ?? ''
  if (local.length === 0) {
    return '?'
  }
  return local.slice(0, 2).toUpperCase()
}

export const preventDisabledLinkClick = (
  event: ReactMouseEvent<HTMLAnchorElement>,
  disabled: boolean
): void => {
  if (!disabled) {
    return
  }

  event.preventDefault()
}

/* ── Navigation definition ───────────────────────────────────────── */

export interface NavItem {
  label: string
  icon: React.ComponentType
  href: (orgId: string, teamId: string) => string
  matchPattern: (pathname: string, orgId: string, teamId: string) => boolean
  requiresTeam: boolean
  requiredPermission?: PermissionAction
}

const IconMedia = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </svg>
)

export const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    icon: IconHome,
    href: (orgId, teamId) => `/org/${orgId}/${teamId}`,
    matchPattern: (pathname, orgId, teamId) =>
      pathname === `/org/${orgId}/${teamId}`,
    requiresTeam: true
  },
  {
    label: 'Media',
    icon: IconMedia,
    href: (orgId, teamId) => `/org/${orgId}/${teamId}/media`,
    matchPattern: (pathname, orgId, teamId) =>
      pathname.startsWith(`/org/${orgId}/${teamId}/media`),
    requiresTeam: true
  }
]

export const IconShadowing = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
)

export const shadowingHref = '/shadowing'
export const shadowingLabel = '跟读练习'

export const workspacesItem: NavItem = {
  label: 'Workspaces',
  icon: IconGrid,
  href: (orgId) => `/org/${orgId}/workspaces`,
  matchPattern: (pathname, orgId) =>
    pathname === `/org/${orgId}/workspaces`,
  requiresTeam: false
}

const IconBilling = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
  </svg>
)

export const settingsItems: NavItem[] = [
  {
    label: 'Billing',
    icon: IconBilling,
    href: (orgId) => `/org/${orgId}/billing`,
    matchPattern: (pathname, orgId) =>
      pathname.startsWith(`/org/${orgId}/billing`),
    requiresTeam: false,
    requiredPermission: 'manage_billing'
  },
  {
    label: 'Members',
    icon: IconUsers,
    href: (orgId) => `/org/${orgId}/members`,
    matchPattern: (pathname, orgId) =>
      pathname === `/org/${orgId}/members`,
    requiresTeam: false
  },
  {
    label: 'Workspace Settings',
    icon: IconSettings,
    href: (orgId, teamId) => `/org/${orgId}/${teamId}/settings`,
    matchPattern: (pathname, orgId, teamId) =>
      pathname === `/org/${orgId}/${teamId}/settings`,
    requiresTeam: true,
    requiredPermission: 'manage_organization'
  },
  {
    label: 'Org Settings',
    icon: IconBuilding,
    href: (orgId) => `/org/${orgId}/settings`,
    matchPattern: (pathname, orgId) =>
      pathname === `/org/${orgId}/settings`,
    requiresTeam: false,
    requiredPermission: 'manage_organization'
  }
]
