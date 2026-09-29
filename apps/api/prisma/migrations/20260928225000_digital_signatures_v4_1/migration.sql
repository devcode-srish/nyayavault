-- AlterTable
ALTER TABLE "DigitalSignature" ADD COLUMN IF NOT EXISTS "keyId" TEXT,
ADD COLUMN IF NOT EXISTS "publicKeyPem" TEXT,
ADD COLUMN IF NOT EXISTS "keyFingerprint" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "certificateNumber" TEXT,
ADD COLUMN IF NOT EXISTS "challengeNonce" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "signedPayloadJson" TEXT,
ALTER COLUMN "algorithm" SET DEFAULT 'ECDSA-P256-SHA256';

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserSigningKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "publicKeyPem" TEXT NOT NULL,
    "keyFingerprint" VARCHAR(64) NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ECDSA-P256-SHA256',
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserSigningKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SigningChallenge" (
    "id" TEXT NOT NULL,
    "nonce" VARCHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "versionSha256" VARCHAR(64) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "SigningChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserSigningKey_keyId_key" ON "UserSigningKey"("keyId");
CREATE INDEX IF NOT EXISTS "UserSigningKey_userId_isActive_idx" ON "UserSigningKey"("userId", "isActive");
CREATE INDEX IF NOT EXISTS "UserSigningKey_keyFingerprint_idx" ON "UserSigningKey"("keyFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DigitalSignature_certificateNumber_key" ON "DigitalSignature"("certificateNumber");
CREATE INDEX IF NOT EXISTS "DigitalSignature_documentVersionId_idx" ON "DigitalSignature"("documentVersionId");
CREATE INDEX IF NOT EXISTS "DigitalSignature_signerId_idx" ON "DigitalSignature"("signerId");
CREATE INDEX IF NOT EXISTS "DigitalSignature_keyFingerprint_idx" ON "DigitalSignature"("keyFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SigningChallenge_nonce_key" ON "SigningChallenge"("nonce");
CREATE INDEX IF NOT EXISTS "SigningChallenge_nonce_userId_idx" ON "SigningChallenge"("nonce", "userId");
CREATE INDEX IF NOT EXISTS "SigningChallenge_expiresAt_idx" ON "SigningChallenge"("expiresAt");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserSigningKey_userId_fkey') THEN
    ALTER TABLE "UserSigningKey" ADD CONSTRAINT "UserSigningKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DigitalSignature_keyId_fkey') THEN
    ALTER TABLE "DigitalSignature" ADD CONSTRAINT "DigitalSignature_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "UserSigningKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
