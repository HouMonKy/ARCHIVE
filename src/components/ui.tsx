import type { ReactNode } from "react"

/**
 * 识别模式标识：必须反映实际启用的 Provider（Fixture 演示 / Kimi 真实识别 / HTTP 适配）。
 * 演示识别不得伪装为真实模型调用；真实识别显著标注模型与目录匹配边界。
 */
export function RecognitionModeBadge({
  mode = "fixture",
  compact = false,
}: {
  mode?: "fixture" | "http" | "kimi"
  compact?: boolean
}) {
  if (mode === "kimi") {
    return (
      <span
        className="mb-badge border-transparent"
        style={{ background: "rgba(31,138,112,0.14)", color: "var(--success)", borderColor: "var(--success)" }}
        data-testid="recognition-mode-badge"
        title="已启用 Kimi（kimi-k2.6）真实视觉识别；候选由程序在官方目录内匹配"
      >
        真实识别（Kimi kimi-k2.6）
        {!compact && <span className="font-normal">· 结构化提取 + 目录匹配</span>}
      </span>
    )
  }
  if (mode === "http") {
    return (
      <span
        className="mb-badge border-transparent"
        style={{ background: "rgba(31,138,112,0.14)", color: "var(--success)", borderColor: "var(--success)" }}
        data-testid="recognition-mode-badge"
        title="已配置外部识别服务（HTTP Provider）；当前会话使用真实识别调用"
      >
        真实识别（HTTP Provider）
        {!compact && <span className="font-normal">· RECOGNITION_API_URL 已启用</span>}
      </span>
    )
  }
  return (
    <span
      className="mb-badge"
      style={{ background: "rgba(255,90,54,0.12)", color: "var(--signal)", borderColor: "var(--signal)" }}
      data-testid="recognition-mode-badge"
      title="当前使用内置 Fixture 演示识别，不代表真实 AI 识别准确率"
    >
      演示识别（Fixture）
      {!compact && <span className="font-normal">· 非真实模型调用</span>}
    </span>
  )
}

/** 兼容旧用法的别名（语义即识别模式标识） */
export const DemoModeBadge = RecognitionModeBadge

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode
  tone?: "slate" | "indigo" | "green" | "amber" | "red" | "sky" | "signal" | "blueprint"
}) {
  const tones: Record<string, React.CSSProperties> = {
    slate: { color: "var(--ink-70)", borderColor: "var(--aluminium)", background: "var(--workbench)" },
    indigo: { color: "var(--blueprint)", borderColor: "var(--blueprint)", background: "rgba(67,215,255,0.08)" },
    green: { color: "var(--success)", borderColor: "var(--success)", background: "rgba(47,181,134,0.10)" },
    amber: { color: "#ffc233", borderColor: "#8a6407", background: "rgba(255,176,0,0.10)" },
    red: { color: "#ff7a5c", borderColor: "#8a3a26", background: "rgba(255,122,92,0.10)" },
    sky: { color: "var(--blueprint)", borderColor: "var(--blueprint)", background: "rgba(67,215,255,0.08)" },
    signal: { color: "#ffc233", borderColor: "#8a6407", background: "rgba(255,176,0,0.10)" },
    blueprint: { color: "var(--blueprint)", borderColor: "var(--blueprint)", background: "rgba(67,215,255,0.08)" },
  }
  return (
    <span className="mb-badge" style={tones[tone]}>
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-card flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="empty-state">
      <div className="wb-mono" style={{ color: "var(--ink-50)" }} aria-hidden>
        EMPTY SLOT
      </div>
      <h3 className="wb-num text-lg font-semibold">{title}</h3>
      <p className="max-w-md text-sm" style={{ color: "var(--ink-50)" }}>
        {description}
      </p>
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  )
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className="h-1.5 w-full overflow-hidden"
      style={{ background: "var(--rule)" }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "进度"}
    >
      <div className="h-full" style={{ width: `${clamped}%`, background: "var(--success)" }} />
    </div>
  )
}

export function ErrorBanner({ message, hint }: { message: string; hint?: string }) {
  return (
    <div
      className="mb-card px-4 py-3 text-sm"
      style={{ borderColor: "var(--signal)", background: "rgba(255,90,54,0.06)", color: "#a33418" }}
      role="alert"
      data-testid="error-banner"
    >
      <p className="font-semibold">{message}</p>
      {hint && <p className="mt-1" style={{ color: "var(--signal)" }}>{hint}</p>}
    </div>
  )
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-card px-4 py-3 text-sm"
      style={{ borderColor: "var(--blueprint)", background: "rgba(49,94,251,0.05)", color: "#1c3f9e" }}
      data-testid="info-banner"
    >
      {children}
    </div>
  )
}
