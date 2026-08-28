-- CreateTable
CREATE TABLE "AssetCover" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    "assetId" TEXT,
    CONSTRAINT "AssetCover_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CollectionAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RecognitionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerVersion" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "resultJson" TEXT,
    "extractionJson" TEXT,
    "errorCode" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coverId" TEXT,
    CONSTRAINT "RecognitionJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecognitionJob_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "AssetCover" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RecognitionJob" ("confirmedAt", "createdAt", "errorCode", "fileName", "fileSha256", "fileSize", "id", "provider", "providerVersion", "resultJson", "state", "userId") SELECT "confirmedAt", "createdAt", "errorCode", "fileName", "fileSha256", "fileSize", "id", "provider", "providerVersion", "resultJson", "state", "userId" FROM "RecognitionJob";
DROP TABLE "RecognitionJob";
ALTER TABLE "new_RecognitionJob" RENAME TO "RecognitionJob";
CREATE UNIQUE INDEX "RecognitionJob_coverId_key" ON "RecognitionJob"("coverId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AssetCover_fileName_key" ON "AssetCover"("fileName");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCover_assetId_key" ON "AssetCover"("assetId");

-- CreateIndex
CREATE INDEX "AssetCover_userId_createdAt_idx" ON "AssetCover"("userId", "createdAt");
