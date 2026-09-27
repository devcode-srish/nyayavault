# Architecture

## Stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind + React Router + TanStack Query (wired in from Phase 2) + Zod + Lucide icons
- **Backend:** Node.js + TypeScript + Express
- **Database:** PostgreSQL via Prisma ORM
- **Auth:** JWT access tokens (15 min) + opaque, DB-backed, revocable refresh tokens (7 days) + Argon2 password hashing
- **Storage:** Local filesystem in development, behind a storage-driver abstraction so a later swap to S3/Supabase touches one module, not callers (arrives Phase 2)
- **AI:** Provider abstraction with a `MockAIProvider` (default, no API key needed) and an optional OpenAI-compatible provider (arrives Phase 5)

## Monorepo layout

```
apps/api    Express app, Prisma schema + migrations, seed script
apps/web    Vite React app
packages/shared   Types shared between api and web
```

## Authentication flow

1. `POST /api/auth/login` verifies email + Argon2 password hash, returns a
   short-lived JWT access token and a long-lived opaque refresh token
   (stored in the `RefreshToken` table so it can be revoked).
2. The frontend's axios instance (`apps/web/src/lib/api.ts`) attaches the
   access token to every request and, on a 401, transparently calls
   `POST /api/auth/refresh` once, then retries the original request.
3. `POST /api/auth/logout` marks the refresh token `revoked = true`.

## Authorization model (RBAC)

Two independent layers — this is intentional, not redundant:

1. **Frontend navigation filter** (`apps/web/src/components/Layout.tsx`):
   hides sidebar links a role shouldn't see. This is a UX convenience only.
2. **Backend middleware** (`apps/api/src/middleware/auth.ts`):
   `requireAuth` verifies the JWT; `requireRole(...)` checks the role claim
   against an allow-list and returns `403` otherwise. Every protected route
   is wrapped in these.

From Phase 2 onward, document- and case-level authorization adds a third,
finer-grained layer: even within a role that can see "Documents", access to
a *specific* document is checked against `DocumentAccess` /
`Classification` / case membership before any data (or file bytes) is
returned.

## Database

Full Prisma schema (`apps/api/prisma/schema.prisma`) is defined in Phase 1
so later phases are additive — no destructive migrations. Phase 1 wires up
`User`, `RefreshToken`, `Case`, `CaseMember`, `EvidenceItem`, and `AuditLog`
end-to-end; the remaining models (`Document`, `DocumentVersion`,
`AccessRequest`, `DigitalSignature`, `AIQuery`, etc.) exist in the schema
and are implemented starting Phase 2.

## Phase plan

See the roadmap section of `README.md`.
