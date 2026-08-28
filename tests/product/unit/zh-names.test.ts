import { describe, expect, it } from "vitest"
import { bandaiNameZh, legoNameZh, legoOfficialImageUrl, legoOfficialPageUrl, legoThemeLabel, normalizeLegoOfficialPageUrl, LEGO_ZH_NAMES, BANDAI_NAME_ZH_SOURCE, LEGO_NAME_ZH_SOURCE } from "@/lib/names/zh"

/**
 * 中文标准名（官网资料闭环）：
 * - Bandai 官方日文名 → 词典转写（验收商品 MGEX 强袭自由）；
 * - LEGO 中国官网人工清单（验收商品 42172 迈凯伦P1）；
 * - 官方图片/商品页 URL 构造。
 */

describe("Bandai 日文名 → 中文名（词典转写）", () => {
  it("验收商品：MGEX 1/100 ストライクフリーダムガンダム → MGEX 1/100 强袭自由高达", () => {
    expect(bandaiNameZh("MGEX 1/100 ストライクフリーダムガンダム")).toBe("MGEX 1/100 强袭自由高达")
  })

  it("等级前缀与比例保留（RG/MG/1/100 等不翻译）", () => {
    expect(bandaiNameZh("RG 1/144 RX-93ff νガンダム [クリアカラー]")).toContain("RG 1/144 RX-93ff ν高达")
    expect(bandaiNameZh("RG 1/144 RX-93ff νガンダム [クリアカラー]")).toContain("[透明色]")
  })

  it("目录在册商品：主要系列名称转写", () => {
    expect(bandaiNameZh("MG 1/100 フリーダムガンダム Ver.2.0 [CROSS CONTRAST COLORS / CLEAR BLUE]")).toContain("自由高达")
    expect(bandaiNameZh("MG 1/100 ジャスティスガンダム [CROSS CONTRAST COLORS / CLEAR GREEN]")).toContain("正义高达")
    expect(bandaiNameZh("RG 1/144 ガンダムベース限定 サザビー [メカニカルコアメッキ]")).toContain("沙扎比")
    expect(bandaiNameZh("MG 1/100 ユニコーンガンダム [リサーキュレーションカラー/クリアネオングリーン]")).toContain("独角兽高达")
    expect(bandaiNameZh("RG 1/144 ウイングガンダムゼロ")).toContain("飞翼高达零式")
    expect(bandaiNameZh("MG 1/100 デスティニーガンダム (ハイネ専用機)")).toContain("命运高达")
    expect(bandaiNameZh("RG 1/144 シャイニングガンダム")).toContain("闪光高达")
    expect(bandaiNameZh("MG 1/100 ガンダムヴィダール")).toContain("高达维达尔")
  })

  it("未知词保留原文（宁缺毋滥，绝不臆造）", () => {
    const out = bandaiNameZh("MG 1/100 ミラージュコロイド専用機")
    expect(out).toContain("MG 1/100")
  })

  it("来源标识：dict:bandai-official-ja", () => {
    expect(BANDAI_NAME_ZH_SOURCE).toBe("dict:bandai-official-ja")
  })
})

describe("LEGO 中国官网人工清单", () => {
  it("验收商品：42172 → 迈凯伦P1", () => {
    expect(legoNameZh("42172")).toBe("迈凯伦P1")
  })

  it("官方主图标准地址：42172 → www.lego.com/cdn（可验证）", () => {
    expect(legoOfficialImageUrl("42172")).toBe("https://www.lego.com/cdn/product-assets/product.img.pri/42172_Prod.png")
  })

  it("官方商品页统一使用美国官网 en-us slug", () => {
    expect(legoOfficialPageUrl("42172")).toBe("https://www.lego.com/en-us/product/mclaren-p1-42172")
    expect(legoOfficialPageUrl("76178")).toBe("https://www.lego.com/en-us/product/daily-bugle-76178")
    expect(legoOfficialPageUrl("76269")).toBe("https://www.lego.com/en-us/product/avengers-tower-76269")
  })

  it("旧 zh-cn/错误短路径可规范为 en-us 的已知商品页", () => {
    expect(normalizeLegoOfficialPageUrl("https://www.lego.com/zh-cn/product/lego-76178", "76178"))
      .toBe("https://www.lego.com/en-us/product/daily-bugle-76178")
    expect(normalizeLegoOfficialPageUrl("https://www.lego.com/zh-cn/product/99999", "99999"))
      .toBe("https://www.lego.com/en-us/product/99999")
  })

  it("LEGO 标签取 Kimi 的 series，不把非 Technic 套装误标 TECHNIC", () => {
    expect(legoThemeLabel("Marvel", "")).toBe("MARVEL")
    expect(legoThemeLabel("Harry Potter", "TECHNIC")).toBe("HARRY POTTER")
    expect(legoThemeLabel("", "")).toBe("LEGO")
  })

  it("未收录套装返回 null（绝不臆造中文名/猜 URL）", () => {
    expect(legoNameZh("99999")).toBeNull()
    expect(legoOfficialPageUrl("99999")).toBeNull()
  })

  it("清单覆盖常见 Technic 套装", () => {
    expect(Object.keys(LEGO_ZH_NAMES).length).toBeGreaterThanOrEqual(50)
    expect(legoNameZh("42143")).toContain("法拉利")
    expect(legoNameZh("42115")).toContain("兰博基尼")
    expect(LEGO_NAME_ZH_SOURCE).toBe("curated:lego-zh-cn")
  })
})
