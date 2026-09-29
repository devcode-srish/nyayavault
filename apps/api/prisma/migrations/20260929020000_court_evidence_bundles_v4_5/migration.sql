-- Additive Migration for NyayaVault Milestone 4.5: Courtroom Evidence Bundles & Merkle Integrity
-- Purely additive and non-destructive.

-- AlterEnum AuditAction
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COURT_BUNDLE_INITIATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COURT_BUNDLE_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COURT_BUNDLE_FAILED';

-- CreateEnum CourtBundleStatus
DO $$ BEGIN
    CREATE TYPE "CourtBundleStatus" AS ENUM ('GENERATING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable CourtBundleExport
CREATE TABLE IF NOT EXISTS "CourtBundleExport" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "bundleNumber" VARCHAR(64) NOT NULL,
    "courtRefNumber" VARCHAR(100),
    "merkleRootHash" VARCHAR(64),
    "authorityKeyFp" VARCHAR(64),
    "authoritySignature" TEXT,
    "zipStorageKey" TEXT,
    "zipSizeBytes" INTEGER,
    "status" "CourtBundleStatus" NOT NULL DEFAULT 'GENERATING',
    "errorMessage" TEXT,
    "manifestJson" JSONB,
    "exportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CourtBundleExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CourtBundleExport_bundleNumber_key" ON "CourtBundleExport"("bundleNumber");
CREATE INDEX IF NOT EXISTS "CourtBundleExport_caseId_status_idx" ON "CourtBundleExport"("caseId", "status");
CREATE INDEX IF NOT EXISTS "CourtBundleExport_exportedById_idx" ON "CourtBundleExport"("exportedById");
CREATE INDEX IF NOT EXISTS "CourtBundleExport_merkleRootHash_idx" ON "CourtBundleExport"("merkleRootHash");
CREATE INDEX IF NOT EXISTS "CourtBundleExport_bundleNumber_idx" ON "CourtBundleExport"("bundleNumber");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "CourtBundleExport" ADD CONSTRAINT "CourtBundleExport_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "CourtBundleExport" ADD CONSTRAINT "CourtBundleExport_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
