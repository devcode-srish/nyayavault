# NyayaVault Phase 4 — Milestone 4.3 Implementation & Security Report
**Document Version:** 1.0.0
**Timestamp:** 2026-09-28T23:45:00+05:30
**Branch:** `aryan-dev`
**Milestone:** 4.3 — Investigation Timeline
**Commit Status:** Ready for Review (Uncommitted)

---

## 1. Executive Summary

Milestone 4.3 delivers the **Unified Investigation Timeline** for NyayaVault. The system creates a centralized, tamper-evident chronological view of case activity by aggregating server-authoritative `AuditLog` events and investigator field observations / milestones recorded in `InvestigationTimelineEvent`.

All mandatory architectural corrections have been strictly implemented:
1. **Semantically Correct Audit Logging:** Manual investigator notes emit the new additive audit action `INVESTIGATION_NOTE_CREATED`. No generic or inappropriate audit actions (`INTEGRITY_CHECK`, `CASE_CREATED`) are used.
2. **Deterministic Merged Pagination:** Implemented a unified hybrid pagination mechanism with 3-tier tie-breaking (`occurredAt` $\to$ `createdAt` $\to$ `id`), ensuring zero duplicated or dropped events across arbitrary page boundaries.
3. **Dual Timestamp Integrity:** Preserves user-supplied historical `occurredAt` timestamps while maintaining server-authoritative `createdAt` timestamps with validation against future dates.
4. **Honest Cryptographic Provenance:** Manual investigator notes explicitly have `auditProof: null` rather than claiming synthetic cryptographic verification. Only authentic hash-chained `AuditLog` events provide verification proofs.
5. **Case-Level Security & RBAC:** Comprehensive authorization boundaries on both timeline query and note ingestion endpoints, preventing cross-case IDOR leaks and unauthorized notes.

---

## 2. Database Schema & Migration

### Migration Identifier
- **Migration Path:** `apps/api/prisma/migrations/20260928234500_investigation_timeline_v4_3/migration.sql`
- **Type:** Purely Additive & Non-Destructive

### Additive Schema Updates
```prisma
enum AuditAction {
  LOGIN
  LOGOUT
  CASE_CREATED
  CASE_UPDATED
  DOCUMENT_UPLOADED
  DOCUMENT_VIEWED
  DOCUMENT_DOWNLOADED
  DOCUMENT_RESTRICTED
  DOCUMENT_UNRESTRICTED
  ACCESS_REQUESTED
  ACCESS_APPROVED
  ACCESS_REJECTED
  ACCESS_REVOKED
  SHARE_LINK_CREATED
  SHARE_LINK_ACCESSED
  CUSTODY_TRANSFER_INITIATED
  CUSTODY_TRANSFER_ACCEPTED
  CUSTODY_TRANSFER_REJECTED
  DOCUMENT_SIGNED
  STORAGE_SCAN_COMPLETED
  STORAGE_SCAN_TAMPER_DETECTED
  INVESTIGATION_NOTE_CREATED       // Added for Milestone 4.3
}

enum TimelineEventCategory {
  CASE_LIFECYCLE
  EVIDENCE_CUSTODY
  DOCUMENT_VERSIONING
  DIGITAL_SIGNATURE
  STORAGE_INTEGRITY
  ACCESS_SHARING
  INVESTIGATOR_NOTE
}

model InvestigationTimelineEvent {
  id          String                @id @default(uuid())
  caseId      String
  title       String
  description String?
  category    TimelineEventCategory @default(INVESTIGATOR_NOTE)
  isMilestone Boolean               @default(false)
  occurredAt  DateTime              @default(now())
  createdById String
  metadata    Json?
  createdAt   DateTime              @default(now())

  case      Case @relation(fields: [caseId], references: [id], onDelete: Cascade)
  createdBy User @relation(fields: [createdById], references: [id])

  @@index([caseId, occurredAt])
  @@index([category])
}
```

---

## 3. Architecture & API Implementation

### 1. Unified Timeline Service (`apps/api/src/services/timeline.service.ts`)
- **`getCaseTimeline(caseId, user, options)`**:
  - Fetches case-scoped `AuditLog` records and `InvestigationTimelineEvent` entries.
  - Normalizes audit records into typed timeline events (`mapAuditToTimelineCategory`) with human-readable titles, formatted descriptions, actor metadata, and cryptographic audit proofs.
  - Applies in-memory category, source, milestone, and free-text search filters.
  - Enforces deterministic 3-tier ordering:
    $$\text{sortKey} = (\text{occurredAt}, \text{createdAt}, \text{id})$$
  - Performs slice-based pagination and returns `totalEvents`, `page`, `totalPages`, `hasNextPage`, and `hasPrevPage`.
- **`createInvestigationNote(caseId, user, data)`**:
  - Validates note payload (`title` non-empty, `occurredAt` not in the future).
  - Persists `InvestigationTimelineEvent` and transactionally records `INVESTIGATION_NOTE_CREATED` in `AuditLog` to maintain complete audit accountability.

