/**
 * 中文标准名（官网资料闭环）：
 * - Bandai：官方日文商品名 → 确定性词典转写（最长匹配替换）。词典只收录万代官方/
 *   社区公认译名（强袭自由、沙扎比、独角兽……），未知词保留原文——宁缺毋滥，
 *   绝不机翻臆造。中文名来源标记 dict:bandai-official-ja。
 * - LEGO：中文商品名人工清单（官网被机器人防护拦截，无法实时抓取；来源标记
 *   curated:lego-zh-cn）。商品页统一指向品类更完整的美国官网（lego.com/en-us）。
 */

export const BANDAI_NAME_ZH_SOURCE = "dict:bandai-official-ja"
export const LEGO_NAME_ZH_SOURCE = "curated:lego-zh-cn"

/** 机体/商品名词典：日文 → 官方中文名（长词优先，替换前按长度降序匹配） */
const BANDAI_TERMS: [string, string][] = [
  // —— CE（SEED）系 ——
  ["ストライクフリーダムガンダム", "强袭自由高达"],
  ["ストライクフリーダム", "强袭自由"],
  ["マイティーストライクフリーダムガンダム", "强力强袭自由高达"],
  ["パーフェクトストライクフリーダムルージュ", "完美强袭自由嫣红"],
  ["パーフェクトストライクフリーダム", "完美强袭自由"],
  ["パーフェクトストライク", "完美强袭"],
  ["ストライクルージュ", "强袭嫣红"],
  ["ストライクガンダム", "强袭高达"],
  ["フリーダムガンダム", "自由高达"],
  ["ジャスティスガンダム", "正义高达"],
  ["デスティニーガンダム", "命运高达"],
  ["インパルスガンダム", "脉冲高达"],
  ["フォースインパルス", "Force脉冲"],
  ["イージスガンダム", "圣盾高达"],
  ["アカツキガンダム", "晓高达"],
  ["アストレイガンダム", "异端高达"],
  ["ガンダムアストレイ", "高达异端"],
  ["リバティアストレイ", "自由异端"],
  ["戦国アストレイ頑駄無", "战国异端顽驮无"],
  ["レッドフレーム", "红色机"],
  ["ブルーフレーム", "蓝色机"],
  ["プロヴィデンスガンダム", "天意高达"],
  ["ルージュ", "嫣红"],
  // —— UC 系 ——
  ["ユニコーンガンダム", "独角兽高达"],
  ["バンシィ", "报丧女妖"],
  ["シナンジュ", "新安洲"],
  ["サザビー", "沙扎比"],
  ["νガンダム", "ν高达"],
  ["ニュー", "New"],
  ["ダブル・フィン・ファンネル", "双重浮游炮"],
  ["ハイゴッグ", "高战蟹"],
  ["ズゴック", "魔蟹"],
  ["ゲルググ", "勇士"],
  ["ザクキャノン", "扎克加农"],
  ["量産型リコ専用ザク", "量产型里克专用扎克"],
  ["ザクII", "扎克II"],
  ["ザク", "扎克"],
  ["ジオング", "吉翁号"],
  ["グフ", "古夫"],
  ["ジム･スナイパーカスタム", "吉姆狙击特装型"],
  ["ジム・スナイパーカスタム", "吉姆狙击特装型"],
  ["ジムスナイパーカスタム", "吉姆狙击特装型"],
  ["ジム", "吉姆"],
  ["百式", "百式"],
  ["ガンダムMk-V", "高达Mk-V"],
  ["ガンダムMk-II", "高达Mk-II"],
  ["武者ガンダム", "武者高达"],
  ["ガンダムベース限定", "高达基地限定"],
  ["ガンダムベースカラー", "高达基地色"],
  ["ガンダムベース", "高达基地"],
  ["RX-78-2 ガンダム", "RX-78-2 高达"],
  ["ガンダム", "高达"],
  // —— AC（W）系 ——
  ["ウイングガンダムゼロEW", "飞翼高达零式EW"],
  ["ウイングガンダムゼロ", "飞翼高达零式"],
  ["ウイングガンダム", "飞翼高达"],
  ["ガンダムエピオン", "高达艾比安"],
  ["ガンダムデスサイズ", "高达死神"],
  ["ガンダムヘヴィアームズ", "高达重武装"],
  // —— AD（00）系 ——
  ["ダブルオーガンダム", "00高达"],
  ["ダブルオーライザー", "00强化机"],
  ["ダブルオー", "00"],
  ["ガンダムエクシア", "高达能天使"],
  ["ガンダムデュナメス", "高达力天使"],
  ["ガンダムキュリオス", "高达主天使"],
  ["ガンダムヴァーチェ", "高达德天使"],
  ["ガンダムケルディム", "高达智天使"],
  ["ガンダムセラヴィー", "高达炽天使"],
  // —— 其他系列 ——
  ["シャイニングガンダム", "闪光高达"],
  ["ゴッドガンダム", "神高达"],
  ["ハイパーモード", "超级模式"],
  ["ガンダムヴィダール", "高达维达尔"],
  ["ガンダムバルバトスルプス", "高达巴巴托斯天狼型"],
  ["ガンダムヴァサーゴ", "高达瓦沙戈"],
  ["アッシュ", "阿修"],
  // —— 配色/版本后缀 ——
  ["クリアカラー", "透明色"],
  ["クリアネオングリーン", "透明霓虹绿"],
  ["スペシャルコーティング", "特别镀层"],
  ["メカニカルコアメッキ", "机械核心电镀"],
  ["リサーキュレーションカラー", "再循环色"],
  ["ファーストロットカラー", "首批量产色"],
  ["メタリック", "金属色"],
  ["ハイネ専用機", "海涅专用机"],
  ["オオワシ装備", "大鹫装备"],
  ["南蛮胴具足", "南蛮胴具足"],
  ["徳川家康", "德川家康"],
  ["初音ミク", "初音未来"],
  ["機動戦士ガンダムSEED DESTINY", "机动战士高达SEED DESTINY"],
  ["機動戦士ガンダムSEED", "机动战士高达SEED"],
  ["機動戦士Zガンダム", "机动战士Z高达"],
  ["機動戦士ガンダム", "机动战士高达"],
  ["『機動戦士ガンダムSEED』20周年記念MSセット", "『机动战士高达SEED』20周年纪念MS套装"],
  ["20周年記念", "20周年纪念"],
  ["記念", "纪念"],
  ["ガンダム SIDE-F限定", "高达 SIDE-F 限定"],
  ["限定", "限定"],
  ["専用", "专用"],
]

