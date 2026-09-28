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

## Phase 3 demo script (access control, custody, sharing)

1. Log in as **officer@nyayavault.demo**, open **Cases > CASE-2026-0142**.
   "Confidential Informant Statement.txt" shows a **Restricted** lock.
2. Click it. The page shows **403 - Access restricted**. Optionally repeat
   the call with curl to show the API itself refuses.
3. Enter a reason and **Request access**. The status shows as pending.
4. Sign out, log in as **senior@nyayavault.demo**. The Notifications item has
   an unread badge. Open **Access Requests**, choose a duration, **Approve**.
5. Sign out, log in as the officer again. Notifications shows the approval;
   the document now opens, and its **Chain of Custody** shows: uploaded,
   access requested, access approved, accessed.
6. On the document page, create a **Secure Share Link** (1 download). Open
   the link in a private window (no login), download once, then reload:
   the link now says the download limit is reached.
7. Open **Evidence > USB Drive - Exhibit B** (held by the officer). Transfer
   it to Forensic Officer Iyer with a note. The timeline gains a
   "Transferred" entry. Log in as forensic to see it on their dashboard.
8. As senior or admin, open **Audit Log** and filter by
   `ACCESS APPROVED`, `DOCUMENT SHARED`, `EVIDENCE TRANSFERRED`.
