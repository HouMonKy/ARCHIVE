"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { CatalogItem } from "@/lib/services/catalog"
import type { RecognitionJobDTO, CandidateDTO, ExtractionDTO } from "@/lib/services/recognition"
import type { AssetDTO } from "@/lib/services/assets"
import { ManualEntryForm } from "./manual-entry-form"
import { ErrorBanner, InfoBanner } from "./ui"
import { ReviewFlow } from "./review-flow"

const MAX_BYTES = 10 * 1024 * 1024
const RECOGNITION_TIMEOUT_MS = 180_000

const SAMPLES = [
  { file: "box-unicorn-demo.svg", label: "清晰盒面（单候选）" },
  { file: "box-zeta-glare-demo.svg", label: "反光模糊（3 候选）" },
  { file: "box-unknown-demo.svg", label: "目录外/未知（转手动）" },
  { file: "box-timeout-demo.svg", label: "识别超时演练" },
  { file: "photo-sample.jpg", label: "照片样例（JPEG·含封面）" },
]

type Step = "select" | "preview" | "recognizing" | "review" | "manual" | "done"

function validateFileClient(file: File): string | null {
  if (file.size > MAX_BYTES) {
    return `文件超过 10MB 上限（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩后重试`
  }
  const name = file.name.toLowerCase()
  const extOk = [".jpg", ".jpeg", ".png", ".webp"].some((ext) => name.endsWith(ext))
  if (!extOk && !file.type.startsWith("image/")) {
    return "不支持的文件类型：请上传 JPEG/PNG/WebP 照片"
  }
  return null
}

