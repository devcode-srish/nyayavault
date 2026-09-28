# NyayaVault (SIH26190)

Secure Digital Document Management System for Legal and Investigation Documents.
**All data in this project is synthetic/demo data.** See `docs/DEMO.md`.

This is **Phase 1** of a 6-phase build: project scaffold, PostgreSQL schema
(full model set), JWT auth with refresh tokens, backend-enforced RBAC, and
5 role-specific dashboards. Everything here is real and runnable — no mocked
UI-only screens.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ running locally (or a connection string to one)

## 1. Install dependencies

From the repo root (this uses npm workspaces):

```bash
npm install
```

## 2. Configure environment

```bash
cp .env.example apps/api/.env
```

Edit `apps/api/.env` and set `DATABASE_URL` to your Postgres instance, e.g.:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nyayavault?schema=public"
```

## 3. Create the database schema

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

This creates every table in the spec (User, Case, Document, AuditLog,
EvidenceItem, DigitalSignature, etc.) — Phase 1 only *uses* the
auth/case/dashboard-relevant ones; the rest light up in later phases without
needing another migration reset.

## 4. Seed demo data

```bash
npm run seed
```

This creates 5 demo users (one per role) and 4 synthetic cases, and prints
the login credentials to the console.

Demo accounts (password for all: `Demo@1234`):

| Role | Email |
|---|---|
| Admin | admin@nyayavault.demo |
| Investigating Officer | officer@nyayavault.demo |
| Senior Officer | senior@nyayavault.demo |
| Forensic Officer | forensic@nyayavault.demo |
| Legal Officer | legal@nyayavault.demo |

## 5. Run the API

```bash
npm run dev:api
```

API listens on `http://localhost:4000`. Health check: `GET /api/health`.

## 6. Run the web app

In a second terminal:

```bash
npm run dev:web
```

Open `http://localhost:5173`.

## What to verify in Phase 1

- [ ] Login works for all 5 demo accounts
- [ ] Each role sees a **different** dashboard and a **different** sidebar
- [ ] `GET /api/users` returns data for Admin, but returns **HTTP 403** for
      every other role's token (this is the RBAC proof point — try it with
      curl/Postman, not just the UI)
- [ ] Refresh token flow: access tokens expire in 15 min but you stay logged in
- [ ] Logout revokes the refresh token

### Proving backend RBAC (not just hidden buttons)

```bash
# Log in as an officer, grab the accessToken from the response, then:
curl -H "Authorization: Bearer <officer_access_token>" http://localhost:4000/api/users
# => 403 Forbidden, even though nothing in the UI stopped you from calling it
```

## Project structure

```
nyayavault/
  apps/
    api/     Express + TypeScript + Prisma backend
    web/     React + Vite + TypeScript + Tailwind frontend
  packages/
    shared/  cross-app types (grows in later phases)
  docs/      ARCHITECTURE.md, SECURITY.md, API.md, DEMO.md
```

## Roadmap (later phases)

- **Phase 2:** cases, documents, uploads, SHA-256 hashing, version history, audit log UI
- **Phase 3 (done):** access requests/approvals, chain of custody, evidence transfers, secure share links, notifications
- **Phase 4:** digital signatures, integrity verification, tamper demo, security center
- **Phase 5:** AI case assistant (mock provider), entity extraction, cross-document search, timelines
- **Phase 6:** testing, polish, full documentation

See `docs/ARCHITECTURE.md` for the full plan.
