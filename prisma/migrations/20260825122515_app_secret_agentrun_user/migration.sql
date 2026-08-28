-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "userId" TEXT;

-- CreateTable
CREATE TABLE "AppSecret" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);
