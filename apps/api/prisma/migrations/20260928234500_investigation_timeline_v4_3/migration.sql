-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVESTIGATION_NOTE_CREATED';

-- CreateEnum
CREATE TYPE "TimelineEventCategory" AS ENUM ('CASE_LIFECYCLE', 'EVIDENCE_CUSTODY', 'DOCUMENT_VERSIONING', 'DIGITAL_SIGNATURE', 'STORAGE_INTEGRITY', 'ACCESS_SHARING', 'INVESTIGATOR_NOTE');

-- AlterTable
ALTER TABLE "InvestigationTimelineEvent" ADD COLUMN IF NOT EXISTS "category" "TimelineEventCategory" NOT NULL DEFAULT 'INVESTIGATOR_NOTE';
ALTER TABLE "InvestigationTimelineEvent" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "InvestigationTimelineEvent" ADD COLUMN IF NOT EXISTS "isMilestone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InvestigationTimelineEvent" ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InvestigationTimelineEvent_caseId_occurredAt_idx" ON "InvestigationTimelineEvent"("caseId", "occurredAt");
CREATE INDEX IF NOT EXISTS "InvestigationTimelineEvent_category_idx" ON "InvestigationTimelineEvent"("category");
