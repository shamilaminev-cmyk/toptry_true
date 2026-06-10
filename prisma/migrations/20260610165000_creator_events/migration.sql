CREATE TABLE IF NOT EXISTS "CreatorEvent" (
  "id" TEXT NOT NULL,
  "creatorUserId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "type" TEXT NOT NULL,
  "creatorSlug" TEXT,
  "collectionId" TEXT,
  "lookId" TEXT,
  "source" TEXT,
  "pageUrl" TEXT,
  "userAgent" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CreatorEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CreatorEvent_creatorUserId_createdAt_idx"
  ON "CreatorEvent"("creatorUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "CreatorEvent_actorUserId_createdAt_idx"
  ON "CreatorEvent"("actorUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "CreatorEvent_type_createdAt_idx"
  ON "CreatorEvent"("type", "createdAt");

CREATE INDEX IF NOT EXISTS "CreatorEvent_collectionId_idx"
  ON "CreatorEvent"("collectionId");

CREATE INDEX IF NOT EXISTS "CreatorEvent_lookId_idx"
  ON "CreatorEvent"("lookId");
