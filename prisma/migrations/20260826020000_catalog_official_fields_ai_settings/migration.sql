-- 目录商品：官网资料闭环字段（中文标准名 / 型号 / 官网商品页 / 官网原图 / 缓存与状态）
ALTER TABLE "CatalogProduct" ADD COLUMN "nameZh" TEXT;
ALTER TABLE "CatalogProduct" ADD COLUMN "modelNumber" TEXT;
ALTER TABLE "CatalogProduct" ADD COLUMN "officialProductCode" TEXT;
ALTER TABLE "CatalogProduct" ADD COLUMN "nameZhSource" TEXT;
ALTER TABLE "CatalogProduct" ADD COLUMN "officialPageUrl" TEXT;
ALTER TABLE "CatalogProduct" ADD COLUMN "officialImageUrl" TEXT;
ALTER TABLE "CatalogProduct" ADD COLUMN "imageCacheFile" TEXT;
ALTER TABLE "CatalogProduct" ADD COLUMN "imageSha256" TEXT;
ALTER TABLE "CatalogProduct" ADD COLUMN "imageStatus" TEXT;

-- AI Provider 设置（Owner 可配；API Key 服务端 AES-256-GCM 加密存储，绝不回显）
CREATE TABLE "AiProviderConfig" (
    "provider" TEXT NOT NULL PRIMARY KEY,
    "model" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