export function AddFlow({
  catalog,
  initialMode,
  recognitionMode = "fixture",
  fixtureUi = false,
  initialDraft,
}: {
  catalog: CatalogItem[]
  initialMode?: "manual"
  recognitionMode?: "fixture" | "http" | "kimi"
  /** E2E_MODE=1：Fixture 演示样例区可见（生产绝不渲染） */
  fixtureUi?: boolean
  /** 服务端预取的识别草稿（刷新后可选继续最近一次未确认识别） */
  initialDraft?: RecognitionJobDTO | null
}) {
  const router = useRouter()
  // 每次正常进入默认展示「拍照识别 / 从相册选择」两个按钮；
  // 旧识别草稿绝不自动替换上传首屏，只提供可选的「继续上次识别」入口。
  const [step, setStep] = useState<Step>(() => (initialMode === "manual" ? "manual" : "select"))
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [rotation, setRotation] = useState(0)
  const [job, setJob] = useState<RecognitionJobDTO | null>(null)
  const [draft, setDraft] = useState<RecognitionJobDTO | null>(initialDraft ?? null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [createdAsset, setCreatedAsset] = useState<AssetDTO | null>(null)
  const idempotencyKeyRef = useRef<string | null>(null)
  const captureInputRef = useRef<HTMLInputElement>(null)
  const albumInputRef = useRef<HTMLInputElement>(null)

  function ensureIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey()
    return idempotencyKeyRef.current
  }

  /** 继续上次识别（可选入口；不覆盖上传首屏） */
  function continueDraft() {
    if (!draft) return
    setJob(draft)
    setStep("review")
  }

  function discardDraft() {
    setDraft(null)
  }

  function pickFile(f: File | null | undefined) {
    if (!f) return
    const clientError = validateFileClient(f)
    if (clientError) {
      setUploadError(clientError)
      return
    }
    setUploadError(null)
    setFile(f)
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(f)
    })
    setRotation(0)
    setStep("preview")
  }

  async function upload(f: File, rotate = 0) {
    setUploadError(null)
    setFile(f)
    setStep("recognizing")
    setJob(null)
    setDraft(null)
    const form = new FormData()
    form.append("file", f)
    if (rotate) form.append("rotate", String(rotate))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RECOGNITION_TIMEOUT_MS)
    try {
      const res = await fetch("/api/recognition", { method: "POST", body: form, signal: controller.signal })
      const data = (await res.json()) as RecognitionJobDTO & { error?: string }
      if (!res.ok) {
        setUploadError(data.error ?? "上传失败，请重试")
        setStep("select")
        return
      }
      setJob(data)
      setStep("review")
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError"
      setUploadError(aborted ? "识别超时：请重试，或改用手动录入" : "网络异常，请重试，或改用手动录入")
      setStep("select")
    } finally {
      clearTimeout(timer)
    }
  }

  function submitPreview() {
    if (!file) return
    void upload(file, rotation)
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setFile(null)
    setRotation(0)
    setStep("select")
    if (captureInputRef.current) captureInputRef.current.value = ""
    if (albumInputRef.current) albumInputRef.current.value = ""
  }

  async function retryRecognition() {
    if (file) await upload(file, rotation)
  }

  /** 确认入库：官网候选 → officialCandidate；Provider 候选 → productId；无选择 → 自定义（编辑字段） */
  async function confirm(
    edits: ExtractionDTO & { nameZh: string },
    candidate: CandidateDTO | null,
    opts: { buildState: string; progress: number; purchasePriceMinor?: number | null; purchasedAt?: string | null },
  ) {
    if (!job) return
    setConfirmError(null)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        idempotencyKey: ensureIdempotencyKey(),
        jobId: job.jobId,
        coverId: job.cover?.id ?? undefined,
        dispositionState: "ACTIVE",
        buildState: opts.buildState,
        progress: opts.progress,
      }
      if (opts.purchasePriceMinor != null) body.purchasePriceMinor = opts.purchasePriceMinor
      if (opts.purchasedAt) body.purchasedAt = opts.purchasedAt
      if (candidate?.key) {
        // 官网候选（已验证）：确认后建档官方商品 + 下载官网图设为收藏封面
        body.officialCandidate = {
          key: candidate.key,
          officialName: candidate.officialName,
          nameZh: candidate.nameZh ?? (edits.nameZh || null),
          productCode: candidate.productCode,
          pageUrl: candidate.pageUrl,
          imageUrl: candidate.imageUrl,
          sourceDomain: candidate.sourceDomain,
          brand: candidate.brand,
          grade: candidate.grade ?? (edits.grade || null),
          scale: candidate.scale ?? (edits.scale || null),
          modelNumber: candidate.modelNumber ?? (edits.modelNumber || null),
          series: candidate.series ?? (edits.series || null),
          releaseYear: candidate.releaseYear,
          line: candidate.line,
        }
      } else if (candidate?.productId) {
        body.productId = candidate.productId
      } else {
        body.custom = {
          name: edits.name.trim().slice(0, 80) || "未命名商品",
          brand: edits.brand.trim() || "其他",
        }
      }
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { asset?: AssetDTO; created?: boolean; error?: string }
      if (!res.ok || !data.asset) {
        setConfirmError(data.error ?? "确认失败，请重试")
        return
      }
      idempotencyKeyRef.current = newIdempotencyKey()
      router.push(`/collection/${data.asset.id}`)
      router.refresh()
    } catch {
      setConfirmError("网络异常，请重试（同一确认重复提交不会产生重复实体）")
    } finally {
      setSubmitting(false)
    }
  }

  function resetToSelect() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setStep("select")
    setFile(null)
    setJob(null)
    setCreatedAsset(null)
    setUploadError(null)
    setConfirmError(null)
    if (captureInputRef.current) captureInputRef.current.value = ""
    if (albumInputRef.current) albumInputRef.current.value = ""
  }

  function resetToManual() {
    setStep("manual")
    setJob(null)
    setUploadError(null)
    setConfirmError(null)
  }

  if (step === "done" && createdAsset) {
    return (
      <div className="mb-card space-y-4 p-6 text-center" data-testid="add-success">
        <div className="text-4xl" aria-hidden>
          ✅
        </div>
        <h2 className="text-lg font-bold text-ink">已确认入库：{createdAsset.displayName}</h2>
        <p className="text-sm text-[color:var(--ink-50)]">收藏统计与 Dashboard 已同步更新。</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={`/collection/${createdAsset.id}`} className="mb-btn mb-btn-primary">
            查看实体详情
          </Link>
          <Link href="/" className="mb-btn mb-btn-secondary">
            返回 Dashboard
          </Link>
          <button type="button" className="mb-btn mb-btn-secondary" onClick={resetToSelect}>
            继续添加
          </button>
        </div>
      </div>
    )
  }

  const aiConfigured = fixtureUi || recognitionMode !== "fixture"

  return (
    <div className="space-y-4" data-testid="add-flow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">拍照识别</h2>
        </div>
        {step !== "manual" ? (
          <button type="button" className="mb-btn mb-btn-secondary" onClick={resetToManual} data-testid="goto-manual">
            改用手动录入
          </button>
        ) : (
          <button type="button" className="mb-btn mb-btn-secondary" onClick={resetToSelect} data-testid="goto-upload">
            改用图片识别
          </button>
        )}
      </div>

      {step !== "manual" && (
        <section className="mb-card space-y-4 p-4" aria-label="拍照或选择照片" data-testid="upload-panel">
          {!aiConfigured ? (
            <InfoBanner>
              AI 未配置：未设置 Moonshot API Key，照片识别不可用（不会以演示数据冒充识别结果）。可使用下方手动录入，
              或在设置中配置密钥。
            </InfoBanner>
          ) : step === "select" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="mb-btn mb-btn-primary flex min-h-28 flex-col items-center justify-center gap-1 py-4"
                onClick={() => captureInputRef.current?.click()}
                data-testid="button-capture"
              >
                <span className="text-base font-bold">拍照识别</span>
                <span className="text-xs font-normal opacity-80">手机端调用相机拍摄盒面/实物</span>
              </button>
              <button
                type="button"
                className="mb-btn mb-btn-secondary flex min-h-28 flex-col items-center justify-center gap-1 py-4"
                onClick={() => albumInputRef.current?.click()}
                data-testid="button-album"
              >
                <span className="text-base font-bold">从相册选择</span>
                <span className="text-xs font-normal opacity-80">选择已拍摄的照片</span>
              </button>
              <input
                ref={captureInputRef}
                className="hidden"
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="拍照识别"
                data-testid="input-capture"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              <input
                ref={albumInputRef}
                className="hidden"
                type="file"
                accept="image/*"
                aria-label="从相册选择"
                data-testid="input-album"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              <p className="text-xs text-[color:var(--ink-50)] sm:col-span-2" data-testid="upload-hint">
                手机端调用相机，电脑端选择文件。支持 JPEG/PNG/WebP，单文件 ≤10MB；
                上传后自动修正方向并压缩，原图不落库、不公开。
              </p>
              {draft && draft.state === "SUCCEEDED" && (
                <div
                  className="mb-card flex flex-wrap items-center justify-between gap-2 p-3 sm:col-span-2"
                  data-testid="draft-resume"
                >
                  <p className="text-xs text-[color:var(--ink-70)]">
                    有一次未确认的识别（{draft.extraction?.name ?? `候选 ${draft.candidates.length} 个`}）
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className="mb-btn mb-btn-secondary text-xs" onClick={continueDraft} data-testid="continue-draft">
                      继续上次识别
                    </button>
                    <button type="button" className="mb-btn mb-btn-secondary text-xs" onClick={discardDraft} data-testid="discard-draft">
                      忽略
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : step === "preview" && previewUrl ? (
            <div className="space-y-3" data-testid="photo-preview">
              <img
                src={previewUrl}
                alt="待识别照片预览"
                className="pointer-events-none mx-auto block max-h-80 w-auto rounded border border-aluminium object-contain"
                style={{ transform: `rotate(${rotation}deg)` }}
                data-testid="photo-preview-img"
              />
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  className="mb-btn mb-btn-secondary"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  data-testid="rotate-photo"
                >
                  旋转（当前 {rotation}°）
                </button>
                <button type="button" className="mb-btn mb-btn-secondary" onClick={retake} data-testid="retake-photo">
                  重拍/重选
                </button>
                <button
                  type="button"
                  className="mb-btn mb-btn-primary"
                  onClick={submitPreview}
                  data-testid="recognize-submit"
                >
                  开始识别
                </button>
              </div>
            </div>
          ) : null}

          {fixtureUi && step !== "recognizing" && step !== "preview" && (
            <div>
              <p className="mb-1 text-xs font-medium text-[color:var(--ink-50)]">或载入演示样例（E2E 演练，非官网素材）：</p>
              <div className="flex flex-wrap gap-2">
                {SAMPLES.map((s) => (
                  <button
                    key={s.file}
                    type="button"
                    className="mb-btn mb-btn-secondary text-xs"
                    onClick={async () => {
                      const res = await fetch(`/demo/samples/${s.file}`)
                      const blob = await res.blob()
                      void upload(new File([blob], s.file, { type: blob.type || "image/svg+xml" }))
                    }}
                    data-testid={`sample-${s.file}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {step === "recognizing" && (
            <p className="flex items-center gap-2 text-sm text-blueprint" role="status" data-testid="recognizing">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blueprint border-t-indigo-600" aria-hidden />
              识别中…
            </p>
          )}
          {uploadError && <ErrorBanner message={uploadError} hint="识别失败不影响手动新增，可直接改用手动录入。" />}
        </section>
      )}

      {step === "review" && job && (
        <ReviewFlow
          job={job}
          submitting={submitting}
          confirmError={confirmError}
          onRetry={() => void retryRecognition()}
          onManual={resetToManual}
          onConfirm={(edits, candidate, opts) => void confirm(edits, candidate, opts)}
        />
      )}

      {step === "manual" && (
        <section className="mb-card space-y-4 p-4" aria-label="手动录入" data-testid="manual-panel">
          <InfoBanner>手动录入永远可用：识别失败、低置信或非目录品类都可以在这里登记。</InfoBanner>
          <ManualEntryForm
            catalog={catalog}
            onCreated={(asset) => {
              setCreatedAsset(asset)
              setStep("done")
              router.refresh()
            }}
          />
        </section>
      )}
    </div>
  )
}

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`
}
