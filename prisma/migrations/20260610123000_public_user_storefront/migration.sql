-- Public user storefront fields
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "publicSlug" TEXT,
  ADD COLUMN IF NOT EXISTS "publicBio" TEXT,
  ADD COLUMN IF NOT EXISTS "publicSocialUrl" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_publicSlug_key"
  ON "User"("publicSlug");

-- Look collections for creator storefronts
CREATE TABLE IF NOT EXISTS "LookCollection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "coverLookId" TEXT,
  "isPublic" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LookCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LookCollectionItem" (
  "id" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "lookId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LookCollectionItem_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LookCollection_userId_fkey'
  ) THEN
    ALTER TABLE "LookCollection"
    ADD CONSTRAINT "LookCollection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LookCollectionItem_collectionId_fkey'
  ) THEN
    ALTER TABLE "LookCollectionItem"
    ADD CONSTRAINT "LookCollectionItem_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "LookCollection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LookCollectionItem_lookId_fkey'
  ) THEN
    ALTER TABLE "LookCollectionItem"
    ADD CONSTRAINT "LookCollectionItem_lookId_fkey"
    FOREIGN KEY ("lookId") REFERENCES "Look"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LookCollection_userId_isPublic_sortOrder_idx"
  ON "LookCollection"("userId", "isPublic", "sortOrder");

CREATE INDEX IF NOT EXISTS "LookCollection_coverLookId_idx"
  ON "LookCollection"("coverLookId");

CREATE UNIQUE INDEX IF NOT EXISTS "LookCollectionItem_collectionId_lookId_key"
  ON "LookCollectionItem"("collectionId", "lookId");

CREATE INDEX IF NOT EXISTS "LookCollectionItem_lookId_idx"
  ON "LookCollectionItem"("lookId");

CREATE INDEX IF NOT EXISTS "LookCollectionItem_collectionId_sortOrder_idx"
  ON "LookCollectionItem"("collectionId", "sortOrder");
