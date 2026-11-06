'use client'

import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useRouteTransition } from './RouteTransition'
import { useMyPermissions } from '../hooks/use-permissions'
import { useCurrentPrincipal } from '../hooks/use-session-store'
import { clientApi } from '../lib/client-api'
import { getAssetsListAssetsQueryOptions } from '../lib/api/generated/assets/assets'
import { getOrganizationsListOrgMembersQueryOptions } from '../lib/api/generated/organizations/organizations'
import { notify } from '../lib/notify'
// clientApi kept for signOut (auth side effects)
import { cn } from '../lib/utils'
import { sessionStoreActions } from '../stores/session-store'
import {
  getInitials,
  IconLogOut,
  IconSettings,
  IconShadowing,
  navItems,
  preventDisabledLinkClick,
  settingsItems,
  shadowingHref,
  shadowingLabel,
  workspacesItem
} from './app-sidebar/sidebarNav'
import { SidebarWorkspaceSwitcher } from './app-sidebar/SidebarWorkspaceSwitcher'
import { useSidebarWorkspaces } from './app-sidebar/useSidebarWorkspaces'
import { formatUsdFromDecimillicents } from './billing/billing-utils'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { Separator } from './ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar
} from './ui/sidebar'

interface AppSidebarProps {
  /** Optional override; defaults to the `orgId` route param. */
  orgId?: string
  /** Optional override; defaults to the `teamId` route param. */
  teamId?: string
  /** Optional override; defaults to the principal email from the session store. */
  principalEmail?: string | null
}

/* ── Component ───────────────────────────────────────────────────── */