/** 英文商品名 → 中文（global.bandai-hobby.net 等官方页标题为英文时使用） */
const BANDAI_EN_TERMS: [RegExp, string][] = [
  [/SAZABI/gi, "沙扎比"],
  [/STRIKE FREEDOM/gi, "强袭自由"],
  [/FREEDOM GUNDAM/gi, "自由高达"],
  [/JUSTICE GUNDAM/gi, "正义高达"],
  [/DESTINY GUNDAM/gi, "命运高达"],
  [/UNICORN GUNDAM/gi, "独角兽高达"],
  [/BANSHEE/gi, "报丧女妖"],
  [/SINANJU/gi, "新安洲"],
  [/NU GUNDAM|ν GUNDAM/gi, "ν高达"],
  [/ZETA GUNDAM/gi, "Z高达"],
  [/WING GUNDAM ZERO/gi, "飞翼高达零式"],
  [/WING GUNDAM/gi, "飞翼高达"],
  [/HYAKU SHIKI/gi, "百式"],
  [/GUNDAM/gi, "高达"],
]

const BANDAI_TERMS_SORTED = [...BANDAI_TERMS].sort((a, b) => b[0].length - a[0].length)

/**
 * Bandai 官方日文名 → 中文标准名（确定性词典转写）。
 * 覆盖不到的字符原样保留；返回值用于 nameZh（中文标准名），
 * 原始日文名仍保留在 canonicalName。
 */
export function bandaiNameZh(jaName: string): string {
  let out = jaName
  // 日文词典（字面替换）
  for (const [ja, zh] of BANDAI_TERMS_SORTED) {
    if (out.includes(ja)) out = out.split(ja).join(zh)
  }
  // 英文官方名（global 站点标题）：大小写不敏感替换
  for (const [re, zh] of BANDAI_EN_TERMS) {
    out = out.replace(re, zh)
  }
  return out.replace(/\s+/g, " ").trim()
}

