-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "evidence" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "releaseYear" INTEGER,
    "source" TEXT NOT NULL,
    "catalogVersion" TEXT NOT NULL,
    "imageSourcePage" TEXT,
    "imageSourceUrl" TEXT,
    "imageFetchedAt" DATETIME,
    "rightsBasis" TEXT
);

-- CreateTable
CREATE TABLE "CollectionAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "catalogProductId" TEXT,
    "customName" TEXT,
    "customBrand" TEXT,
    "recognitionJobId" TEXT,
    "recognitionCorrected" BOOLEAN,
    "dispositionState" TEXT NOT NULL,
    "archivedAt" DATETIME,
    "buildState" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "purchasePriceMinor" INTEGER,
    "currency" TEXT,
    "purchasedAt" DATETIME,
    "completedAt" DATETIME,
    "note" TEXT,
    "confirmedAt" DATETIME NOT NULL,
    "idempotencyKey" TEXT,
    "lastActivityAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CollectionAsset_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CollectionAsset_recognitionJobId_fkey" FOREIGN KEY ("recognitionJobId") REFERENCES "RecognitionJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserProductIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "expectedPriceMinor" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserProductIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserProductIntent_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecognitionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerVersion" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "resultJson" TEXT,
    "errorCode" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecognitionJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReleaseEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "announcedAt" DATETIME NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "priceMinor" INTEGER,
    "datasetVersion" TEXT NOT NULL,
    CONSTRAINT "ReleaseEvent_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InsightReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "snapshotVersion" TEXT NOT NULL,
    "generatorVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InsightReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasonCodes" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "productId" TEXT,
    "assetId" TEXT,
    "sourceUrl" TEXT,
    "sourceDate" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Insight_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "InsightReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Insight_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Insight_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CollectionAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InsightFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "insightId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "actedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InsightFeedback_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "Insight" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InsightFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runType" TEXT NOT NULL,
    "inputVersion" TEXT,
    "outputRefs" TEXT,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_kind_key" ON "UserPreference"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionAsset_recognitionJobId_key" ON "CollectionAsset"("recognitionJobId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionAsset_idempotencyKey_key" ON "CollectionAsset"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserProductIntent_userId_catalogProductId_state_key" ON "UserProductIntent"("userId", "catalogProductId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "InsightReport_userId_periodEnd_key" ON "InsightReport"("userId", "periodEnd");
