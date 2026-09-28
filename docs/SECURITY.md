# Security Notes

This is an SIH prototype. It demonstrates security *patterns*, not a
certified or audited production system.

## What Phase 1 implements

- Passwords hashed with Argon2 (`argon2` package), never stored or logged in plaintext
- JWT access tokens, short-lived (15 min default), signed with a server-only secret
- Refresh tokens are opaque random strings, stored server-side, individually
  revocable, and checked for expiry/revocation on every use
- `helmet` for standard HTTP security headers
- CORS restricted to the configured frontend origin
- Rate limiting: global (300 req / 15 min / IP) and a tighter limit on
  `/api/auth/*` (20 req / 15 min / IP) to slow brute-force login attempts
- Request body validation with `zod` on every write endpoint
- Backend RBAC enforced in middleware (`requireRole`), independent of any
  frontend hiding — see `docs/ARCHITECTURE.md`

## What later phases add

- SHA-256 file hashing + integrity verification (Phase 2/4)
- Document/case-level access control beyond role (Phase 2/3)
- Chain-of-custody and audit trail for every sensitive action (Phase 2/3)
- Prototype digital signatures (Phase 4) — explicitly **not** a legally
  certified signature scheme
- A "Simulate Tampering" demo feature, clearly labeled as a demonstration,
  never run against real data (Phase 4)

## Explicit non-claims

NyayaVault, at any phase, does **not** claim to be:

- 100% secure or hack-proof
- 100% tamper-proof
- automatically legally admissible
- integrated with any real government, police, or NCRP system

All data seeded or created during demos is synthetic. See `docs/DEMO.md`.

## Added in Phase 3

- **Document-level access control.** Restricted and confidential documents
  need an explicit, expiring grant (created when a Senior Officer or Admin
  approves an access request), or the caller must be the uploader, a Senior
  Officer on the case, or an Admin. Checked on the server for every read,
  download, version upload, integrity check and share.
- **No metadata in 403s.** The "access denied" response for a document
  contains nothing about the document.
- **Approval rules.** You cannot approve your own request; a Senior Officer
  can only decide for cases they belong to; concurrent decisions are
  resolved atomically so only one wins.
- **Secure share links.** 256-bit random token, expiry, download limit,
  atomic use-counting, separate rate limit. The link reveals no storage path
  or document ID. The file is re-hashed before each download and blocked on
  mismatch. Restricted material can only be shared by a Senior Officer or
  Admin.
- **Storage keys never leave the server.** Version records returned to the
  browser have the internal storage key removed.
- **Chain of custody.** Document custody comes from the audit trail;
  evidence has explicit transfer records, and only the current custodian
  (or an Admin) can hand an item over.

### Known limitations (prototype)

- A share link serves the *latest* version of the document at download time,
  not the version that existed when the link was created.
- Requesting a document ID that doesn't exist returns 404 while a real but
  forbidden one returns 403, which lets a signed-in user probe whether an ID
  exists. Acceptable for a prototype; a hardened build would return the same
  response for both.
- Denied access attempts are not yet written to the audit log (no audit
  action exists for it yet).
- Share links cannot yet be revoked early; they expire or run out.
