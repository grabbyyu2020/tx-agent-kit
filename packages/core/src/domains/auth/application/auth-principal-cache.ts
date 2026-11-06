import { createHash } from 'node:crypto'
import type { AuthPrincipal } from '../domain/auth-domain.js'

const principalResolutionCacheTtlMs = 2000

interface CachedPrincipalResolution {
  principal: AuthPrincipal
  expiresAtMs: number
}

const hashPrincipalCacheKey = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('base64url')

export const createPrincipalResolutionCache = () => {
  const byTokenHash = new Map<string, CachedPrincipalResolution>()
  const tokenHashesBySessionId = new Map<string, Set<string>>()
  const tokenHashesByUserId = new Map<string, Set<string>>()

  const removeTokenHash = (tokenHash: string): void => {
    const cached = byTokenHash.get(tokenHash)
    if (!cached) {
      return
    }

    byTokenHash.delete(tokenHash)

    const sessionId = cached.principal.sessionId
    if (sessionId) {
      const sessionHashes = tokenHashesBySessionId.get(sessionId)
      sessionHashes?.delete(tokenHash)
      if (sessionHashes?.size === 0) {
        tokenHashesBySessionId.delete(sessionId)
      }
    }

    const userHashes = tokenHashesByUserId.get(cached.principal.userId)
    userHashes?.delete(tokenHash)
    if (userHashes?.size === 0) {
      tokenHashesByUserId.delete(cached.principal.userId)
    }
  }

  return {
    get: (token: string): AuthPrincipal | undefined => {
      const tokenHash = hashPrincipalCacheKey(token)
      const cached = byTokenHash.get(tokenHash)
      if (!cached) {
        return undefined
      }

      if (cached.expiresAtMs <= Date.now()) {
        removeTokenHash(tokenHash)
        return undefined
      }

      return cached.principal
    },

    set: (token: string, principal: AuthPrincipal): void => {
      if (!principal.sessionId) {
        return
      }

      const tokenHash = hashPrincipalCacheKey(token)
      removeTokenHash(tokenHash)
      byTokenHash.set(tokenHash, {
        principal,
        expiresAtMs: Date.now() + principalResolutionCacheTtlMs
      })

      const sessionHashes = tokenHashesBySessionId.get(principal.sessionId) ?? new Set<string>()
      sessionHashes.add(tokenHash)
      tokenHashesBySessionId.set(principal.sessionId, sessionHashes)

      const userHashes = tokenHashesByUserId.get(principal.userId) ?? new Set<string>()
      userHashes.add(tokenHash)
      tokenHashesByUserId.set(principal.userId, userHashes)
    },

    invalidateSession: (sessionId: string): void => {
      const tokenHashes = [...(tokenHashesBySessionId.get(sessionId) ?? [])]
      for (const tokenHash of tokenHashes) {
        removeTokenHash(tokenHash)
      }
    },

    invalidateUser: (userId: string): void => {
      const tokenHashes = [...(tokenHashesByUserId.get(userId) ?? [])]
      for (const tokenHash of tokenHashes) {
        removeTokenHash(tokenHash)
      }
    }
  }
}

export type PrincipalResolutionCache = ReturnType<typeof createPrincipalResolutionCache>
