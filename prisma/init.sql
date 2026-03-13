-- CreateEnum
CREATE TYPE "BookmarkRoleType" AS ENUM ('REFERENCE', 'MICRO_SKILL', 'IGNORE');

-- CreateEnum
CREATE TYPE "SkillKind" AS ENUM ('MASTER', 'MICRO');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('AUTO', 'FULL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "TriageStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "AgentRouting" (
    "id" TEXT NOT NULL,
    "tweetId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "department" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "distilledInsight" TEXT NOT NULL,
    "rationale" TEXT,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "routedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceRunId" TEXT,

    CONSTRAINT "AgentRouting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'x',
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "scope" TEXT,
    "tokenType" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorHandle" TEXT NOT NULL,
    "authorName" TEXT,
    "url" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "bookmarkedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookmarkBucketAssignment" (
    "id" TEXT NOT NULL,
    "bookmarkId" TEXT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookmarkBucketAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookmarkClassification" (
    "id" TEXT NOT NULL,
    "bookmarkId" TEXT NOT NULL,
    "classificationType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "bucketId" TEXT,
    "roleType" "BookmarkRoleType",
    "targetSkillId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "extractedSkillName" TEXT,
    "extractedSkillContent" TEXT,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "sourceRunId" TEXT,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookmarkClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookmarkEnrichment" (
    "id" TEXT NOT NULL,
    "bookmarkId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT,
    "contentLength" INTEGER NOT NULL DEFAULT 0,
    "fetchMethod" TEXT NOT NULL,
    "fetchError" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookmarkEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bucket" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dirtySince" TIMESTAMP(3),
    "lastMasterSynthesizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightVersion" (
    "id" TEXT NOT NULL,
    "routingId" TEXT NOT NULL,
    "distilledInsight" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelUsage" (
    "id" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "kind" "SkillKind" NOT NULL DEFAULT 'MICRO',
    "bucketId" TEXT,
    "parentSkillId" TEXT,
    "sourceBookmarkId" TEXT,
    "fsSyncedAt" TIMESTAMP(3),
    "fsHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillReference" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "bookmarkId" TEXT NOT NULL,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "mode" "SyncMode" NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "notes" TEXT,
    "newBookmarks" INTEGER NOT NULL DEFAULT 0,
    "routedCount" INTEGER NOT NULL DEFAULT 0,
    "triagedCount" INTEGER NOT NULL DEFAULT 0,
    "enrichedCount" INTEGER NOT NULL DEFAULT 0,
    "classifiedCount" INTEGER NOT NULL DEFAULT 0,
    "skillsCreated" INTEGER NOT NULL DEFAULT 0,
    "referencesAttached" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageQueue" (
    "id" TEXT NOT NULL,
    "tweetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" "TriageStatus" NOT NULL DEFAULT 'OPEN',
    "assignedSkillName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TriageQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRouting_skillName_idx" ON "AgentRouting"("skillName" ASC);

-- CreateIndex
CREATE INDEX "AgentRouting_tweetId_idx" ON "AgentRouting"("tweetId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRouting_tweetId_skillName_key" ON "AgentRouting"("tweetId" ASC, "skillName" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_provider_userId_key" ON "AuthToken"("provider" ASC, "userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookmarkBucketAssignment_bookmarkId_bucketId_key" ON "BookmarkBucketAssignment"("bookmarkId" ASC, "bucketId" ASC);

-- CreateIndex
CREATE INDEX "BookmarkBucketAssignment_bookmarkId_idx" ON "BookmarkBucketAssignment"("bookmarkId" ASC);

-- CreateIndex
CREATE INDEX "BookmarkBucketAssignment_bucketId_idx" ON "BookmarkBucketAssignment"("bucketId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookmarkClassification_bookmarkId_key" ON "BookmarkClassification"("bookmarkId" ASC);

-- CreateIndex
CREATE INDEX "BookmarkClassification_bucketId_idx" ON "BookmarkClassification"("bucketId" ASC);

-- CreateIndex
CREATE INDEX "BookmarkClassification_classificationType_idx" ON "BookmarkClassification"("classificationType" ASC);

-- CreateIndex
CREATE INDEX "BookmarkClassification_roleType_idx" ON "BookmarkClassification"("roleType" ASC);

-- CreateIndex
CREATE INDEX "BookmarkEnrichment_bookmarkId_idx" ON "BookmarkEnrichment"("bookmarkId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookmarkEnrichment_bookmarkId_url_key" ON "BookmarkEnrichment"("bookmarkId" ASC, "url" ASC);

-- CreateIndex
CREATE INDEX "BookmarkEnrichment_url_idx" ON "BookmarkEnrichment"("url" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Bucket_name_key" ON "Bucket"("name" ASC);

-- CreateIndex
CREATE INDEX "ModelUsage_monthKey_idx" ON "ModelUsage"("monthKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name" ASC);

-- CreateIndex
CREATE INDEX "SkillReference_bookmarkId_idx" ON "SkillReference"("bookmarkId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SkillReference_skillId_bookmarkId_key" ON "SkillReference"("skillId" ASC, "bookmarkId" ASC);

-- CreateIndex
CREATE INDEX "SkillReference_skillId_idx" ON "SkillReference"("skillId" ASC);

-- CreateIndex
CREATE INDEX "TriageQueue_status_idx" ON "TriageQueue"("status" ASC);

-- CreateIndex
CREATE INDEX "TriageQueue_tweetId_idx" ON "TriageQueue"("tweetId" ASC);

-- AddForeignKey
ALTER TABLE "AgentRouting" ADD CONSTRAINT "AgentRouting_tweetId_fkey" FOREIGN KEY ("tweetId") REFERENCES "Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookmarkBucketAssignment" ADD CONSTRAINT "BookmarkBucketAssignment_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookmarkBucketAssignment" ADD CONSTRAINT "BookmarkBucketAssignment_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "Bucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookmarkClassification" ADD CONSTRAINT "BookmarkClassification_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookmarkClassification" ADD CONSTRAINT "BookmarkClassification_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "Bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookmarkClassification" ADD CONSTRAINT "BookmarkClassification_targetSkillId_fkey" FOREIGN KEY ("targetSkillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookmarkEnrichment" ADD CONSTRAINT "BookmarkEnrichment_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightVersion" ADD CONSTRAINT "InsightVersion_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "AgentRouting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "Bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_parentSkillId_fkey" FOREIGN KEY ("parentSkillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillReference" ADD CONSTRAINT "SkillReference_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillReference" ADD CONSTRAINT "SkillReference_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageQueue" ADD CONSTRAINT "TriageQueue_tweetId_fkey" FOREIGN KEY ("tweetId") REFERENCES "Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

