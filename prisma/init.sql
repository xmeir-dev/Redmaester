-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'x',
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "scope" TEXT,
    "tokenType" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "authorHandle" TEXT NOT NULL,
    "authorName" TEXT,
    "url" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "bookmarkedAt" DATETIME NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BookmarkFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookmarkId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookmarkFolder_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BookmarkFolder_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentRouting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tweetId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "department" TEXT,
    "confidence" REAL NOT NULL,
    "distilledInsight" TEXT NOT NULL,
    "rationale" TEXT,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" DATETIME,
    "routedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceRunId" TEXT,
    CONSTRAINT "AgentRouting_tweetId_fkey" FOREIGN KEY ("tweetId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InsightVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routingId" TEXT NOT NULL,
    "distilledInsight" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InsightVersion_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "AgentRouting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TriageQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tweetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedSkillName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    CONSTRAINT "TriageQueue_tweetId_fkey" FOREIGN KEY ("tweetId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "estimatedCostUsd" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "newBookmarks" INTEGER NOT NULL DEFAULT 0,
    "routedCount" INTEGER NOT NULL DEFAULT 0,
    "triagedCount" INTEGER NOT NULL DEFAULT 0,
    "enrichedCount" INTEGER NOT NULL DEFAULT 0,
    "classifiedCount" INTEGER NOT NULL DEFAULT 0,
    "skillsCreated" INTEGER NOT NULL DEFAULT 0,
    "referencesAttached" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "sourceBookmarkId" TEXT,
    "fsSyncedAt" DATETIME,
    "fsHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BookmarkEnrichment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookmarkId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT,
    "contentLength" INTEGER NOT NULL DEFAULT 0,
    "fetchMethod" TEXT NOT NULL,
    "fetchError" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookmarkEnrichment_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookmarkClassification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookmarkId" TEXT NOT NULL,
    "classificationType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "rationale" TEXT,
    "extractedSkillName" TEXT,
    "extractedSkillContent" TEXT,
    "matchedSkillId" TEXT,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "sourceRunId" TEXT,
    "classifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookmarkClassification_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BookmarkClassification_matchedSkillId_fkey" FOREIGN KEY ("matchedSkillId") REFERENCES "Skill" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "bookmarkId" TEXT NOT NULL,
    "rationale" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillReference_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillReference_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_provider_userId_key" ON "AuthToken"("provider", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BookmarkFolder_bookmarkId_folderId_key" ON "BookmarkFolder"("bookmarkId", "folderId");

-- CreateIndex
CREATE INDEX "AgentRouting_tweetId_idx" ON "AgentRouting"("tweetId");

-- CreateIndex
CREATE INDEX "AgentRouting_skillName_idx" ON "AgentRouting"("skillName");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRouting_tweetId_skillName_key" ON "AgentRouting"("tweetId", "skillName");

-- CreateIndex
CREATE INDEX "TriageQueue_status_idx" ON "TriageQueue"("status");

-- CreateIndex
CREATE INDEX "TriageQueue_tweetId_idx" ON "TriageQueue"("tweetId");

-- CreateIndex
CREATE INDEX "ModelUsage_monthKey_idx" ON "ModelUsage"("monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "BookmarkEnrichment_bookmarkId_idx" ON "BookmarkEnrichment"("bookmarkId");

-- CreateIndex
CREATE INDEX "BookmarkEnrichment_url_idx" ON "BookmarkEnrichment"("url");

-- CreateIndex
CREATE UNIQUE INDEX "BookmarkEnrichment_bookmarkId_url_key" ON "BookmarkEnrichment"("bookmarkId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "BookmarkClassification_bookmarkId_key" ON "BookmarkClassification"("bookmarkId");

-- CreateIndex
CREATE INDEX "BookmarkClassification_classificationType_idx" ON "BookmarkClassification"("classificationType");

-- CreateIndex
CREATE INDEX "SkillReference_skillId_idx" ON "SkillReference"("skillId");

-- CreateIndex
CREATE INDEX "SkillReference_bookmarkId_idx" ON "SkillReference"("bookmarkId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillReference_skillId_bookmarkId_key" ON "SkillReference"("skillId", "bookmarkId");

