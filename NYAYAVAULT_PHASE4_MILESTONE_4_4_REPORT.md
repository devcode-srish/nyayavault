# NyayaVault Phase 4 — Milestone 4.4 Implementation & Security Report
**Document Version:** 1.0.0
**Timestamp:** 2026-09-29T00:12:00+05:30
**Branch:** `aryan-dev`
**Milestone:** 4.4 — Physical Custody Receipts & QR Labels
**Commit Status:** Ready for Review

---

## 1. Executive Summary

Milestone 4.4 delivers the **Physical Evidence Custody Receipts & QR Tagging** subsystem for NyayaVault. This implementation securely links physical evidence exhibits to the digital repository through authenticated 256-bit QR codes and printable chain-of-custody handover receipts without weakening existing access controls or mutating audit records.

All required design corrections and operational safeguards have been implemented:
1. **Cryptographic 256-Bit Token Entropy:** All QR tokens are 32 cryptographically secure random bytes (64 hex characters) generated via CSPRNG.
2. **Encrypted Server-Side Storage:** Tokens are encrypted in the database using AES-256-GCM with unique 12-byte IVs and 16-byte authentication tags (`qrTokenEncrypted`), while index-level lookup is performed via SHA-256 token digests (`qrTokenHash`). Raw tokens are never stored in plaintext or logged.
3. **Anti-Oracle Public Verification:** Unauthenticated QR scans receive generic, rate-limited responses with zero metadata leakage. Full case records and custody histories are only disclosed to authenticated case members.
4. **Authoritative Receipt Integrity & Invariant Preservation:** Custody receipts accurately reflect the transfer lifecycle. Transfers in `PENDING` status display a high-visibility warning watermark (`PENDING TRANSFER — NOT VALID AS PROOF OF COMPLETED HANDOVER`). Receipt generation is strictly read-only and never mutates custody state.
5. **Instant Token Rotation:** Custodians can rotate QR codes at any time, immediately invalidating old physical labels and emitting an `EVIDENCE_QR_ROTATED` audit record.

---

## 2. Database Schema & Migration

### Migration Identifier
- **Migration Path:** `apps/api/prisma/migrations/20260929000500_physical_custody_receipts_qr_v4_4/migration.sql`
- **Type:** Additive & Non-Destructive

### Additive Schema Updates
```prisma
enum AuditAction {
  // ... existing actions ...
  CUSTODY_RECEIPT_GENERATED
  EVIDENCE_QR_ROTATED
}

model EvidenceItem {
  id                 String             @id @default(cuid())
  caseId             String
  case               Case               @relation(fields: [caseId], references: [id], onDelete: Cascade)
  name               String
  description        String?
  status             EvidenceStatus     @default(COLLECTED)
  currentCustodianId String?
  qrTokenHash        String?            @unique @db.VarChar(64)
  qrTokenEncrypted   String?            @db.Text
  qrRotatedAt        DateTime?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  transfers          EvidenceTransfer[]
  auditLogs          AuditLog[]

  @@index([caseId])
  @@index([qrTokenHash])
}

model EvidenceTransfer {
  id                 String                 @id @default(cuid())
  evidenceId         String
  evidence           EvidenceItem           @relation(fields: [evidenceId], references: [id], onDelete: Cascade)
  fromUserId         String?
  fromUser           User?                  @relation("TransferFrom", fields: [fromUserId], references: [id])
  toUserId           String
  toUser             User                   @relation("TransferTo", fields: [toUserId], references: [id])
  status             CustodyTransferStatus  @default(COMPLETED)
  purpose            String?
  sealNumber         String?
  packageCondition   PackageCondition       @default(SEALED_INTACT)
  location           String?
  notes              String?
  receiptNumber      String?                @unique @db.VarChar(64)
  decidedAt          DateTime?
  rejectionReason    String?
  transferredAt      DateTime               @default(now())

  @@index([evidenceId, status])
  @@index([toUserId, status])
  @@index([fromUserId, status])
  @@index([evidenceId])
  @@index([receiptNumber])
}
```

---

## 3. Architecture & API Implementation

