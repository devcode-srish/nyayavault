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
