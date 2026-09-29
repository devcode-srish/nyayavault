# NyayaVault Phase 4.5 — Technical Architecture Specification (v3.4.0)
**Document Version:** 3.4.0 (Final Architecture & Independent Diagnostic Specification)  
**Status:** Planning Document Only — Strict Planning Boundary Applied  
**Target Milestone:** Phase 4, Milestone 4.5 — Forensic Courtroom Evidence Bundle Generator & Offline Verification Engine  
**Branch Checkpoint:** `aryan-dev` (Preserved at commit `1ce964b`)

---

## 1. Executive Summary & Architecture Overview

Phase 4.5 delivers the final milestone of Phase 4: the **Forensic Courtroom Evidence Bundle Generator and Zero-Dependency Offline Verifier (`verify.js`)**.

When an investigation proceeds to formal prosecution, judicial trial, or statutory disclosure, authorized officers export a self-contained, tamper-evident Court Docket Archive (`.zip`). This archive packages:
1. `artifacts/`: All primary electronic exhibits, multi-version document binaries, Section 65B/BSA certificate drafts (from 4.1), chronological investigation timelines (from 4.3), and physical custody handover receipts (from 4.4).
2. `manifest.json`: Structured RFC 8785 canonical metadata describing all exhibits, individual SHA-256 digests, the canonical Merkle root (`NYAYAVAULT-MERKLE-V1`), and an authority-signed audit checkpoint block.
3. `trust/`: The issuing server authority X.509 certificate (`authority_cert.pem`).
4. `verify.js`: A standalone, zero-dependency Node.js and browser-compatible verification engine.

---

## 2. Merkle Algorithm Specification (`NYAYAVAULT-MERKLE-V1`)

NyayaVault implements a versioned algorithm identified as **`NYAYAVAULT-MERKLE-V1`**. This algorithm combines RFC 6962 tree-folding/recursive-splitting rules with a domain-separated artifact leaf encoding.

### A. Formal Construction
1. **Artifact Scope:** All files inside `artifacts/` (excluding `manifest.json` and `verify.js`).
2. **Canonical Ordering:** Relative POSIX paths (forward slashes `/`) sorted in ascending order by raw UTF-8 byte comparison (`Buffer.compare`).
3. **Duplicate Path Invariant:** Any duplicate normalized path is strictly rejected (server returns `400 Bad Request` and verifier fails with `[FAIL] DUPLICATE_ARTIFACT_PATH_DETECTED`).
4. **Leaf Hash (`0x00` Prefix):**
   $$\text{LeafData}_i = \text{PathUtf8Bytes}_i \mathbin{\Vert} \text{0x00} \mathbin{\Vert} \text{SHA256}(\text{FileBytes}_i)$$
   $$\text{LeafHash}_i = \text{SHA256}(\text{0x00} \mathbin{\Vert} \text{LeafData}_i)$$
5. **Recursive Tree Splitting (RFC 6962 Tree Folding):**
   For leaf array $D = [L_0, L_1, \dots, L_{n-1}]$:
   - For $n = 0$: $\text{MTH}(\emptyset) = \text{SHA256}(\text{""}) = \text{e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855}$
   - For $n = 1$: $\text{MTH}([L_0]) = L_0$
   - For $n > 1$: Let $k$ be the largest power of 2 strictly less than $n$ ($k < n \le 2k$):
     $$\text{MTH}(D) = \text{SHA256}(\text{0x01} \mathbin{\Vert} \text{MTH}(D[0..k]) \mathbin{\Vert} \text{MTH}(D[k..n]))$$

