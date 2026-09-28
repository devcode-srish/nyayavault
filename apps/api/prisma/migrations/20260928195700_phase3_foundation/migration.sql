-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CustodyTransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PackageCondition" AS ENUM ('SEALED_INTACT', 'SEAL_BROKEN', 'DAMAGED', 'OPENED_FOR_EXAMINATION', 'RE_SEALED');

-- CreateEnum
CREATE TYPE "AccessScope" AS ENUM ('VIEW_METADATA', 'PREVIEW', 'DOWNLOAD', 'SHARE', 'TRANSFER_CUSTODY');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED', 'MISMATCH');

-- DropIndex
DROP INDEX IF EXISTS "DocumentAccess_documentId_userId_key";

-- AlterTable
ALTER TABLE "AccessRequest" ADD COLUMN     "accessGrantId" TEXT,
ADD COLUMN     "courtOrderRef" TEXT,
ADD COLUMN     "decisionNotes" TEXT,
ADD COLUMN     "durationHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "requestedScopes" "AccessScope"[] DEFAULT ARRAY['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD']::"AccessScope"[];

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "evidenceId" TEXT,
ADD COLUMN     "hash" VARCHAR(64),
ADD COLUMN     "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN     "previousHash" VARCHAR(64);

-- AlterTable
ALTER TABLE "DocumentAccess" ADD COLUMN     "grantedById" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "revokeReason" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedById" TEXT,
ADD COLUMN     "scopes" "AccessScope"[] DEFAULT ARRAY['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD']::"AccessScope"[];

-- AlterTable
ALTER TABLE "EvidenceTransfer" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "location" TEXT,
ADD COLUMN     "packageCondition" "PackageCondition" NOT NULL DEFAULT 'SEALED_INTACT',
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "sealNumber" TEXT,
ADD COLUMN     "status" "CustodyTransferStatus" NOT NULL DEFAULT 'COMPLETED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "actionUrl" TEXT,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "priority" "NotificationPriority" NOT NULL DEFAULT 'INFO',
ALTER COLUMN "type" SET DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "ShareLink" ADD COLUMN     "isRevoked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "tokenHash" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccessRequest_accessGrantId_key" ON "AccessRequest"("accessGrantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_evidenceId_idx" ON "AuditLog"("evidenceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_hash_idx" ON "AuditLog"("hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentAccess_documentId_userId_isActive_idx" ON "DocumentAccess"("documentId", "userId", "isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentAccess_expiresAt_isActive_idx" ON "DocumentAccess"("expiresAt", "isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenceTransfer_evidenceId_status_idx" ON "EvidenceTransfer"("evidenceId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenceTransfer_toUserId_status_idx" ON "EvidenceTransfer"("toUserId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenceTransfer_fromUserId_status_idx" ON "EvidenceTransfer"("fromUserId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShareLink_tokenHash_idx" ON "ShareLink"("tokenHash");

-- AddForeignKey
ALTER TABLE "DocumentAccess" ADD CONSTRAINT "DocumentAccess_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccess" ADD CONSTRAINT "DocumentAccess_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
