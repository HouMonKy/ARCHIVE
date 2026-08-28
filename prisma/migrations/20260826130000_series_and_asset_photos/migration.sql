-- 收藏地图与藏品照片（收藏工作台改造）
PRAGMA foreign_keys=OFF;

-- CatalogProduct.series：可空，承载 Bandai 作品 / LEGO 主题
ALTER TABLE "CatalogProduct" ADD COLUMN "series" TEXT;

-- line 放开为可空：LEGO 入库不再硬编码 SUPERCAR（SQLite 放开 NOT NULL 需重建表；
-- 外键指向本表的子表不重建——legacy_alter_table 保证 RENAME 不改子表引用）
PRAGMA legacy_alter_table=ON;
CREATE TABLE "new_CatalogProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "line" TEXT,
    "grade" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "nameZh" TEXT,
    "modelNumber" TEXT,
    "scale" TEXT,
    "series" TEXT,
    "officialProductCode" TEXT,
    "nameZhSource" TEXT,
    "officialPageUrl" TEXT,
    "officialImageUrl" TEXT,
    "releaseYear" INTEGER,
    "source" TEXT NOT NULL,
    "catalogVersion" TEXT NOT NULL,
    "imageSourcePage" TEXT,
    "imageSourceUrl" TEXT,
    "imageFetchedAt" DATETIME,
    "rightsBasis" TEXT,
    "imageCacheFile" TEXT,
    "imageSha256" TEXT,
    "imageStatus" TEXT
);
INSERT INTO "new_CatalogProduct" ("id","brand","category","line","grade","canonicalName","nameZh","modelNumber","scale","series","officialProductCode","nameZhSource","officialPageUrl","officialImageUrl","releaseYear","source","catalogVersion","imageSourcePage","imageSourceUrl","imageFetchedAt","rightsBasis","imageCacheFile","imageSha256","imageStatus")
SELECT "id","brand","category","line","grade","canonicalName","nameZh","modelNumber","scale","series","officialProductCode","nameZhSource","officialPageUrl","officialImageUrl","releaseYear","source","catalogVersion","imageSourcePage","imageSourceUrl","imageFetchedAt","rightsBasis","imageCacheFile","imageSha256","imageStatus" FROM "CatalogProduct";
DROP TABLE "CatalogProduct";
ALTER TABLE "new_CatalogProduct" RENAME TO "CatalogProduct";
PRAGMA legacy_alter_table=OFF;
CREATE INDEX "CatalogProduct_catalogVersion_idx" ON "CatalogProduct"("catalogVersion");
CREATE INDEX "CatalogProduct_brand_idx" ON "CatalogProduct"("brand");
CREATE INDEX "CatalogProduct_series_idx" ON "CatalogProduct"("series");

-- 藏品照片（一对多）：识别图永久保留首位（AssetCover 不变），用户可追加本人拍摄照片
CREATE TABLE "AssetPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetPhoto_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CollectionAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssetPhoto_fileName_key" ON "AssetPhoto"("fileName");
CREATE INDEX "AssetPhoto_assetId_createdAt_idx" ON "AssetPhoto"("assetId", "createdAt");

PRAGMA foreign_keys=ON;
