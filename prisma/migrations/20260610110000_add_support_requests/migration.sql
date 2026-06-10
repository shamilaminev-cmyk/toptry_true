-- CreateTable
CREATE TABLE IF NOT EXISTS "SupportRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "topic" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "source" TEXT NOT NULL DEFAULT 'profile',
  "pageUrl" TEXT,
  "lookId" TEXT,
  "productId" TEXT,
  "userAgent" TEXT,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SupportRequest_userId_fkey'
  ) THEN
    ALTER TABLE "SupportRequest"
    ADD CONSTRAINT "SupportRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportRequest_status_createdAt_idx"
  ON "SupportRequest"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "SupportRequest_userId_createdAt_idx"
  ON "SupportRequest"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "SupportRequest_topic_idx"
  ON "SupportRequest"("topic");

CREATE INDEX IF NOT EXISTS "SupportRequest_source_idx"
  ON "SupportRequest"("source");