### B. Fixed Cryptographic Test Vectors
- $N=0$ (Empty Set): `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- $N=1$ (`artifacts/exhibits/report.pdf`, `"NyayaVault Forensic Report Sample"`): `fda34a9c22accb1a39cfc7d68b2be258239017e4c9a12173388f5a4cad32ee12`
- $N=2$ (`artifacts/a.txt` `"A"`, `artifacts/b.txt` `"B"`): `27daca1cf4a72313e8e9300354eee8cea45ee2bc826f7d5c7088cea85a4c5057`
- $N=3$ (`artifacts/a.txt`, `artifacts/b.txt`, `artifacts/c.txt`): `3dd344a2b6b471abcfe37e48c28ed74fb274a72df96ab3b453de04c9e34c2039`
- $N=5$ (`artifacts/a.txt` ... `artifacts/e.txt`): `452c6123d938ddebd0511ccb2b428c2a6955795f65c5edc05db7b3f105e32c10`
- $N=1$ (`artifacts/empty.dat`, 0 bytes): `821b6474cef6a6d33805ce56b4d8c681d38e2ed5c8fc69e22ea3db4757dcb2a0`

---

## 3. Disaggregated Diagnostic Reporting Model

The offline verification engine (`verify.js`) strictly separates verification dimensions to avoid conflating cryptographic signature validity with identity trust or certificate revocation status.

```
+---------------------------------------------------------------------------------------------------+
|                            INDEPENDENT DIAGNOSTIC EVALUATION FIELDS                              |
|                                                                                                   |
|  1. Cryptographic Signature Validity  -> [ VALID | INVALID ]                                      |
|  2. Authority Identity Verification   -> [ PINNED | UNPINNED ]                                    |
|  3. Certificate Revocation Status     -> [ VALIDATED | REVOKED | UNVERIFIABLE_OFFLINE ]           |
+---------------------------------------------------------------------------------------------------+
```

### A. Dimension 1: Cryptographic Signature Validity
- **`VALID`**: The digital signature over the canonical RFC 8785 JCS checkpoint mathematically verifies using the public key supplied in `trust/authority_cert.pem`.
- **`INVALID`**: Mathematical verification fails, indicating byte corruption, tampering, or mismatched signing keys.
- *Scope:* Establishes strictly the mathematical relationship between the signature and the public key.

### B. Dimension 2: Authority Identity Verification
- **`PINNED`**: The SHA-256 SPKI fingerprint of the verification public key matches an independently provisioned, out-of-band trust anchor supplied by the examiner (`--trusted-authority-fp <HEX>`).
- **`UNPINNED`**: The public key was extracted solely from the bundled certificate without independent corroboration against a pinned trust anchor.
- *Scope:* Establishes whether the key used to verify the signature is recognized as belonging to the authentic institutional authority.

### C. Dimension 3: Certificate Revocation Status
- **`VALIDATED`**: Revocation status has been established using fresh, authenticated out-of-band revocation information (e.g., a signed CRL matching the trusted root).
- **`REVOKED`**: Authenticated revocation information confirms the certificate has been revoked.
- **`UNVERIFIABLE_OFFLINE`**: Default in air-gapped / offline environments where live OCSP responders or CRL distribution points cannot be queried.
- *Scope:* Reflects whether current revocation status could be independently verified.

### D. Reporting Rules & Non-Exaggerated Synthesis
- A valid signature against a pinned public key does **not** imply that revocation status has been checked.
- When revocation information is unavailable:
  - Signature validity is preserved as `VALID`.
  - Authority identity is preserved as `PINNED`.
  - Revocation status is reported explicitly as `UNVERIFIABLE_OFFLINE`.
  - The verifier explains: *"The signature matches the independently pinned public key, while current certificate revocation status remains unverified in this offline environment."*
- Single overarching labels (such as `AUTHENTIC`, `TRUSTED`, or `VERIFIED`) that imply certainty beyond the individual fields are strictly avoided.

---

## 4. Required Offline Verifier Diagnostic Output Example

When verifying an archive signed by a known authority where the examiner has pinned the root key fingerprint in an air-gapped setting:

```
================================================================================
           NYAYAVAULT COURT DOCKET OFFLINE VERIFICATION REPORT
================================================================================
Case Identifier       : CASE-2026-CR-8891
Docket Reference      : NYA-CRTB-2026-F9812A
Verification Timestamp: 2026-09-29T01:15:00.000Z

[1. ARTIFACT & MERKLE INTEGRITY]
- Path Uniqueness Check             : [PASS] Zero duplicate or conflicting paths
- Manifest Structural Schema        : [PASS] Valid RFC 8785 compliant JSON-LD
- Individual File SHA-256 (14/14)   : [PASS] All 14 files match manifest digests
- NYAYAVAULT-MERKLE-V1 Root Hash    : [PASS] Recomputed root matches manifest:
                                      8d5781a94191ba3d7eb3d052be157ff17094ee16dbb9627798daeb16d123d21b

[2. SECTION 65B EXHIBIT SIGNATURES]
- Forensic Officer ECDSA Signatures : [PASS] 4/4 digital signatures mathematically valid
- Signer Public Key Fingerprints    : [PASS] Fingerprints match certificate drafts

[3. AUTHORITY AUDIT CHECKPOINT DIAGNOSTICS]
- Cryptographic Signature Validity  : VALID
  (Signature mathematically verifies against public key in trust/authority_cert.pem)
- Authority Identity Verification   : PINNED
  (Key fingerprint matches independently provisioned trust anchor: e3a89b01c47289f0...)
