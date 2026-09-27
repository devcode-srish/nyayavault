# API Reference — Phase 1

Base URL: `http://localhost:4000/api`

## Auth

### POST /auth/login
Body: `{ "email": string, "password": string }`
Returns: `{ accessToken, refreshToken, user: { id, email, name, role } }`

### POST /auth/refresh
Body: `{ "refreshToken": string }`
Returns: `{ accessToken }`

### POST /auth/logout
Auth: Bearer access token required.
Body: `{ "refreshToken": string }`
Revokes the given refresh token.

### GET /auth/me
Auth: Bearer access token required.
Returns the current user's profile.

## Dashboard

### GET /dashboard
Auth: Bearer access token required.
Returns a payload shaped differently per role — see
`apps/api/src/routes/dashboard.routes.ts`.

## Users (Admin only)

### GET /users
Auth: Bearer access token required, role must be `ADMIN`.
Any other role receives `403 Forbidden`.
Returns: `{ users: [{ id, email, name, role, isActive, createdAt }] }`

---

Endpoints for cases, documents, uploads, versions, integrity verification,
access requests, audit logs, evidence, signatures, AI, notifications, and
secure sharing are specified in the project brief and will be documented
here as each phase implements them.
