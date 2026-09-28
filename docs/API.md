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

## Cases

### GET /cases
Auth required. Admin sees all cases; other roles see only cases they are a
`CaseMember` of.

### GET /cases/:id
Auth required + must be a member of the case (or Admin), else `403`.
Returns case detail with members and documents.

## Documents

### GET /documents?caseId=...
Auth required. Lists documents in cases the caller can access. Passing a
`caseId` the caller isn't a member of returns `403`.

### POST /documents
Auth required, role must be one of ADMIN / INVESTIGATING_OFFICER /
SENIOR_OFFICER / LEGAL_OFFICER. Multipart form: `file`, `caseId`, `name`,
`type`, `classification`. Computes SHA-256, stores the file, creates the
Document + its first DocumentVersion, and writes `DOCUMENT_UPLOADED` +
`VERSION_CREATED` audit events.

### POST /documents/:id/versions
Same role restriction. Multipart form: `file`, optional `notes`. Creates a
**new** version — never overwrites a prior one.

### GET /documents/:id
Auth required + case membership. Returns full version history.

### GET /documents/:id/download?versionNo=N
Auth required + case membership. Streams the file. The storage key is never
exposed in any response — only the server resolves it to a path.

### POST /documents/:id/verify-integrity
Auth required + case membership. Recomputes SHA-256 of the stored latest
version and compares it to the hash recorded at upload time. Updates
`integrityStatus` and writes an `INTEGRITY_CHECK` or `INTEGRITY_MISMATCH`
audit event.

## Audit Log

### GET /audit?userId=&caseId=&action=&dateFrom=&dateTo=
Auth required, role must be ADMIN or SENIOR_OFFICER. Returns up to 200
matching audit events, newest first.

## Document-level access (Phase 3)

Case membership is no longer enough for `RESTRICTED` / `CONFIDENTIAL`
documents. `GET /documents/:id`, `/download`, `/verify-integrity`,
`/custody`, `/share` and `POST /versions` all return **403** with
`{ code: "DOCUMENT_ACCESS_DENIED", pendingRequest }` unless the caller is an
Admin, has an active (unexpired) grant, is the uploader, or is a Senior
Officer on the case. The 403 body contains no document metadata.

`GET /documents` and `GET /cases/:id` list restricted documents with
`canAccess: false` so case members can find them and request access.

### GET /documents/:id/custody
Chain of custody for a document, built from the audit trail (uploads,
versions, views, downloads, access requests/decisions, shares, integrity
checks). Same access rules as the document.

### POST /documents/:id/share
Roles: ADMIN / INVESTIGATING_OFFICER / SENIOR_OFFICER / LEGAL_OFFICER, plus
document access. Body: `{ expiresInHours (1-168), maxUses (1-10) }`. For
restricted/confidential documents only ADMIN or SENIOR_OFFICER may share.
Returns `{ share: { token, path, expiresAt, maxUses } }`.

### GET /documents/:id/shares
Share links for the document (Admin/Senior see all, others see their own).

## Public share links (no login)

### GET /share/:token
Metadata only (name, size, version, SHA-256, expiry, downloads remaining).
Does not use up a download. `404` invalid, `410` expired or used up.

### GET /share/:token/download
Re-hashes the stored file first and returns `409` if it no longer matches
its recorded SHA-256. Otherwise atomically claims one use and streams the
file. Rate limited separately from the rest of the API.

## Access requests

### POST /access-requests
Auth required. Body: `{ documentId, reason }`. `409` if you already have
access or already have a pending request. Notifies the case's Senior
Officers and Admins.

### GET /access-requests
Admin: all. Senior Officer: requests for cases they supervise + their own.
Others: their own. Each row has `canDecide`; approved requests whose expiry
has passed are reported as `EXPIRED`.

### POST /access-requests/:id/approve
Roles: SENIOR_OFFICER (on that case) or ADMIN; never your own request.
Body: `{ expiresInHours (1-720, default 24) }`. Creates an expiring
`DocumentAccess` grant.

### POST /access-requests/:id/reject
Same authorization. Body: `{ note? }`.

## Evidence

### GET /evidence, GET /evidence/:id
Visible to Admin, case members, the current custodian, and anyone who has
held the item. Detail includes the full transfer history.

### POST /evidence
Roles: ADMIN / INVESTIGATING_OFFICER / SENIOR_OFFICER / FORENSIC_OFFICER,
and access to the case. Starts the chain of custody.

### POST /evidence/:id/transfer
Body: `{ toUserId, notes? }`. Only the current custodian (or an Admin).

## Notifications

`GET /notifications`, `GET /notifications/unread-count`,
`POST /notifications/:id/read`, `POST /notifications/read-all`. Always
scoped to the signed-in user.

## Users directory

### GET /users/directory
Any signed-in user. Returns `{ id, name, role }` for active users (no
emails), used to pick a transfer recipient.

---

Endpoints for signatures, tamper simulation, AI and the security center
will be documented here as Phases 4-5 implement them.
