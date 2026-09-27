# Demo Data & Flow

## Data disclaimer

Every case, user, document, and evidence item in this project is
**synthetic/fictional**, created for the SIH26190 prototype demo. No real
investigation, legal, or personal data is used anywhere in this codebase.

## Seeded accounts (password: `Demo@1234`)

- admin@nyayavault.demo — ADMIN
- officer@nyayavault.demo — INVESTIGATING_OFFICER
- senior@nyayavault.demo — SENIOR_OFFICER
- forensic@nyayavault.demo — FORENSIC_OFFICER
- legal@nyayavault.demo — LEGAL_OFFICER

## Seeded cases

- CASE-2026-0142 — Digital Fraud Investigation
- CASE-2026-0143 — Cyber Extortion Complaint
- CASE-2026-0144 — Corporate Document Forgery
- CASE-2026-0145 — Identity Theft Ring

## Phase 1 demo script

1. Log in as each of the 5 demo accounts in turn and note the sidebar and
   dashboard content differ per role.
2. While logged in as `officer@nyayavault.demo`, open browser dev tools,
   copy the access token from `localStorage`, and call
   `GET /api/users` with it via curl — confirm you get `403`.
3. Log in as `admin@nyayavault.demo` and open **Users** — confirm the same
   call succeeds and lists all 5 seeded accounts.

## Full SIH demo flow (target — completed across all phases)

See `README.md` roadmap. The complete flow (upload → hash → verify →
custody → AI query → 403 → access request → approval → tamper simulation →
signature → audit trail) is specified in the project brief and will be
walkable end-to-end once Phases 2–5 are built.
