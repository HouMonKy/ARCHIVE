import { describe, expect, it, beforeAll } from "vitest"
import { getTestDb, resetTestDb } from "../helpers/db"
import { createRecognitionJob } from "@/lib/services/recognition"
import { AppError } from "@/lib/errors"
import { readSampleFile, fakeJpegBytes, fakePngBytesCorrupted, oversizeBytes } from "../helpers/files"

/**
 * Fixture 识别样例（PRD §19）：
 * - unicorn → P03=0.96 可预选；zeta → P02=0.74/P09=0.66/P10=0.61 需主动选择；
 * - unknown → 无 ≥0.60 候选转手动；timeout → 超时错误；
 * - 任何失败不阻塞手动新增；确认前不写收藏数据。
 */
describe("Fixture 识别（演示数据，低置信与目录外）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("box-unicorn-demo.svg 返回 P03 候选与原始提取（不再自动预选——禁止置信度自动命中）", async () => {
    const dto = await createRecognitionJob(getTestDb(), "kai", readSampleFile("box-unicorn-demo.svg"))
    expect(dto.state).toBe("SUCCEEDED")
    expect(dto.demoMode).toBe(true)
    expect(dto.isFixture).toBe(true)
    expect(dto.candidates).toHaveLength(1)
    const candidate = dto.candidates[0]!
    expect(candidate.productId).toBe("P03")
    expect(candidate.confidence).toBeCloseTo(0.96, 5)
    // 识别主链路重构：无 preselect 字段/自动命中；候选须用户显式选择
    expect("preselect" in candidate).toBe(false)
    // Provider 候选展示目录商品名
    expect(candidate.officialName).toBeTruthy()
    // Kimi 原始提取原样可见（绝不被目录覆盖）
    expect(dto.extraction).toMatchObject({ brand: "Bandai", name: "MG Unicorn Gundam Ver.Ka", grade: "MG", scale: "1/100" })
  })

  it("box-zeta-glare-demo.svg 返回 3 个候选且均不预选（0.60–0.89 低置信）", async () => {
    const dto = await createRecognitionJob(getTestDb(), "kai", readSampleFile("box-zeta-glare-demo.svg"))
    expect(dto.state).toBe("SUCCEEDED")
    expect(dto.candidates.map((c) => c.productId)).toEqual(["P02", "P09", "P10"])
    expect(dto.candidates.map((c) => c.confidence)).toEqual([0.74, 0.66, 0.61])
    expect(dto.candidates[0]!.uncertainFields.length).toBeGreaterThan(0)
    expect(dto.message).toContain("候选")
  })

  it("box-unknown-demo.svg 无 ≥0.60 候选，提示转手动", async () => {
    const dto = await createRecognitionJob(getTestDb(), "kai", readSampleFile("box-unknown-demo.svg"))
    expect(dto.state).toBe("SUCCEEDED")
    expect(dto.candidates).toHaveLength(0)
    expect(dto.message).toContain("手动")
  })

  it("box-timeout-demo.svg 返回超时失败（可重试、可手动）", async () => {
    const dto = await createRecognitionJob(getTestDb(), "kai", readSampleFile("box-timeout-demo.svg"))
    expect(dto.state).toBe("FAILED")
    expect(dto.errorCode).toBe("TIMEOUT")
    expect(dto.message).toContain("超时")
  })

  it("目录外图片（任意 JPEG 字节）不虚构候选", async () => {
    const dto = await createRecognitionJob(getTestDb(), "kai", { name: "random.jpg", mimeType: "image/jpeg", bytes: fakeJpegBytes() })
    expect(dto.candidates).toHaveLength(0)
    expect(dto.message).toContain("手动")
  })

  it("未确认前收藏相关表写入为 0（识别只落审计任务）", async () => {
    await resetTestDb()
    const db = getTestDb()
    const assetsBefore = await db.collectionAsset.count()
    const intentsBefore = await db.userProductIntent.count()
    await createRecognitionJob(db, "kai", readSampleFile("box-unicorn-demo.svg"))
    await createRecognitionJob(db, "kai", readSampleFile("box-zeta-glare-demo.svg"))
    await createRecognitionJob(db, "kai", readSampleFile("box-timeout-demo.svg"))
    expect(await db.collectionAsset.count()).toBe(assetsBefore)
    expect(await db.userProductIntent.count()).toBe(intentsBefore)
    // 识别审计记录存在且可追溯
    expect(await db.recognitionJob.count()).toBeGreaterThanOrEqual(3)
    expect(await db.agentRun.count()).toBeGreaterThanOrEqual(3)
  })

  it("超限文件与损坏文件在上传层被拒绝且不产生识别任务", async () => {
    await resetTestDb()
    const db = getTestDb()
    const jobsBefore = await db.recognitionJob.count()
    await expect(
      createRecognitionJob(db, "kai", { name: "big.jpg", mimeType: "image/jpeg", bytes: oversizeBytes() }),
    ).rejects.toMatchObject({ status: 400, code: "FILE_TOO_LARGE" })
    await expect(
      createRecognitionJob(db, "kai", { name: "bad.png", mimeType: "image/png", bytes: fakePngBytesCorrupted() }),
    ).rejects.toMatchObject({ status: 400, code: "CORRUPT_FILE" })
    expect(await db.recognitionJob.count()).toBe(jobsBefore)
    expect(() => {
      throw new AppError("x")
    }).toThrow(AppError)
  })
})
