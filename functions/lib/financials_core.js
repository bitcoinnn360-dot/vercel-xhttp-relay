// Shared BourseView income / balance / cash-flow for GuruFocus-style Sankey.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BV_BASE = 'https://www.bourseview.com'

const HOLDINGS = [
  { symbol: 'کگل', name: 'گل‌گهر', isin: 'IRO1GOLG0001', exchange: 'IRTSENO', industry: 'iron-ore', industryFa: 'سنگ‌آهن' },
  { symbol: 'کچاد', name: 'چادرملو', isin: 'IRO1CHML0001', exchange: 'IRTSENO', industry: 'iron-ore', industryFa: 'سنگ‌آهن' },
  { symbol: 'کگهر', name: 'گهرزمین', isin: 'IRO3GZIZ0001', exchange: 'IRIFBNO', industry: 'iron-ore', industryFa: 'سنگ‌آهن' },
  { symbol: 'کنور', name: 'صبانور', isin: 'IRO1KNRZ0001', exchange: 'IRTSENO', industry: 'iron-ore', industryFa: 'سنگ‌آهن' },
  { symbol: 'فملی', name: 'ملی صنایع مس', isin: 'IRO1MSMI0001', exchange: 'IRTSENO', industry: 'copper', industryFa: 'مس' },
  { symbol: 'ارفع', name: 'آهن و فولاد ارفع', isin: 'IRO3ARFZ0001', exchange: 'IRIFBNO', industry: 'steel', industryFa: 'فولاد' },
  { symbol: 'فخاس', name: 'فولاد خراسان', isin: 'IRO1FKAS0001', exchange: 'IRTSENO', industry: 'steel', industryFa: 'فولاد' },
  { symbol: 'بکام', name: 'شهید قندی', isin: 'IRO1KGND0001', exchange: 'IRTSENO', industry: 'cable', industryFa: 'کابل و مخابرات' },
]

const INCOME_META = {
  44: { nameFa: 'فروش', kind: 'income' },
  48: { nameFa: 'بهای تمام‌شده', kind: 'expense' },
  52: { nameFa: 'سود ناخالص', kind: 'total' },
  54: { nameFa: 'هزینه عمومی و اداری', kind: 'expense' },
  55: { nameFa: 'سایر درآمد (هزینه) عملیاتی', kind: 'income' },
  56: { nameFa: 'سود عملیاتی', kind: 'total' },
  57: { nameFa: 'هزینه مالی', kind: 'expense' },
  59: { nameFa: 'خالص سایر درآمدها', kind: 'income' },
  60: { nameFa: 'سود قبل از مالیات', kind: 'total' },
  63: { nameFa: 'مالیات', kind: 'expense' },
  66: { nameFa: 'سود خالص', kind: 'total' },
}

const BALANCE_META = {
  1: { nameFa: 'موجودی نقد', kind: 'asset' },
  2: { nameFa: 'سرمایه‌گذاری کوتاه‌مدت', kind: 'asset' },
  200: { nameFa: 'دریافتنی‌ها', kind: 'asset' },
  6: { nameFa: 'موجودی کالا', kind: 'asset' },
  7: { nameFa: 'پیش‌پرداخت‌ها', kind: 'asset' },
  10: { nameFa: 'جمع دارایی جاری', kind: 'total' },
  14: { nameFa: 'دریافتنی بلندمدت', kind: 'asset' },
  11: { nameFa: 'سرمایه‌گذاری بلندمدت', kind: 'asset' },
  12: { nameFa: 'دارایی ثابت مشهود', kind: 'asset' },
  13: { nameFa: 'دارایی نامشهود', kind: 'asset' },
  16: { nameFa: 'سایر دارایی‌ها', kind: 'asset' },
  17: { nameFa: 'جمع دارایی غیرجاری', kind: 'total' },
  18: { nameFa: 'جمع دارایی‌ها', kind: 'total' },
  202: { nameFa: 'پرداختنی‌ها', kind: 'liability' },
  22: { nameFa: 'درآمد انتقالی', kind: 'liability' },
  23: { nameFa: 'ذخیره مالیات', kind: 'liability' },
  24: { nameFa: 'سود سهام پرداختنی', kind: 'liability' },
  25: { nameFa: 'حصه جاری تسهیلات', kind: 'liability' },
  3002: { nameFa: 'ذخایر', kind: 'liability' },
  27: { nameFa: 'جمع بدهی جاری', kind: 'total' },
  29: { nameFa: 'تسهیلات بلندمدت', kind: 'liability' },
  30: { nameFa: 'ذخیره مزایای پایان خدمت', kind: 'liability' },
  31: { nameFa: 'جمع بدهی غیرجاری', kind: 'total' },
  32: { nameFa: 'جمع بدهی‌ها', kind: 'total' },
  33: { nameFa: 'سرمایه', kind: 'equity' },
  36: { nameFa: 'اندوخته قانونی', kind: 'equity' },
  38: { nameFa: 'سود انباشته', kind: 'equity' },
  42: { nameFa: 'جمع حقوق صاحبان سهام', kind: 'total' },
  43: { nameFa: 'جمع بدهی و حقوق', kind: 'total' },
}