/** LEGO 中文商品名人工清单（历史名称来源不随商品页地区切换） */
export const LEGO_ZH_NAMES: Record<string, string> = {
  "42115": "兰博基尼 Sián FKP 37",
  "42130": "BMW M 1000 RR",
  "42143": "法拉利 Daytona SP3",
  "42146": "利勃海尔履带起重机 LR 13000",
  "42151": "布加迪 Bolide",
  "42154": "2022 福特 GT",
  "42158": "NASA 火星探测器毅力号",
  "42159": "雅马哈 MT-10 SP",
  "42160": "奥迪 RS Q e-tron",
  "42161": "兰博基尼 Huracán Tecnica",
  "42166": "NEOM 迈凯伦极限 E 赛车",
  "42168": "约翰迪尔 9700 饲料收割机",
  "42169": "NEOM 迈凯伦电动方程式赛车",
  "42170": "川崎 Ninja H2R",
  "42171": "梅赛德斯-AMG F1 W14 E Performance",
  "42172": "迈凯伦P1",
  "42173": "柯尼塞格 Jesko Absolut（灰色）",
  "42175": "沃尔沃 FMX 卡车与 EC230 电动挖掘机",
  "42176": "保时捷 GT4 e-Performance",
  "42177": "梅赛德斯-奔驰 G 500 Professional Line",
  "42179": "在轨运行的地球和月球",
  "42180": "火星载人探测车",
  "42184": "柯尼塞格 Jesko Absolut（白色）",
  "42202": "杜卡迪 Panigale V4 S",
  "42204": "速度与激情 丰田 Supra MK4",
  "42205": "雪佛兰科尔维特 Stingray",
  "42206": "红牛车队 RB20 F1 赛车",
  "42207": "法拉利 SF-24 F1 赛车",
  "42208": "阿斯顿马丁 Valkyrie",
  "42209": "沃尔沃 L120 电动轮式装载机",
  "42210": "速度与激情 2 日产 Skyline GT-R R34",
  "42212": "法拉利 FXX-K",
  "42213": "福特烈马",
  "42214": "兰博基尼 Revuelto",
  "42215": "沃尔沃 EC500 混合动力挖掘机",
  "42217": "雪佛兰科尔维特 Stingray（蓝色）",
  "42218": "约翰迪尔 1470H 轮式收割机",
  "42221": "NASA 阿尔忒弥斯太空发射系统火箭",
  "42222": "布加迪 Chiron Pur Sport",
  "42223": "1966 福特 GT40 Mk II 赛车",
  "42224": "保时捷 911 GT3 R “Rexy” AO 赛车",
  "42227": "吉普牧马人 Rubicon",
  "42228": "迈凯伦 MCL39 F1 赛车",
  "42232": "柯尼塞格 Sadair's Spear",
  "42234": "道奇蝰蛇 GTS-R",
  "42235": "法拉利 488 Pista",
  "42236": "定制车库福特野马 GT",
  "42238": "杜卡迪 Desmo450 MX",
  "42239": "蝙蝠车 Tumbler",
  "42240": "阿斯顿马丁 Aramco AMR25 F1 赛车",
  "42241": "布加迪 Chiron Pur Sport（绿色）",
  "42242": "梅赛德斯-奔驰乌尼莫克 U 5023（带起重机）",
}

/** LEGO 套装编号 → 中国官网商品名（未收录返回 null，绝不臆造） */
export function legoNameZh(setNumber: string): string | null {
  return LEGO_ZH_NAMES[setNumber] ?? null
}

/** LEGO 官方标准主图（可验证地址；仅官方 CDN 域） */
export function legoOfficialImageUrl(setNumber: string): string {
  return `https://www.lego.com/cdn/product-assets/product.img.pri/${setNumber}_Prod.png`
}

