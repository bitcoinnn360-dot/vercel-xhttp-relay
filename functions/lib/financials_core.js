// Shared BourseView income-statement transform (GuruFocus-style green/red bars).

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

const LINE_META = {
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

async function bvJson(cookie, path) {
  const res = await fetch(`${BV_BASE}${path}`, {
    headers: {
      Cookie: cookie,
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

function transformStatement(h, stmt) {
  const items = stmt.statementItems || []
  const byKey = new Map(items.map((it) => [Number(it.statementItemKey), it]))
  const lines = []
  for (const key of Object.keys(LINE_META).map(Number)) {
    const meta = LINE_META[key]
    const row = byKey.get(key)
    if (!row || row.value == null) continue
    const raw = Number(row.value)
    if (!Number.isFinite(raw)) continue
    // expenses often negative in BV — store absolute for bar length, keep sign in kind
    const value = Math.abs(raw)
    if (!(value > 0) && key !== 65) continue
    let kind = meta.kind
    if (key === 55 || key === 59) {
      kind = raw >= 0 ? 'income' : 'expense'
    }
    lines.push({
      key,
      name: row.statementItemName || meta.nameFa,
      nameFa: meta.nameFa,
      value: raw < 0 ? -value : value,
      kind,
    })
  }
  if (!lines.length) return null
  const scale = 1_000_000_000
  return {
    symbol: h.symbol,
    name: h.name,
    industry: h.industry,
    industryFa: h.industryFa,
    fiscalYear: stmt.fiscalYear,
    fiscalMonth: stmt.fiscalMonth,
    periodEndingDate: stmt.periodEndingDate,
    label: periodLabel(stmt.fiscalYear, stmt.fiscalMonth, stmt.periodEndingDate),
    currency: stmt.currency || 'IRR',
    lines: lines.map((l) => ({ ...l, value: Math.round(l.value / scale) })),
    scale,
    scaleLabel: 'میلیارد ریال',
  }
}

async function fetchCompany(cookie, h) {
  const path =
    `/api/v2/exchanges/${h.exchange}/stocks/${h.isin}/incomeStatements` +
    `?timeFrame=yearly&lastN=3&asReported=false&scenario=actual&view=origin`
  const data = await bvJson(cookie, path)
  const items = (data.items || []).filter((x) => !x.isEmpty && (x.statementItems || []).length)
  if (!items.length) return null
  // prefer latest audited / last item
  const stmt = items[items.length - 1]
  return transformStatement(h, stmt)
}

export async function buildFinancialsBundle(cookie) {
  const companies = []
  const errors = []
  for (let i = 0; i < HOLDINGS.length; i += 3) {
    const chunk = HOLDINGS.slice(i, i + 3)
    const part = await Promise.allSettled(chunk.map((h) => fetchCompany(cookie, h)))
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
    note: 'صورت سود و زیان سالانه · مقیاس میلیارد ریال · ویژوال سبز (درآمد/سود) / قرمز (هزینه)',
    companies,
    errors: errors.slice(0, 12),
  }
}
