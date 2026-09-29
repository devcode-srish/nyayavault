-- CreateEnum
CREATE TYPE "StorageScanStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('VERIFIED', 'MISMATCH', 'MISSING', 'UNREADABLE', 'ERROR');

-- CreateTable
CREATE TABLE "StorageScanRun" (
    "id" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "caseId" TEXT,
    "status" "StorageScanStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "totalVersions" INTEGER NOT NULL DEFAULT 0,
    "processedVersions" INTEGER NOT NULL DEFAULT 0,
    "verifiedCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "unreadableCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "elapsedMs" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "StorageScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageScanFinding" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "documentId" TEXT,
    "documentVersionId" TEXT,
    "caseId" TEXT,
    "documentName" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "FindingStatus" NOT NULL,
    "expectedSha256" VARCHAR(64) NOT NULL,
    "actualSha256" VARCHAR(64),
    "reason" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageScanFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorageScanRun_initiatedById_idx" ON "StorageScanRun"("initiatedById");
CREATE INDEX "StorageScanRun_caseId_idx" ON "StorageScanRun"("caseId");
CREATE INDEX "StorageScanRun_startedAt_idx" ON "StorageScanRun"("startedAt");
CREATE INDEX "StorageScanRun_status_idx" ON "StorageScanRun"("status");

-- CreateIndex
CREATE INDEX "StorageScanFinding_scanRunId_idx" ON "StorageScanFinding"("scanRunId");
CREATE INDEX "StorageScanFinding_documentId_idx" ON "StorageScanFinding"("documentId");
CREATE INDEX "StorageScanFinding_documentVersionId_idx" ON "StorageScanFinding"("documentVersionId");
CREATE INDEX "StorageScanFinding_caseId_idx" ON "StorageScanFinding"("caseId");
CREATE INDEX "StorageScanFinding_status_idx" ON "StorageScanFinding"("status");
CREATE INDEX "StorageScanFinding_scannedAt_idx" ON "StorageScanFinding"("scannedAt");

-- AddForeignKey
ALTER TABLE "StorageScanRun" ADD CONSTRAINT "StorageScanRun_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StorageScanRun" ADD CONSTRAINT "StorageScanRun_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageScanFinding" ADD CONSTRAINT "StorageScanFinding_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "StorageScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorageScanFinding" ADD CONSTRAINT "StorageScanFinding_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StorageScanFinding" ADD CONSTRAINT "StorageScanFinding_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