/** LEGO slugs（官方商品页路径段，来自官方 sitemap 校验的人工清单） */
export const LEGO_SLUGS: Record<string, string> = {
  "11370": "stranger-things-the-creel-house-11370",
  "76178": "daily-bugle-76178",
  "76269": "avengers-tower-76269",
  "76419": "hogwarts-castle-and-grounds-76419",
  "42115": "lamborghini-sian-fkp-37-42115",
  "42130": "bmw-m-1000-rr-42130",
  "42143": "ferrari-daytona-sp3-42143",
  "42146": "liebherr-crawler-crane-lr-13000-42146",
  "42151": "bugatti-bolide-42151",
  "42154": "2022-ford-gt-42154",
  "42158": "nasa-mars-rover-perseverance-42158",
  "42159": "yamaha-mt-10-sp-42159",
  "42160": "audi-rs-q-e-tron-42160",
  "42161": "lamborghini-huracan-tecnica-42161",
  "42166": "neom-mclaren-extreme-e-race-car-42166",
  "42168": "john-deere-9700-forage-harvester-42168",
  "42169": "neom-mclaren-formula-e-race-car-42169",
  "42170": "kawasaki-ninja-h2r-motorcycle-42170",
  "42171": "mercedes-amg-f1-w14-e-performance-42171",
  "42172": "mclaren-p1-42172",
  "42173": "koenigsegg-jesko-absolut-grey-hypercar-42173",
  "42175": "volvo-fmx-truck-ec230-electric-excavator-42175",
  "42176": "porsche-gt4-e-performance-race-car-42176",
  "42177": "mercedes-benz-g-500-professional-line-42177",
  "42179": "planet-earth-and-moon-in-orbit-42179",
  "42180": "mars-crew-exploration-rover-42180",
  "42184": "koenigsegg-jesko-absolut-white-hypercar-42184",
  "42202": "ducati-panigale-v4-s-motorcycle-42202",
  "42204": "fast-and-furious-toyota-supra-mk4-42204",
  "42205": "chevrolet-corvette-stingray-42205",
  "42206": "oracle-red-bull-racing-rb20-f1-car-42206",
  "42207": "ferrari-sf-24-f1-car-42207",
  "42208": "aston-martin-valkyrie-42208",
  "42209": "volvo-l120-electric-wheel-loader-42209",
  "42210": "2-fast-2-furious-nissan-skyline-gt-r-r34-car-42210",
  "42212": "ferrari-fxx-k-42212",
  "42213": "ford-bronco-suv-42213",
  "42214": "lamborghini-revuelto-super-sports-car-42214",
  "42215": "volvo-ec500-hybrid-excavator-42215",
  "42217": "chevrolet-corvette-stingray-blue-42217",
  "42218": "john-deere-1470h-wheeled-harvester-42218",
  "42221": "nasa-artemis-space-launch-system-rocket-42221",
  "42222": "bugatti-chiron-pur-sport-hypercar-42222",
  "42223": "1966-ford-gt40-mkii-race-car-42223",
  "42224": "porsche-911-gt3-r-rexy-ao-racing-car-42224",
  "42227": "jeep-wrangler-rubicon-suv-42227",
  "42228": "mclaren-mcl39-f1-car-42228",
  "42232": "koenigsegg-sadairs-spear-megacar-42232",
  "42234": "dodge-viper-gts-r-sports-car-42234",
  "42235": "ferrari-488-pista-car-42235",
  "42236": "custom-garage-ford-mustang-gt-car-42236",
  "42238": "ducati-desmo450-mx-factory-motorcycle-42238",
  "42239": "batmobile-tumbler-42239",
  "42240": "aston-martin-aramco-amr25-f1-car-42240",
  "42241": "green-bugatti-chiron-pur-sport-hypercar-42241",
  "42242": "mercedes-benz-unimog-u-5023-with-crane-42242",
}

/** LEGO 官方商品页（美国官网；slug 未收录时返回 null，不猜 URL） */
export function legoOfficialPageUrl(setNumber: string): string | null {
  const slug = LEGO_SLUGS[setNumber]
  return slug ? `https://www.lego.com/en-us/product/${slug}` : null
}

/**
 * 把历史 LEGO 商品页规范为美国官网地址。
 * 已知 set number 优先使用已校验 slug，可同时修正 `/product/lego-76178` 这类旧错误路径；
 * 未收录的真实商品页只替换 locale，不擅自改写 slug。
 */
export function normalizeLegoOfficialPageUrl(url: string | null | undefined, setNumber: string): string | null {
  const known = legoOfficialPageUrl(setNumber)
  if (known) return known
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.toLowerCase().endsWith("lego.com")) return url
    parsed.protocol = "https:"
    parsed.hostname = "www.lego.com"
    parsed.pathname = parsed.pathname.replace(/^\/[a-z]{2}-[a-z]{2}(?=\/)/i, "/en-us")
    parsed.search = ""
    parsed.hash = ""
    return parsed.toString().replace(/\/$/, "")
  } catch {
    return url
  }
}

/**
 * Kimi 提取的 LEGO series 是主题事实来源；grade 仅作缺省回退。
 * 这里只统一展示拼写，不根据套装编号猜主题。没有主题时显示 LEGO，而不是误标 TECHNIC。
 */
export function legoThemeLabel(series: string | null | undefined, grade: string | null | undefined): string {
  const raw = (series?.trim() || grade?.trim() || "").replace(/^LEGO\s+/i, "").trim()
  if (!raw || /^(OTHER|UNKNOWN|N\/?A|LEGO)$/i.test(raw)) return "LEGO"
  if (/\bDC\b/i.test(raw)) return "DC"
  if (/MARVEL|SUPER\s*HERO(?:ES)?/i.test(raw)) return "MARVEL"
  if (/HARRY\s*POTTER/i.test(raw)) return "HARRY POTTER"
  if (/STRANGER\s*THINGS/i.test(raw)) return "STRANGER THINGS"
  if (/STAR\s*WARS/i.test(raw)) return "STAR WARS"
  if (/SPEED\s*CHAMPIONS/i.test(raw)) return "SPEED CHAMPIONS"
  return raw.toLocaleUpperCase("en-US")
}
