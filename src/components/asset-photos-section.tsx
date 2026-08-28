"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

/**
 * 藏品照片区（详情页）：
 * - 识别图永久保留在首位并标记「入柜识别图」；用户照片按 createdAt 倒序；
 * - 始终显示上传按钮与相机/相册入口（手机端调用相机，电脑端选择文件）；
 * - 照片网格可点击查看大图；用户照片可二次确认后删除（识别图不可从照片区删除）；
 * - 仅本人可见（服务端逐请求校验）。
 */

const MAX_BYTES = 10 * 1024 * 1024

interface PhotoItem {
  id: string
  url: string
  createdAt: string
}

export function AssetPhotosSection({
  assetId,
  assetName,
  recognitionPhotoUrl,
  initialPhotos,
}: {
  assetId: string
  assetName: string
  recognitionPhotoUrl: string | null
  initialPhotos: PhotoItem[]
}) {
  const router = useRouter()
  const [photos, setPhotos] = useState<PhotoItem[]>(initialPhotos)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const captureRef = useRef<HTMLInputElement>(null)
  const albumRef = useRef<HTMLInputElement>(null)

  async function upload(file: File | null | undefined) {
    if (!file) return
    if (file.size > MAX_BYTES) {
      setError(`单张照片超过 10MB 上限（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`)
      return
    }
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`/api/assets/${assetId}/photos`, { method: "POST", body: form })
      const data = (await res.json()) as { photo?: PhotoItem; error?: string }
      if (!res.ok || !data.photo) {
        setError(data.error ?? "上传失败，请重试")
        return
      }
      setPhotos((prev) => [data.photo!, ...prev])
      router.refresh()
    } catch {
      setError("网络异常，请重试")
    } finally {
      setUploading(false)
      if (captureRef.current) captureRef.current.value = ""
      if (albumRef.current) albumRef.current.value = ""
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setError(null)
    try {
      const res = await fetch(`/api/assets/${assetId}/photos/${pendingDelete}`, { method: "DELETE" })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? "删除失败，请重试")
        return
      }
      setPhotos((prev) => prev.filter((p) => p.id !== pendingDelete))
      setPendingDelete(null)
    } catch {
      setError("网络异常，请重试")
    }
  }

  return (
    <section className="mb-card p-4" aria-label="藏品照片" data-testid="asset-photos-section">
      <h2 className="wb-label">藏品照片</h2>
      <p className="mt-1 text-xs" style={{ color: "var(--ink-50)" }}>
        保留入柜识别图，也可以上传自己拍摄的照片（仅本人可见）。
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="mb-btn mb-btn-primary text-xs"
          disabled={uploading}
          onClick={() => captureRef.current?.click()}
          data-testid="photo-capture-button"
        >
          {uploading ? "上传中…" : "拍摄照片"}
        </button>
        <button
          type="button"
          className="mb-btn mb-btn-secondary text-xs"
          disabled={uploading}
          onClick={() => albumRef.current?.click()}
          data-testid="photo-album-button"
        >
          从相册选择
        </button>
        <input
          ref={captureRef}
          className="hidden"
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="拍摄照片"
          data-testid="photo-capture-input"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <input
          ref={albumRef}
          className="hidden"
          type="file"
          accept="image/*"
          aria-label="从相册选择照片"
          data-testid="photo-album-input"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </div>
      {error && (
        <p className="mt-2 text-xs" role="alert" style={{ color: "var(--signal)" }} data-testid="photo-error">
          {error}
        </p>
      )}

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5" aria-label="藏品照片列表" data-testid="photo-grid">
        {recognitionPhotoUrl && (
          <li className="relative" data-testid="recognition-photo-item">
            <button
              type="button"
              className="block w-full"
              onClick={() => setLightbox(recognitionPhotoUrl)}
              aria-label={`${assetName} 入柜识别图，点击查看大图`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={recognitionPhotoUrl}
                alt={`${assetName} 入柜识别图`}
                className="aspect-square w-full rounded border border-aluminium bg-workbench object-cover"
                data-testid="recognition-photo-img"
              />
              <span
                className="absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: "rgba(33,26,11,0.85)", color: "#FFB000" }}
              >
                入柜识别图
              </span>
            </button>
          </li>
        )}
        {photos.map((photo) => (
          <li key={photo.id} className="relative" data-testid={`photo-item-${photo.id}`}>
            <button
              type="button"
              className="block w-full"
              onClick={() => setLightbox(photo.url)}
              aria-label={`${assetName} 照片，点击查看大图`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={`${assetName} 照片`}
                className="aspect-square w-full rounded border border-aluminium bg-workbench object-cover"
                data-testid={`photo-img-${photo.id}`}
              />
            </button>
            <button
              type="button"
              className="absolute right-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: "rgba(9,12,15,0.8)", color: "var(--signal)" }}
              onClick={() => setPendingDelete(photo.id)}
              aria-label="删除这张照片"
              data-testid={`photo-delete-${photo.id}`}
            >
              删除
            </button>
          </li>
        ))}
      </ul>
      {photos.length === 0 && !recognitionPhotoUrl && (
        <p className="mt-2 text-xs" style={{ color: "var(--ink-50)" }} data-testid="photo-empty">
          暂无照片：识别入柜时拍摄的照片会保留在这里，也可以上传自己拍摄的照片。
        </p>
      )}

      {/* 大图查看 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-label="照片大图"
          onClick={() => setLightbox(null)}
          data-testid="photo-lightbox"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="照片大图" className="max-h-[90vh] max-w-[90vw] rounded object-contain" />
          <button
            type="button"
            className="absolute right-4 top-4 mb-btn mb-btn-secondary"
            onClick={() => setLightbox(null)}
            data-testid="photo-lightbox-close"
          >
            关闭
          </button>
        </div>
      )}

      {/* 删除二次确认 */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-label="确认删除照片"
          data-testid="photo-delete-confirm"
        >
          <div className="mb-card space-y-3 p-4">
            <p className="text-sm font-semibold">删除这张照片？</p>
            <p className="text-xs" style={{ color: "var(--ink-50)" }}>
              删除后不可恢复；入柜识别图不受影响。
            </p>
            <div className="flex gap-2">
              <button type="button" className="mb-btn mb-btn-primary text-xs" onClick={() => void confirmDelete()} data-testid="photo-delete-confirm-yes">
                确认删除
              </button>
              <button type="button" className="mb-btn mb-btn-secondary text-xs" onClick={() => setPendingDelete(null)} data-testid="photo-delete-confirm-no">
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