const CASHFLOW_META = {
  230: { nameFa: 'دریافت‌های عملیاتی', kind: 'income' },
  138: { nameFa: 'مالیات پرداختی', kind: 'expense' },
  132: { nameFa: 'جریان نقد عملیاتی', kind: 'total' },
  140: { nameFa: 'خرید دارایی ثابت', kind: 'expense' },
  144: { nameFa: 'خرید سرمایه‌گذاری', kind: 'expense' },
  133: { nameFa: 'سود سهام دریافتی', kind: 'income' },
  136: { nameFa: 'سود سرمایه‌گذاری دریافتی', kind: 'income' },
  233: { nameFa: 'جریان نقد سرمایه‌گذاری', kind: 'total' },
  150: { nameFa: 'دریافت تسهیلات', kind: 'income' },
  151: { nameFa: 'بازپرداخت تسهیلات', kind: 'expense' },
  135: { nameFa: 'بهره پرداختی', kind: 'expense' },
  134: { nameFa: 'سود سهام پرداختی', kind: 'expense' },
  149: { nameFa: 'افزایش سرمایه', kind: 'income' },
  243: { nameFa: 'جریان نقد تأمین مالی', kind: 'total' },
  153: { nameFa: 'خالص تغییر نقد', kind: 'total' },
  154: { nameFa: 'نقد ابتدای دوره', kind: 'total' },
  155: { nameFa: 'اثر نرخ ارز', kind: 'income' },
  156: { nameFa: 'نقد پایان دوره', kind: 'total' },
}

const PRODUCT_FA = {
  Pellets: 'گندله',
  'Iron Ore Concentrate': 'کنسانتره سنگ‌آهن',
  'Iron Concentrate (Dry)': 'کنسانتره خشک',
  Concentrate: 'کنسانتره',
  'Iron Ore Lump': 'سنگ‌آهن دانه‌بندی',
  'Direct Reduced Iron': 'آهن اسفنجی',
  'Direct Reduced Iron (DRI)': 'آهن اسفنجی',
  Steel: 'فولاد',
  'Steel Ingots': 'شمش فولاد',
  Ingot: 'شمش',
  Cathode: 'کاتد',
  'Copper Concentrate': 'کنسانتره مس',
  'Molybdenum Concentrate': 'کنسانتره مولیبدن',
  'Molybdenum Oxide': 'اکسید مولیبدن',
  'Sulfuric Acid': 'اسید سولفوریک',
  'Sulfur Rock': 'سنگ گوگرد',
  'Gold & Silver Concentrate': 'کنسانتره طلا و نقره',
  'Rolled Wire': 'مفتول',
  'Telecommunication Copper Cables': 'کابل مسی مخابراتی',
  'Fiber Optic Telecommunication Cables': 'کابل فیبر نوری',
  Other: 'سایر',
  'Other / Discounts': 'سایر / تخفیفات',
}

const MONTHS_FA = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
]

export function normalizeCookie(raw) {
  let c = String(raw || '').trim()
  if (!c) return ''
  if (!/authentication=/i.test(c) && !/;/.test(c) && c.length > 20) {
    c = `authentication=${c}`
  }
  return c
}

function toFaDigits(s) {
  return String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}