### 2. Case-Scoped Timeline Endpoints (`apps/api/src/routes/cases.routes.ts`)
- `GET /api/cases/:id/timeline`:
  - Enforces case membership or `ADMIN` role.
  - Supports query parameters: `category`, `source`, `isMilestone`, `search`, `page`, `limit`, `order`.
- `POST /api/cases/:id/timeline`:
  - Enforces write permission (`ADMIN`, `INVESTIGATING_OFFICER`, `SENIOR_OFFICER`, `FORENSIC_OFFICER`, `LEGAL_OFFICER`) and case assignment.
  - Emits HTTP 201 Created with persisted event.

### 3. Frontend Timeline Interface (`apps/web/src/pages/CaseDetail.tsx`)
- Integrated 3-tab layout: **Investigation Timeline**, **Documents & Upload**, and **Overview & Members**.
- Interactive category filter pills (`All`, `Case Lifecycle`, `Evidence Custody`, `Document Versions`, `Signatures`, `Integrity`, `Access & Sharing`, `Investigator Notes`).
- Source toggle (`All Sources`, `Audit Log`, `Manual Notes`) and `Milestones Only` filter switch.
- Search input with real-time keyword matching on titles and descriptions.
- Modern chronological stream cards featuring category icons, milestone badges, author details, and dual timestamps (`Occurred` vs `Recorded`).
- "Record Milestone / Note" modal dialog with custom historical datetime picker and milestone flag.

---

## 4. Test Suite Execution & Results

### Exact Assertion Counts Across All Suites

| Test Suite | File | Executed | Passed | Failed | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Milestone 4.3 Suite** | `test-milestone-4-3.js` | 40 | 40 | 0 | **PASS** |
| **Milestone 4.2 Regression** | `test-milestone-4-2.js` | 42 | 42 | 0 | **PASS** |
| **Milestone 4.1 Regression** | `test-milestone-4-1.js` | 33 | 33 | 0 | **PASS** |
| **Master E2E Regression** | `test-master-e2e.js` | 54 | 54 | 0 | **PASS** |
| **TOTAL** | | **169** | **169** | **0** | **100% PASS** |

### Milestone 4.3 Detailed Test Breakdown
- **Query Case Timeline API:** 4/4 assertions passed.
- **Record Manual Investigation Notes & Milestones:** 8/8 assertions passed.
- **Deterministic Merged Pagination & 3-Tier Ordering:** 8/8 assertions passed (verified zero item overlap across page boundaries).
- **Category, Source, Milestone & Search Filtering:** 8/8 assertions passed.
- **Input Validation & Historical Timestamp Safety:** 2/2 assertions passed.
- **Authorization & Cross-Case IDOR Protection:** 6/6 assertions passed.
- **Audit Hash Chain Continuity:** 4/4 assertions passed.

---

## 5. Audit-Chain Continuity Verification

The full cryptographic audit hash chain was verified from Genesis to Tip via `/api/audit/verify`.

- **Audit Chain Status:** `VALID` (100% intact, 0 broken links, 0 tampered hashes)
- **Total Valid Audit Records in Chain:** **1,303 records**
- **Hash-Chain Algorithms:** SHA-256 with strict canonical payload serialization.

---

## 6. Security & Integrity Review

1. **Anti-IDOR Protection:** Case membership check (`verifyCaseAccess`) is executed prior to fetching timeline events or recording notes. Unassigned officers receive HTTP 403 Forbidden.
2. **Truthful Provenance:** Manual notes are never marked with simulated cryptographic audit proofs (`auditProof: null`). Audit-backed events include authoritative `AuditLog` IDs and hash values.
3. **Timestamp Manipulation Protection:** The `occurredAt` timestamp is validated to prevent future-dated entries ($>\text{now} + 24\text{h}$ skew allowance). The authoritative `createdAt` timestamp is set by PostgreSQL/server clock.
4. **Audit Trail Immutability:** Adding notes creates an immutable `INVESTIGATION_NOTE_CREATED` audit log entry, ensuring notes cannot be added anonymously.

---

## 7. Build Results

- **API Build (`tsc -p apps/api/tsconfig.json`):**
  `Exit Code: 0` (Clean compilation, 0 TypeScript errors).
- **Web Production Build (`tsc -b && vite build`):**
  `Exit Code: 0` (1,650 modules transformed, 0 bundle errors).

---

## 8. Git Status & Staging Summary

```
Changes not staged for commit:
	modified:   apps/api/prisma/schema.prisma
	modified:   apps/api/src/routes/cases.routes.ts
	modified:   apps/api/src/server.ts
	modified:   apps/web/src/pages/CaseDetail.tsx

Untracked files:
	NYAYAVAULT_PHASE4_MILESTONE_4_3_REPORT.md
	apps/api/prisma/migrations/20260928234500_investigation_timeline_v4_3/
	apps/api/prisma/scripts/test-milestone-4-3.js
	apps/api/src/services/timeline.service.ts
```

---

## 9. Known Limitations
- The current implementation merges case audit logs and investigation timeline events in memory within the timeline service. For cases with over 50,000 events, a database view or materialized table union could be considered in future performance optimization phases.