export function AppSidebar({
  orgId: orgIdProp,
  teamId: teamIdProp,
  principalEmail: principalEmailProp
}: AppSidebarProps = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()
  const principal = useCurrentPrincipal()
  const orgId = orgIdProp ?? (typeof params.orgId === 'string' ? params.orgId : undefined)
  const teamId = teamIdProp ?? (typeof params.teamId === 'string' ? params.teamId : undefined)
  const principalEmail = principalEmailProp ?? principal?.email ?? null
  const queryClient = useQueryClient()
  const routeTransition = useRouteTransition()
  const { state: sidebarState } = useSidebar()
  const isCollapsed = sidebarState === 'collapsed'
  const myPermissionsQuery = useMyPermissions()

  const visibleSettingsItems = useMemo(() => {
    const permissions = new Set(myPermissionsQuery.data?.permissions ?? [])
    return settingsItems.filter(
      (item) => !item.requiredPermission || permissions.has(item.requiredPermission)
    )
  }, [myPermissionsQuery.data?.permissions])

  const workspaces = useSidebarWorkspaces({ orgId, teamId, pathname, router })
  const {
    selectedOrgId,
    selectedOrganization,
    teamSelection,
    teamCreating,
    createDialogOpen,
    setCreateDialogOpen,
    createDialogName,
    setCreateDialogName,
    handleCreateDialogSubmit
  } = workspaces

  const [signingOut, setSigningOut] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // Navigate through the route transition when one is available (inside the
  // AppShell) so the current page stays visible while the next renders; fall
  // back to a plain push when rendered standalone (e.g. in tests).
  const navigate = useCallback((href: string) => {
    if (routeTransition) {
      routeTransition.navigate(href)
      return
    }

    router.push(href)
  }, [routeTransition, router])

  const handleSidebarLinkClick = useCallback((
    event: ReactMouseEvent<HTMLAnchorElement>,
    href: string,
    disabled: boolean
  ) => {
    preventDisabledLinkClick(event, disabled)
    if (
      disabled
      || event.defaultPrevented
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return
    }

    event.preventDefault()
    navigate(href)
  }, [navigate])

  // Close user menu on click outside
  useEffect(() => {
    if (!userMenuOpen) { return undefined }

    const onClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', onClickOutside)
    return () => { document.removeEventListener('mousedown', onClickOutside) }
  }, [userMenuOpen])

  // Close user menu when sidebar expands
  useEffect(() => {
    if (!isCollapsed) { setUserMenuOpen(false) }
  }, [isCollapsed])

  const handleSignOut = useCallback(() => {
    void (async () => {
      setSigningOut(true)
      try {
        await clientApi.signOut()
        notify.info('Signed out')
      } catch {
        notify.error('Sign out failed')
      } finally {
        sessionStoreActions.clear()
        setSigningOut(false)
        router.replace('/sign-in')
      }
    })()
  }, [router])

  const resolvedTeamId = teamSelection || teamId || ''

  // Warm the destination's primary list query on hover/focus so the page is
  // already populated by the time the user clicks. Keyed off the href so we
  // only prefetch the data-heavy workspace/org pages.
  const prefetchForHref = useCallback((href: string) => {
    if (!href || href === '#') {
      return
    }

    if (href.endsWith('/media') && resolvedTeamId) {
      void queryClient.prefetchQuery({
        ...getAssetsListAssetsQueryOptions(resolvedTeamId),
        staleTime: 30_000
      })
    } else if (href.endsWith('/members') && selectedOrgId) {
      void queryClient.prefetchQuery({
        ...getOrganizationsListOrgMembersQueryOptions(selectedOrgId),
        staleTime: 30_000
      })
    }
  }, [queryClient, resolvedTeamId, selectedOrgId])

  const availableCredits = selectedOrganization
    ? selectedOrganization.creditsBalance - selectedOrganization.reservedCredits
    : null
  const activeSettingsItem = useMemo(() => {
    if (!selectedOrgId) {
      return false
    }

    return visibleSettingsItems.some((item) =>
      item.matchPattern(pathname, selectedOrgId, resolvedTeamId)
    )
  }, [pathname, resolvedTeamId, selectedOrgId, visibleSettingsItems])

  useEffect(() => {
    if (!isCollapsed && activeSettingsItem) {
      setSettingsOpen(true)
    }
  }, [activeSettingsItem, isCollapsed])

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      {/* ── Header: brand + org + workspace switcher ── */}
      <SidebarHeader>
        <div className={cn("flex items-center gap-2", isCollapsed && "justify-center")}>
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-indigo-400 text-white flex items-center justify-center text-xs font-bold shrink-0">TX</div>
          {!isCollapsed && (
            <span className="text-sm font-semibold tracking-tight">tx-agent-kit</span>
          )}
        </div>


        {!isCollapsed && <SidebarWorkspaceSwitcher workspaces={workspaces} />}
      </SidebarHeader>

      {/* ── Navigation ── */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const needsTeam = item.requiresTeam && !resolvedTeamId
                const href = needsTeam
                  ? '#'
                  : item.href(selectedOrgId, resolvedTeamId)
                const isActive = selectedOrgId
                  ? item.matchPattern(pathname, selectedOrgId, resolvedTeamId)
                  : false
                const Icon = item.icon

                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link
                        href={href}
                        aria-disabled={needsTeam || !selectedOrgId}
                        aria-label={isCollapsed ? item.label : undefined}
                        title={item.label}
                        tabIndex={needsTeam || !selectedOrgId ? -1 : undefined}
                        onClick={(event) => handleSidebarLinkClick(event, href, needsTeam || !selectedOrgId)}
                        onMouseEnter={() => prefetchForHref(href)}
                        onFocus={() => prefetchForHref(href)}
                      >
                        <Icon />
                        {!isCollapsed && <span className="overflow-hidden whitespace-nowrap text-ellipsis">{item.label}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
              {/* User-level (not org/workspace scoped), so always enabled. */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith(shadowingHref)}>
                  <Link
                    href={shadowingHref}
                    aria-label={isCollapsed ? shadowingLabel : undefined}
                    title={shadowingLabel}
                    onClick={(event) => handleSidebarLinkClick(event, shadowingHref, false)}
                  >
                    <IconShadowing />
                    {!isCollapsed && <span className="overflow-hidden whitespace-nowrap text-ellipsis">{shadowingLabel}</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ── Footer: workspaces link + settings dropdown + user row ── */}
      <SidebarFooter>
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-1">
            {[workspacesItem, ...visibleSettingsItems].map((item) => {
              const needsTeam = item.requiresTeam && !resolvedTeamId
              const disabled = needsTeam || !selectedOrgId
              const href = disabled ? '#' : item.href(selectedOrgId, resolvedTeamId)
              const isActive = selectedOrgId
                ? item.matchPattern(pathname, selectedOrgId, resolvedTeamId)
                : false
              const Icon = item.icon

              return (
                <Link
                  key={item.label}
                  href={href}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer transition-colors',
                    isActive && 'bg-accent text-foreground'
                  )}
                  aria-disabled={disabled}
                  aria-label={item.label}
                  title={item.label}
                  tabIndex={disabled ? -1 : undefined}
                  onClick={(event) => handleSidebarLinkClick(event, href, disabled)}
                  onMouseEnter={() => prefetchForHref(href)}
                  onFocus={() => prefetchForHref(href)}
                >
                  <Icon />
                </Link>
              )
            })}
          </div>
        ) : (() => {
          const wsHref = workspacesItem.href(selectedOrgId, resolvedTeamId)
          const wsActive = selectedOrgId
            ? workspacesItem.matchPattern(pathname, selectedOrgId, resolvedTeamId)
            : false
          const WsIcon = workspacesItem.icon

          return (
            <Link
              href={wsHref}
              className={cn(
                'flex items-center gap-2 px-2 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                wsActive && 'bg-accent text-foreground'
              )}
              aria-disabled={!selectedOrgId}
              title={workspacesItem.label}
              tabIndex={!selectedOrgId ? -1 : undefined}
              onClick={(event) => handleSidebarLinkClick(event, wsHref, !selectedOrgId)}
              onMouseEnter={() => prefetchForHref(wsHref)}
              onFocus={() => prefetchForHref(wsHref)}
            >
              <WsIcon />
              <span>{workspacesItem.label}</span>
            </Link>
          )
        })()}

        {!isCollapsed && <Separator />}

        {!isCollapsed && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              onClick={() => setSettingsOpen((prev) => !prev)}
              aria-expanded={settingsOpen}
            >
              <IconSettings />
              <span>Settings</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn(
                  'ml-auto transition-transform duration-200 ease-out',
                  settingsOpen && 'rotate-180'
                )}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div
              data-testid="app-sidebar-settings-section"
              aria-hidden={!settingsOpen}
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
                settingsOpen
                  ? 'grid-rows-[1fr] opacity-100 pointer-events-auto'
                  : 'grid-rows-[0fr] opacity-0 pointer-events-none'
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex flex-col gap-px py-1">
                  {visibleSettingsItems.map((item) => {
                    const needsTeam = item.requiresTeam && !resolvedTeamId
                    const href = needsTeam
                      ? '#'
                      : item.href(selectedOrgId, resolvedTeamId)
                    const isActive = selectedOrgId
                      ? item.matchPattern(pathname, selectedOrgId, resolvedTeamId)
                      : false
                    const Icon = item.icon

                    return (
                      <Link
                        key={item.label}
                        href={href}
                        className={cn(
                          'flex items-center gap-2 px-2 py-1.5 pl-8 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer',
                          isActive && 'bg-accent text-foreground font-medium'
                        )}
                        aria-disabled={needsTeam || !selectedOrgId}
                        title={item.label}
                        tabIndex={!settingsOpen || needsTeam || !selectedOrgId ? -1 : undefined}
                        onClick={(event) => handleSidebarLinkClick(event, href, needsTeam || !selectedOrgId)}
                        onMouseEnter={() => prefetchForHref(href)}
                        onFocus={() => prefetchForHref(href)}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {!isCollapsed && <Separator />}

        {!isCollapsed && selectedOrganization ? (
          <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Available credits
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {formatUsdFromDecimillicents(availableCredits)}
            </div>
          </div>
        ) : null}

        {!isCollapsed && selectedOrganization ? <Separator /> : null}

        <div className={cn("flex items-center gap-2 px-1", isCollapsed && "justify-center px-0")}>
          {isCollapsed ? (
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-indigo-400 text-white flex items-center justify-center text-xs font-bold shrink-0 cursor-pointer hover:ring-2 hover:ring-indigo-400/50 transition-shadow"
                title={principalEmail ?? 'User menu'}
                onClick={() => setUserMenuOpen((prev) => !prev)}
              >
                {getInitials(principalEmail)}
              </button>

              {userMenuOpen && (
                <div className="fixed bottom-3 left-[calc(var(--sidebar-width-icon)+0.5rem)] w-48 rounded-md border border-border bg-popover shadow-lg py-1 z-50">
                  <div className="px-3 py-2 border-b border-border">
                    <span className="text-xs text-muted-foreground truncate block" title={principalEmail ?? undefined}>
                      {principalEmail ?? 'Authenticated user'}
                    </span>
                  </div>

                  {visibleSettingsItems.map((item) => {
                    const needsTeam = item.requiresTeam && !resolvedTeamId
                    const href = needsTeam ? '#' : item.href(selectedOrgId, resolvedTeamId)
                    const Icon = item.icon

                    return (
                      <Link
                        key={item.label}
                        href={href}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-disabled={needsTeam || !selectedOrgId}
                        title={item.label}
                        tabIndex={needsTeam || !selectedOrgId ? -1 : undefined}
                        onClick={(event) => {
                          handleSidebarLinkClick(event, href, needsTeam || !selectedOrgId)
                          setUserMenuOpen(false)
                        }}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}

                  <div className="border-t border-border mt-1 pt-1">
                    <button
                      type="button"
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                      disabled={signingOut}
                      onClick={handleSignOut}
                    >
                      <IconLogOut />
                      <span>{signingOut ? 'Signing out...' : 'Sign out'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-indigo-400 text-white flex items-center justify-center text-xs font-bold shrink-0" title={principalEmail ?? 'User'}>
                {getInitials(principalEmail)}
              </div>

              <div className="flex-1 min-w-0">
                <span className="text-xs text-muted-foreground truncate block" title={principalEmail ?? undefined}>
                  {principalEmail ?? 'Authenticated user'}
                </span>
              </div>

              <button
                type="button"
                className="ml-auto w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                title={signingOut ? 'Signing out...' : 'Sign out'}
                disabled={signingOut}
                onClick={handleSignOut}
              >
                <IconLogOut />
              </button>
            </>
          )}
        </div>
      </SidebarFooter>

      <SidebarRail />

      <CreateWorkspaceDialog
        open={createDialogOpen}
        initialName={createDialogName}
        isCreating={teamCreating}
        onOpenChange={(open) => {
          setCreateDialogOpen(open)
          if (!open) {
            setCreateDialogName('')
          }
        }}
        onCreate={handleCreateDialogSubmit}
      />
    </Sidebar>
  )
}
