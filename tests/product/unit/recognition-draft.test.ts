import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { getTestDb, resetTestDb } from "../../helpers/db"
import { createRecognitionJob, getLatestDraft } from "@/lib/services/recognition"
import { confirmAsset } from "@/lib/services/assets"

/**
 * 识别草稿恢复（返工轮任务 2）：成功未确认的识别在 24 小时内可恢复；
 * 确认后或超时后不再作为草稿返回。
 */

const SAMPLES_DIR = path.resolve(process.cwd(), "public/demo/samples")

function sampleFile(name: string) {
  return { name, mimeType: "image/svg+xml", bytes: new Uint8Array(readFileSync(path.join(SAMPLES_DIR, name))) }
}

describe("识别草稿恢复", () => {
  it("成功未确认的识别：返回草稿（候选 + 提供方），可继续确认", async () => {
    await resetTestDb()
    const db = getTestDb()
    const job = await createRecognitionJob(db, "kai", sampleFile("box-unicorn-demo.svg"))
    expect(job.state).toBe("SUCCEEDED")

    const draft = await getLatestDraft(db, "kai")
    expect(draft).not.toBeNull()
    expect(draft!.jobId).toBe(job.jobId)
    expect(draft!.candidates.length).toBeGreaterThan(0)
    expect(draft!.candidates[0]!.productId).toBe("P03")

    // 草稿可继续走确认
    const result = await confirmAsset(db, "kai", {
      idempotencyKey: "draft-confirm-test-1",
      jobId: draft!.jobId,
      productId: draft!.candidates[0]!.productId,
      buildState: "UNOPENED",
      progress: 0,
    })
    expect(result.created).toBe(true)
    // 确认后：不再是草稿
    expect(await getLatestDraft(db, "kai")).toBeNull()
  })

  it("多用户隔离：Demo 租户的草稿不泄露给 Owner", async () => {
    await resetTestDb()
    const db = getTestDb()
    await createRecognitionJob(db, "demo-guest", sampleFile("box-unicorn-demo.svg"))
    expect(await getLatestDraft(db, "kai")).toBeNull()
    expect(await getLatestDraft(db, "demo-guest")).not.toBeNull()
  })

  it("超过 24 小时的未确认识别：不再作为草稿返回", async () => {
    await resetTestDb()
    const db = getTestDb()
    const job = await createRecognitionJob(db, "kai", sampleFile("box-unicorn-demo.svg"))
    await db.recognitionJob.update({
      where: { id: job.jobId },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    })
    expect(await getLatestDraft(db, "kai")).toBeNull()
  })

  it("失败的识别任务不作为草稿返回", async () => {
    await resetTestDb()
    const db = getTestDb()
    await createRecognitionJob(db, "kai", sampleFile("box-timeout-demo.svg"))
    expect(await getLatestDraft(db, "kai")).toBeNull()
  })
})