### 1. Cryptographic Encryption Helper (`apps/api/src/lib/encryption.ts`)
- Implements AES-256-GCM authenticated encryption.
- Encrypted format: `ivHex:authTagHex:ciphertextHex`.
- Master key derived via SHA-256 hash of server secret (`ENCRYPTION_SECRET` / `JWT_ACCESS_SECRET`).

### 2. QR Code Engine (`apps/api/src/lib/qr.ts`)
- Generates 256-bit CSPRNG tokens and SHA-256 digests.
- Provides a self-contained, zero-dependency SVG vector renderer and Base64 Data URI generator for physical labels.

### 3. Custody Receipt Service (`apps/api/src/services/receipt.service.ts`)
- Derives stable, deterministic receipt references: `NYA-REC-YYYY-[transferIdSuffix]`.
- Assembles structured receipt DTOs with dual timestamps, transferring officers, package seal conditions, and linked audit hashes.
- Emits `CUSTODY_RECEIPT_GENERATED` audit entries only on explicit export requests.

### 4. Evidence Endpoints (`apps/api/src/routes/evidence.routes.ts`)
- `GET /api/evidence/:id/qr-label`: Retrieves or initializes active QR label.
- `POST /api/evidence/:id/rotate-qr`: Rotates QR token, invalidating prior physical tags and emitting `EVIDENCE_QR_ROTATED`.
- `GET /api/evidence/transfers/:transferId/receipt`: Generates structured receipt DTO (read-only; supports `?recordAudit=true`).
- `GET /api/evidence/verify/:token`: Rate-limited verification endpoint with tiered anti-oracle disclosure.

### 5. Frontend UI Components
- `EvidenceQRLabelModal.tsx`: Print-ready physical evidence tag modal with vector QR preview and rotate action.
- `CustodyReceiptModal.tsx`: Official printable custody transfer receipt with dynamic status watermark.
- `VerifyEvidence.tsx`: Evidence scanner and verification page.
- `EvidenceDetail.tsx`: Integrated QR label modal, receipt modal, and transfer timeline.

---

## 4. Test Suite Execution & Results

### Assertion Counts Across All Suites

| Test Suite | File | Executed | Passed | Failed | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Milestone 4.4 Suite** | `test-milestone-4-4.js` | 57 | 57 | 0 | **PASS** |
| **Milestone 4.3 Regression** | `test-milestone-4-3.js` | 40 | 40 | 0 | **PASS** |
| **Milestone 4.2 Regression** | `test-milestone-4-2.js` | 42 | 42 | 0 | **PASS** |
| **Milestone 4.1 Regression** | `test-milestone-4-1.js` | 33 | 33 | 0 | **PASS** |
| **Master E2E Regression** | `test-master-e2e.js` | 54 | 54 | 0 | **PASS** |
| **TOTAL** | | **226** | **226** | **0** | **100% PASS** |

---

## 5. Audit-Chain Verification Result

The full cryptographic audit hash chain was verified from Genesis to Tip via `/api/audit/verify`.

- **Audit Chain Status:** `VALID` (100% intact, 0 broken links, 0 tampered entries).
- **Total Valid Audit Records in Chain:** **1,368 records**.
- **Hash Continuity:** Preserved across all V1, V2, and V4 audit actions.

---

## 6. Build Results

- **API Build (`tsc -p apps/api/tsconfig.json`):**
  `Exit Code: 0` (0 TypeScript compilation errors).
- **Web Production Build (`tsc -b && vite build`):**
  `Exit Code: 0` (1,653 modules transformed, 0 bundle errors).

---

## 7. Security Review Findings

1. **Zero Raw Token Leakage:** Raw 256-bit QR tokens are never logged or stored in plaintext database tables. They exist only as AES-256-GCM ciphertexts and SHA-256 hashes.
2. **Anti-Oracle Defense:** Unauthenticated verification requests receive uniform responses, preventing brute-force enumeration of evidence tags.
3. **Restrictive Referrer-Policy:** Server enforces `no-referrer` to prevent bearer tokens in verification URLs from leaking to third parties.
4. **State Immutability:** Receipt retrieval and reprinting never alter custody state (`currentCustodianId` or `EvidenceTransfer.status`).
5. **Pending Watermark:** Receipts for pending transfers contain a mandatory watermark to prevent unverified physical handovers.
