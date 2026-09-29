-- Additive Migration for NyayaVault Milestone 4.4: Physical Custody Receipts & QR Labels
-- Purely additive and non-destructive.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CUSTODY_RECEIPT_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EVIDENCE_QR_ROTATED';

-- AlterTable EvidenceItem
ALTER TABLE "EvidenceItem" ADD COLUMN IF NOT EXISTS "qrTokenHash" VARCHAR(64);
ALTER TABLE "EvidenceItem" ADD COLUMN IF NOT EXISTS "qrTokenEncrypted" TEXT;
ALTER TABLE "EvidenceItem" ADD COLUMN IF NOT EXISTS "qrRotatedAt" TIMESTAMP(3);

-- AlterTable EvidenceTransfer
ALTER TABLE "EvidenceTransfer" ADD COLUMN IF NOT EXISTS "receiptNumber" VARCHAR(64);

-- CreateIndex for EvidenceItem
CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceItem_qrTokenHash_key" ON "EvidenceItem"("qrTokenHash");
CREATE INDEX IF NOT EXISTS "EvidenceItem_qrTokenHash_idx" ON "EvidenceItem"("qrTokenHash");

-- CreateIndex for EvidenceTransfer
CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceTransfer_receiptNumber_key" ON "EvidenceTransfer"("receiptNumber");
CREATE INDEX IF NOT EXISTS "EvidenceTransfer_receiptNumber_idx" ON "EvidenceTransfer"("receiptNumber");