function periodLabel(fiscalYear, fiscalMonth, periodEndingDate) {
  const raw = String(periodEndingDate || '')
  let jy = fiscalYear
  let jm = fiscalMonth
  if (raw.length === 8) {
    try {
      const dt = new Date(Date.UTC(+raw.slice(0, 4), +raw.slice(4, 6) - 1, +raw.slice(6, 8), 12))
      const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'numeric',
      })
      const parts = Object.fromEntries(fmt.formatToParts(dt).map((p) => [p.type, p.value]))
      jy = Number(String(parts.year).replace(/\D/g, '')) || fiscalYear
      jm = Number(parts.month) || fiscalMonth
    } catch {
      /* ignore */
    }
  }
  const name = MONTHS_FA[(jm || 12) - 1] || ''
  return `سال مالی ${toFaDigits(jy)}${name ? ` · ${name}` : ''}`
}

function productNameFa(name, productKey) {
  if (name && PRODUCT_FA[name]) return PRODUCT_FA[name]
  if (name && name !== 'None') return name
  return `سایر (${productKey})`
}

async function bvJson(cookie, idToken, path) {
  const res = await fetch(`${BV_BASE}${path}`, {
    headers: {
      Cookie: cookie,
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      Accept: 'application/json',
      'User-Agent': UA,
      Referer: 'https://www.bourseview.com/',
      Origin: 'https://www.bourseview.com',
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`bourseview ${res.status} ${path}`)
  return res.json()
}

/** Extract product sales (Million Rials) from a productions statement. */
function extractProductSales(stmt) {
  const byName = new Map()
  for (const row of stmt.productionItems || []) {
    const isSales =
      row.productionItemKey === 4002 ||
      row.productionItemName === 'Sales' ||
      row.productionItemName === 'Sales Value'
    if (!isSales) continue
    const pk = Number(row.productKey)
    if (!Number.isFinite(pk) || pk === 999999) continue
    const val = Number(row.value)
    if (!Number.isFinite(val) || !(val > 0)) continue
    const name = row.productName || ''
    const nameFa = productNameFa(name, pk)
    const key = nameFa
    const prev = byName.get(key)
    if (prev) prev.value += val
    else byName.set(key, { productKey: pk, name: name || nameFa, nameFa, value: val })
  }
  return [...byName.values()].sort((a, b) => b.value - a.value)
}

function pickProductionStmt(items, incomeStmt) {
  const actual = (items || []).filter(
    (x) =>
      !x.isEmpty &&
      String(x.scenario || '').toLowerCase() === 'actual' &&
      (x.productionItems || []).length,
  )
  if (!actual.length) return null
  return pickClosest(actual, incomeStmt)
}

function pickClosest(items, incomeStmt) {
  const end = Number(incomeStmt.periodEndingDate)
  const fy = Number(incomeStmt.fiscalYear)
  const byEnd = items.find((x) => Number(x.periodEndingDate) === end)
  if (byEnd) return byEnd
  const byFy = items.find((x) => Number(x.fiscalYear) === fy && Number(x.fiscalMonth) === 12)
  if (byFy) return byFy
  const prior = [...items]
    .filter((x) => Number(x.periodEndingDate) <= end)
    .sort((a, b) => Number(b.periodEndingDate) - Number(a.periodEndingDate))
  return prior[0] || items[items.length - 1]
}

function pickLatestStmt(payload) {
  const items = (payload?.items || []).filter((x) => !x.isEmpty && (x.statementItems || []).length)
  if (!items.length) return null
  return items[items.length - 1]
}

function extractLines(stmt, meta, { keepZero = false } = {}) {
  const items = stmt.statementItems || []
  const byKey = new Map(items.map((it) => [Number(it.statementItemKey), it]))
  const lines = []
  for (const key of Object.keys(meta).map(Number)) {
    const m = meta[key]
    const row = byKey.get(key)
    if (!row || row.value == null) continue
    const raw = Number(row.value)
    if (!Number.isFinite(raw)) continue
    if (!keepZero && raw === 0) continue
    let kind = m.kind
    if (key === 55 || key === 59) kind = raw >= 0 ? 'income' : 'expense'
    lines.push({
      key,
      name: row.statementItemName || m.nameFa,
      nameFa: m.nameFa,
      value: raw,
      kind,
    })
  }
  return lines
}

function scaleLines(lines, scale) {
  return lines.map((l) => ({ ...l, value: Math.round(l.value / scale) }))
}

function buildSegments(segmentsMr, salesBr) {
  if (!segmentsMr?.length || !(salesBr > 0)) return []
  const rawBr = segmentsMr.map((s) => ({
    ...s,
    value: Math.round(s.value / 1000), // MR → BR
  }))
  const sum = rawBr.reduce((a, s) => a + s.value, 0)
  if (!(sum > 0)) return []
  let segments = rawBr.map((s) => ({
    productKey: s.productKey,
    name: s.name,
    nameFa: s.nameFa,
    value: Math.round((s.value / sum) * salesBr),
  }))
  const drift = salesBr - segments.reduce((a, s) => a + s.value, 0)
  if (drift !== 0 && segments.length) {
    const top = segments.reduce((a, b) => (b.value > a.value ? b : a))
    top.value += drift
  }
  return segments.filter((s) => s.value > 0)
}

function transformCompany(h, incomeStmt, prodStmt, balanceStmt, cashflowStmt) {
  const scale = 1_000_000_000
  const incomeLinesRaw = extractLines(incomeStmt, INCOME_META)
  if (!incomeLinesRaw.length) return null

  const salesLine = incomeLinesRaw.find((l) => l.key === 44)
  const salesBr = salesLine ? Math.round(Math.abs(salesLine.value) / scale) : 0
  const segmentsMr = prodStmt ? extractProductSales(prodStmt) : []

  const balanceLines = balanceStmt ? scaleLines(extractLines(balanceStmt, BALANCE_META, { keepZero: false }), scale) : []
  const cashflowLines = cashflowStmt
    ? scaleLines(extractLines(cashflowStmt, CASHFLOW_META, { keepZero: true }), scale)
    : []

  return {
    symbol: h.symbol,
    name: h.name,
    industry: h.industry,
    industryFa: h.industryFa,
    fiscalYear: incomeStmt.fiscalYear,
    fiscalMonth: incomeStmt.fiscalMonth,
    periodEndingDate: incomeStmt.periodEndingDate,
    label: periodLabel(incomeStmt.fiscalYear, incomeStmt.fiscalMonth, incomeStmt.periodEndingDate),
    currency: incomeStmt.currency || 'IRR',
    lines: scaleLines(incomeLinesRaw, scale),
    balanceLines,
    cashflowLines,
    segments: buildSegments(segmentsMr, salesBr),
    scale,
    scaleLabel: 'میلیارد ریال',
  }
}

async function fetchCompany(cookie, idToken, h) {
  const base = `/api/v2/exchanges/${h.exchange}/stocks/${h.isin}`
  const q = 'timeFrame=yearly&lastN=3&asReported=false&scenario=actual&view=origin'
  const [income, productions, balance, cashflow] = await Promise.all([
    bvJson(cookie, idToken, `${base}/incomeStatements?${q}`),
    bvJson(cookie, idToken, `${base}/productions?timeFrame=yearly&lastN=6`).catch(() => ({ items: [] })),
    bvJson(cookie, idToken, `${base}/balanceSheets?${q}`).catch(() => ({ items: [] })),
    bvJson(cookie, idToken, `${base}/cashFlows?${q}`).catch(() => ({ items: [] })),
  ])
  const incomeStmt = pickLatestStmt(income)
  if (!incomeStmt) return null
  const prodStmt = pickProductionStmt(productions.items || [], incomeStmt)
  const balanceStmt = pickLatestStmt(balance)
  const cashflowStmt = pickLatestStmt(cashflow)
  return transformCompany(h, incomeStmt, prodStmt, balanceStmt, cashflowStmt)
}

export async function buildFinancialsBundle(cookie, idToken = '') {
  const companies = []
  const errors = []
  for (let i = 0; i < HOLDINGS.length; i += 3) {
    const chunk = HOLDINGS.slice(i, i + 3)
    const part = await Promise.allSettled(chunk.map((h) => fetchCompany(cookie, idToken, h)))
    part.forEach((r, idx) => {
      const h = chunk[idx]
      if (r.status === 'fulfilled' && r.value) companies.push(r.value)
      else if (r.status === 'fulfilled') errors.push(`${h.symbol}: empty`)
      else errors.push(`${h.symbol}: ${r.reason}`)
    })
  }
  return {
    ok: companies.length > 0,
    updatedAt: new Date().toISOString(),
    source: 'bourseview',
    note: 'صورت سود و زیان + ترازنامه + جریان نقدی (سبک GuruFocus)',
    companies,
    errors: errors.slice(0, 12),
  }
}