- Certificate Revocation Status     : UNVERIFIABLE_OFFLINE
  (Air-gapped verification; live OCSP/CRL revocation information was unavailable)

DIAGNOSTIC SUMMARY:
The archive files and Merkle root are mathematically intact. The checkpoint signature
is VALID and matches the independently PINNED authority key. Current certificate
revocation status is UNVERIFIABLE_OFFLINE.

STATUTORY ADMISSIBILITY DISCLAIMER:
This report certifies mathematical file integrity, chronological custody provenance,
and authoritative electronic seal verification in accordance with NYAYAVAULT-MERKLE-V1,
RFC 8785, and Section 65B of the Indian Evidence Act / Section 63 of Bharatiya 
Sakshya Adhiniyam. Cryptographic validity does not constitute a judicial ruling on 
substantive truth or statutory admissibility.
================================================================================
```

---

## 5. Crash-Safe Lifecycle & Reconciliation Architecture

### A. Tri-State Audit Actions
1. `COURT_BUNDLE_INITIATED`: Recorded when bundle generation begins (`status: GENERATING`).
2. `COURT_BUNDLE_COMPLETED`: Recorded **only** after archive creation, byte-size verification, and storage persistence succeed (`status: COMPLETED`).
3. `COURT_BUNDLE_FAILED`: Recorded if bundling fails midway, documenting the failure cause (`status: FAILED`).

### B. Recovery & Reconciliation Rules
- **Orphan Cleanup:** If bundling throws an exception during assembly, temporary files are unlinked and `COURT_BUNDLE_FAILED` is recorded.
- **Durable Reconciler:** Background sweeps reconcile stale `GENERATING` records older than 15 minutes by marking them `FAILED` and logging compensatory `COURT_BUNDLE_FAILED` events.
- **Immutable Ledger Preservation:** Audit records are strictly append-only; failed attempts preserve both `COURT_BUNDLE_INITIATED` and `COURT_BUNDLE_FAILED` records for complete forensic traceability.

---

## 6. Additive Schema & API Contracts

### A. Additive Schema (`schema.prisma`)
```prisma
enum AuditAction {
  // ... existing actions ...
  COURT_BUNDLE_INITIATED
  COURT_BUNDLE_COMPLETED
  COURT_BUNDLE_FAILED
}

enum CourtBundleStatus {
  GENERATING
  COMPLETED
  FAILED
}

model CourtBundleExport {
  id                 String            @id @default(cuid())
  caseId             String
  case               Case              @relation(fields: [caseId], references: [id], onDelete: Cascade)
  bundleNumber       String            @unique @db.VarChar(64)
  courtRefNumber     String?           @db.VarChar(100)
  merkleRootHash     String?           @db.VarChar(64)
  authorityKeyFp     String?           @db.VarChar(64)
  authoritySignature String?           @db.Text
  zipStorageKey      String?
  zipSizeBytes       Int?
  status             CourtBundleStatus @default(GENERATING)
  errorMessage       String?           @db.Text
  manifestJson       Json?
  exportedById       String
  exportedBy         User              @relation(fields: [exportedById], references: [id])
  createdAt          DateTime          @default(now())
  completedAt        DateTime?

  @@index([caseId, status])
  @@index([exportedById])
  @@index([merkleRootHash])
  @@index([bundleNumber])
}
```

### B. Endpoints
- `POST /api/cases/:id/court-bundle`: Initiates bundle export (`ADMIN`, `SENIOR_OFFICER`, `INVESTIGATING_OFFICER`, `LEGAL_OFFICER` assigned to case).
- `GET /api/cases/:id/court-bundles`: Lists historical bundles for a case.
- `GET /api/cases/court-bundles/:bundleId/download`: Streams sealed `.zip` archive (verifies `status === COMPLETED`).

---

## 7. Strict Planning Boundary & Audit Confirmation

| Verification Check | Result | Confirmation Details |
| :--- | :---: | :--- |
| **Documentation File Created / Updated** | `docs/PHASE4_5_SPECIFICATION.md` | Formal Phase 4.5 v3.4.0 specification document written. |
| **Application Source Files Modified** | **0 Files** | No code in `apps/api` or `apps/web` modified. |
| **Database Schema / Migrations** | **0 Files** | `schema.prisma` and migrations remain untouched. |
| **Package Dependencies** | **0 Packages** | No packages installed. |
| **Git Working Tree State** | **Clean** (aside from new doc) | Branch `aryan-dev` preserved at commit `1ce964b`. |
| **Remote Push Boundary** | **Preserved** | 0 commits pushed to remote repository. |
