---
paths:
  - "apps/web/**"
---

# Web constraints (`apps/web`)

`apps/web` is a client-only Next.js SPA. It talks to `apps/api` over HTTP and holds no server runtime.

| ID | Rule | Enforced by |
|---|---|---|
| WEB-01 | No server runtime: no `apps/web/app/api`, no `proxy.ts` or `middleware.ts`, no `app/**/route.ts(x)`, no `next/server` or `next/headers` imports. | `script:scripts/lint/enforce-web-client-contracts.mjs`, `eslint:no-restricted-imports` |
| WEB-02 | No `effect` or `effect/*` imports. Effect runtime logic lives in api, core, and worker. | `eslint:no-restricted-imports` |
| WEB-03 | No `@tx-agent-kit/db` or `drizzle-orm` imports. The web app is API-first. | `eslint:no-restricted-imports` |
| WEB-04 | Every `.tsx` under `app/**` and `components/**` starts with `'use client'` (except `app/(website)/**` and `app/layout.tsx`). | `script:scripts/lint/enforce-web-client-contracts.mjs` |
| WEB-05 | Pages, components, and hooks call the API through the generated Orval hooks and functions in `apps/web/lib/api/generated/*`. `apps/web/lib/client-api.ts` is reserved for auth/session bootstrap, sign-in/sign-out side effects, and test/setup helpers; document any other runtime use inline. Do not call `api.get`/`post`/… directly. | `script:scripts/lint/enforce-web-client-contracts.mjs`, `eslint:no-restricted-syntax` [`api.<verb>` selector] |
| WEB-06 | After an API contract change, run `pnpm api:client:generate` (it regenerates `openapi.json` and the Orval clients). Never edit `lib/api/generated/*` by hand. | `script:scripts/lint/invariants/web-api-contracts.mjs` [partial: checks the generated files exist, not that they are current] |
| WEB-07 | No direct `fetch` in `apps/web`; use the typed clients. | none [the ESLint `fetch` selector is shadowed outside `lib/axios.ts`, `lib/client-api.ts`, and `lib/react-admin/data-provider.ts`] |
| WEB-08 | No `/api/*` proxy paths in `apps/web/lib`. Use `API_BASE_URL`; `lib/axios.ts` sets `baseURL: webEnv.API_BASE_URL`. | `script:scripts/lint/enforce-web-client-contracts.mjs` |
| WEB-09 | No direct `window.location`. Use the URL-state wrappers in `lib/url-state.tsx`. | `script:scripts/lint/enforce-web-client-contracts.mjs` |
| WEB-10 | `nuqs` is imported only in `apps/web/lib/url-state.tsx`. | `eslint:no-restricted-imports`, `script:scripts/lint/enforce-web-client-contracts.mjs` |
| WEB-11 | `sonner` is imported only in `apps/web/lib/notify.tsx`. | `script:scripts/lint/enforce-web-client-contracts.mjs` |
| WEB-12 | Only `apps/web/lib/auth-token.ts` manages the in-memory access token, and only it may touch `localStorage`. The refresh token lives in the API's HttpOnly cookie. | none [ESLint `localStorage` selectors are shadowed] |
| WEB-13 | Style with Tailwind utility classes and shadcn/ui components from `@/components/ui/*`. Do not add custom CSS to `globals.css` for new components. | none |
| WEB-14 | Use the shadcn `Button`, never a raw `<button>`. Styled action buttons use the explicit `.btn`, `.btn.secondary`, or `.btn.danger` classes; never rely on bare `<button>` styling. | `eslint:domain-structure/enforce-shadcn-button` [partial: the class half is review only] |
| WEB-15 | Modals use `components/ui/dialog.tsx`, never a hand-rolled `role="dialog"`. | `eslint:tx-web-ui/no-raw-dialog-role` |
| WEB-16 | Error UI shows `getApiErrorMessage(error)`, never `error.message`. | `eslint:domain-structure/enforce-api-error-message` |
| WEB-17 | React Query: never `staleTime: 0`; build query keys with a query-key factory. | `eslint:tx-react-query/no-zero-staletime`, `eslint:tx-react-query/require-query-key-factory` |
| WEB-18 | Route groups: public marketing pages go in `app/(website)/` under the `WebsiteHeader`/`WebsiteFooter` layout and read content from `apps/web/config/index.ts`; authenticated pages go in `app/(application)/` behind the auth-guard layout; auth pages (`sign-in`, `sign-up`, `forgot-password`, `reset-password`) stay at the app root. | none |
| WEB-19 | SEO and content: JSON-LD comes from `lib/seo.ts` and `lib/blog-seo.ts`, rendered by `components/StructuredData.tsx`; blog data goes through the `BlogDataSource` interface in `lib/blog.ts`; breadcrumbs use `components/Breadcrumbs.tsx`. | none |
| WEB-20 | Gate UI by permission with `PermissionsGate`, pages with `RequireRole`, and logic with `useHasPermission`/`useMyPermissions` from `hooks/use-permissions.ts`. Sidebar items declare `requiredPermission`. Never hard-code role checks; the policy source is `packages/contracts/src/permissions.ts`. | none |
