// Shared BourseView production + energy transform for Pages Function + CLI.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BV_BASE = 'https://www.bourseview.com'
const LAST_N = 36

/** Operating portfolio names that typically file monthly production/energy. */
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

const RATE_UNIT_FA = {
  water: 'ریال / مترمکعب',
  electricity: 'ریال / مگاوات‌ساعت',
  gas: 'ریال / مترمکعب',
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

const PRODUCT_FA = {
  Pellets: 'گندله',
  'Iron Ore Concentrate': 'کنسانتره سنگ‌آهن',
  'Iron Concentrate (Dry)': 'کنسانتره خشک',
  'Concentrate (Consumed)': 'کنسانتره مصرفی',
  Concentrate: 'کنسانتره',
  'Iron Ore Lump': 'سنگ‌آهن دانه‌بندی',
  'Granulated Iron Ore': 'سنگ‌آهن دانه‌درشت',
  'Direct Reduced Iron': 'آهن اسفنجی',
  'Direct Reduced Iron (DRI)': 'آهن اسفنجی',
  Steel: 'فولاد',
  'Steel Ingots': 'شمش فولاد',
  Ingot: 'شمش',
  Apatite: 'آپاتیت',
  Cathode: 'کاتد',
  'Copper Concentrate': 'کنسانتره مس',
  'Molybdenum Concentrate': 'کنسانتره مولیبدن',
  'Molybdenum Oxide': 'اکسید مولیبدن',
  'Sulfuric Acid': 'اسید سولفوریک',
  'Sulfur Rock': 'سنگ گوگرد',
  'Gold & Silver Concentrate': 'کنسانتره طلا و نقره',
  'Rolled Wire': 'مفتول',
  'Light Building Products': 'محصولات سبک ساختمانی',
  'Telecommunication Copper Cables': 'کابل مسی مخابراتی',
  'Fiber Optic Telecommunication Cables': 'کابل فیبر نوری',
  Other: 'سایر',
  Total: 'جمع',
}

const ENERGY_META = {
  water: { id: 'water', labelFa: 'آب', unitDefault: 'مترمکعب' },
  electricity: { id: 'electricity', labelFa: 'برق', unitDefault: 'مگاوات‌ساعت' },
  gas: { id: 'gas', labelFa: 'گاز', unitDefault: 'مترمکعب' },
}

const UNIT_FA = {
  Ton: 'تن',
  'Megawatt Hour': 'مگاوات‌ساعت',
  'Cubic Meters': 'مترمکعب',
  Liter: 'لیتر',
  'Million Rials': 'میلیون ریال',
}

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

function jalaliFromPeriodEnding(periodEndingDate, fiscalMonth) {
  const raw = String(periodEndingDate || '')
  if (raw.length === 8) {
    const y = Number(raw.slice(0, 4))
    const m = Number(raw.slice(4, 6))
    const d = Number(raw.slice(6, 8))
    try {
      const dt = new Date(Date.UTC(y, m - 1, d, 12))
      const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'numeric',
      })
      const parts = Object.fromEntries(fmt.formatToParts(dt).map((p) => [p.type, p.value]))
      const jy = Number(String(parts.year).replace(/\D/g, ''))
      const jm = Number(parts.month) || fiscalMonth
      return { year: jy, month: jm }
    } catch {
      /* fall through */
    }
  }
  return { year: null, month: fiscalMonth || null }
}

function monthLabel(fiscalYear, fiscalMonth, periodEndingDate) {
  // Label by calendar month of period end (fiscal calendars differ across issuers).
  const j = jalaliFromPeriodEnding(periodEndingDate, fiscalMonth)
  const month = j.month || fiscalMonth || 1
  const name = MONTHS_FA[month - 1] || `ماه ${month}`
  const year = j.year || fiscalYear
  return year ? `${name} ${toFaDigits(year)}` : name
}

/**
 * BourseView monthly production/energy volumes are fiscal-year cumulative.
 * Convert to pure monthly by differencing within each fiscal year.
 */
function toMonthlyMap(byKey) {
  const sorted = [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const out = new Map()
  let prevFy = null
  let prevCum = null
  for (const [k, cur] of sorted) {
    const fy = Number(k.split('-')[0])
    const cum = cur.value
    let monthly = null
    if (cum != null && Number.isFinite(cum)) {
      if (prevFy !== fy || prevCum == null) monthly = cum
      else monthly = cum - prevCum
      // Negative delta usually means Codal restated the cumulative — drop the point.
      if (monthly != null && monthly < 0) monthly = null
    }
    out.set(k, { value: monthly, periodEndingDate: cur.periodEndingDate })
    prevFy = fy
    prevCum = cum != null && Number.isFinite(cum) ? cum : prevCum
  }
  return out
}

function unitFa(unit) {
  if (!unit) return ''
  return UNIT_FA[unit] || unit
}

function productNameFa(name) {
  if (!name) return 'نامشخص'
  return PRODUCT_FA[name] || name
}

function yoyPct(curr, prior) {
  if (curr == null || prior == null || !(prior > 0)) return null
  return Math.round((curr / prior - 1) * 10000) / 100
}

function classifyEnergy(row) {
  const name = String(row.productName || '').toLowerCase()
  const unit = String(row.unitName || '').toLowerCase()
  const pk = Number(row.productKey)
  if (pk === 646 || name === 'water') return 'water'
  if (pk === 152 || name === 'electricity' || unit.includes('megawatt')) return 'electricity'
  if (pk === 965 || name.includes('gasoline') || name.includes('petrol')) return null
  if ([4570, 862, 5190].includes(pk) || /\bgas\b|natural gas|fuel gas/.test(name)) return 'gas'
  // unnamed cubic-meters energy rows that aren't water → treat as gas-like fuel
  if (!name && unit.includes('cubic') && pk !== 646) return 'gas'
  return null
}

async function bvJson(cookie, idToken, path) {
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

function buildMonthPoints(byKey) {
  const keys = [...byKey.keys()].sort()
  return keys.map((k) => {
    const cur = byKey.get(k)
    const [fy, fm] = k.split('-').map(Number)
    const prior = byKey.get(`${fy - 1}-${String(fm).padStart(2, '0')}`)
    const value = cur.value
    const priorValue = prior?.value ?? null
    return {
      fiscalYear: fy,
      fiscalMonth: fm,
      periodEndingDate: cur.periodEndingDate,
      label: monthLabel(fy, fm, cur.periodEndingDate),
      value,
      priorValue,
      yoyPct: yoyPct(value, priorValue),
    }
  })
}

function extractProducts(items) {
  /** @type {Map<number, { productKey: number, productName: string, unit: string, byKey: Map<string, {value:number|null, periodEndingDate:number}> }>} */
  const map = new Map()
  for (const stmt of items || []) {
    const fy = Number(stmt.fiscalYear)
    const fm = Number(stmt.fiscalMonth)
    if (!fy || !fm) continue
    const key = `${fy}-${String(fm).padStart(2, '0')}`
    for (const row of stmt.productionItems || []) {
      if (row.productionItemKey !== 4000 && row.productionItemName !== 'Production Volume') continue
      const pk = Number(row.productKey)
      if (!Number.isFinite(pk) || pk === 999999) continue
      if (!row.productName) continue
      const val = row.value == null ? null : Number(row.value)
      if (!map.has(pk)) {
        map.set(pk, {
          productKey: pk,
          productName: row.productName,
          unit: row.unitName || 'Ton',
          byKey: new Map(),
        })
      }
      const entry = map.get(pk)
      if (!entry.productName && row.productName) entry.productName = row.productName
      if (row.unitName) entry.unit = row.unitName
      entry.byKey.set(key, { value: Number.isFinite(val) ? val : null, periodEndingDate: stmt.periodEndingDate })
    }
  }

  const products = [...map.values()]
    .map((p) => {
      const months = buildMonthPoints(toMonthlyMap(p.byKey))
      const hasData = months.some((m) => m.value != null && Math.abs(m.value) > 0)
      if (!hasData) return null
      return {
        productKey: p.productKey,
        productName: p.productName,
        productNameFa: productNameFa(p.productName),
        unit: p.unit,
        unitFa: unitFa(p.unit),
        months,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.productNameFa.localeCompare(b.productNameFa, 'fa'))

  const nameCount = new Map()
  for (const p of products) nameCount.set(p.productNameFa, (nameCount.get(p.productNameFa) || 0) + 1)
  for (const p of products) {
    if ((nameCount.get(p.productNameFa) || 0) > 1) {
      p.productNameFa = `${p.productNameFa} (${p.productKey})`
    }
  }
  return products
}

function avgOf(vals) {
  const xs = vals.filter((v) => v != null && Number.isFinite(v) && v > 0)
  if (!xs.length) return null
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
}

function rollingAvgs(months) {
  const withVal = months.filter((m) => m.value != null && Number.isFinite(m.value) && m.value > 0)
  const last = withVal[withVal.length - 1] || null
  const take = (n) => avgOf(withVal.slice(-n).map((m) => m.value))
  return {
    latestRate: last?.value ?? null,
    latestLabel: last?.label ?? null,
    avg3m: take(3),
    avg6m: take(6),
    avg12m: take(12),
  }
}

function extractEnergy(items) {
  /** cumulative volume / cost (million rials) / reported unit price */
  const volBuckets = { water: new Map(), electricity: new Map(), gas: new Map() }
  const costBuckets = { water: new Map(), electricity: new Map(), gas: new Map() }
  const priceBuckets = { water: new Map(), electricity: new Map(), gas: new Map() }
  const units = { water: '', electricity: '', gas: '' }

  for (const stmt of items || []) {
    const fy = Number(stmt.fiscalYear)
    const fm = Number(stmt.fiscalMonth)
    if (!fy || !fm) continue
    const key = `${fy}-${String(fm).padStart(2, '0')}`
    const volAdd = { water: 0, electricity: 0, gas: 0 }
    const costAdd = { water: 0, electricity: 0, gas: 0 }
    const priceW = { water: 0, electricity: 0, gas: 0 }
    const priceSum = { water: 0, electricity: 0, gas: 0 }

    for (const row of stmt.productionItems || []) {
      const kind = classifyEnergy(row)
      if (!kind) continue
      const name = row.productionItemName
      const pk = row.productionItemKey
      const val = Number(row.value)
      if (!Number.isFinite(val)) continue

      if (name === 'EnergyMaterialUsedVolume' || pk === 6443) {
        volAdd[kind] += val
        if (row.unitName) units[kind] = row.unitName
      } else if (name === 'EnergyMaterialUsed' || pk === 6445) {
        costAdd[kind] += val
      } else if (name === 'EnergyUnitPrice' || pk === 6444) {
        priceSum[kind] += val
        priceW[kind] += 1
      }
    }

    for (const kind of Object.keys(ENERGY_META)) {
      if (volAdd[kind] > 0) {
        volBuckets[kind].set(key, {
          value: volAdd[kind],
          periodEndingDate: stmt.periodEndingDate,
          unit: units[kind],
        })
      }
      if (costAdd[kind] > 0) {
        costBuckets[kind].set(key, {
          value: costAdd[kind],
          periodEndingDate: stmt.periodEndingDate,
        })
      }
      if (priceW[kind] > 0) {
        priceBuckets[kind].set(key, {
          value: priceSum[kind] / priceW[kind],
          periodEndingDate: stmt.periodEndingDate,
        })
      }
    }
  }

  return Object.keys(ENERGY_META)
    .map((kind) => {
      const byKey = volBuckets[kind]
      if (!byKey.size) return null
      const months = buildMonthPoints(toMonthlyMap(byKey))
      if (!months.some((m) => m.value != null && Math.abs(m.value) > 0)) return null
      const meta = ENERGY_META[kind]
      const unit = units[kind] || meta.unitDefault

      // Monthly rate = Δcost(rial) / Δvolume ; fallback to reported EnergyUnitPrice
      const monthlyVol = toMonthlyMap(volBuckets[kind])
      const monthlyCost = toMonthlyMap(costBuckets[kind])
      const volSamples = [...monthlyVol.values()].map((v) => v.value).filter((v) => v != null && v > 0)
      const medVol = volSamples.length
        ? [...volSamples].sort((a, b) => a - b)[Math.floor(volSamples.length / 2)]
        : 0
      const rateMap = new Map()
      for (const [k, volRow] of monthlyVol.entries()) {
        const vol = volRow.value
        const costMr = monthlyCost.get(k)?.value
        const reported = priceBuckets[kind].get(k)?.value
        let rate = null
        const thinVolume = medVol > 0 && vol != null && vol < medVol * 0.05
        if (!thinVolume && vol != null && vol > 0 && costMr != null && costMr > 0) {
          rate = (costMr * 1_000_000) / vol
        }
        // Prefer reported unit price when derived rate is missing or looks like a restatement spike
        if (
          reported != null &&
          reported > 0 &&
          (rate == null || thinVolume || (rate > reported * 8 && reported > 0))
        ) {
          rate = reported
        }
        if (rate != null && Number.isFinite(rate) && rate > 0) {
          rateMap.set(k, {
            value: rate,
            periodEndingDate: volRow.periodEndingDate || priceBuckets[kind].get(k)?.periodEndingDate,
          })
        }
      }
      let rateMonths = buildMonthPoints(rateMap)
      // Drop extreme restatement spikes (e.g. near-zero volume months)
      const positiveRates = rateMonths.map((m) => m.value).filter((v) => v != null && v > 0)
      if (positiveRates.length >= 4) {
        const sorted = [...positiveRates].sort((a, b) => a - b)
        const med = sorted[Math.floor(sorted.length / 2)]
        const p90 = sorted[Math.floor(sorted.length * 0.9)]
        const cap = Math.max(med * 12, p90 * 4)
        rateMonths = rateMonths.map((m) =>
          m.value != null && m.value > cap ? { ...m, value: null, priorValue: null, yoyPct: null } : m,
        )
        // recompute prior/yoy after nulling spikes
        const byK = new Map(
          rateMonths.map((m) => [`${m.fiscalYear}-${String(m.fiscalMonth).padStart(2, '0')}`, m]),
        )
        rateMonths = rateMonths.map((m) => {
          const prior = byK.get(`${m.fiscalYear - 1}-${String(m.fiscalMonth).padStart(2, '0')}`)
          return {
            ...m,
            priorValue: prior?.value ?? null,
            yoyPct: yoyPct(m.value, prior?.value ?? null),
          }
        })
      }
      const avgs = rollingAvgs(rateMonths)
      return {
        id: meta.id,
        labelFa: meta.labelFa,
        unit,
        unitFa: unitFa(unit) || meta.unitDefault,
        months,
        rates: {
          unit: RATE_UNIT_FA[kind],
          unitFa: RATE_UNIT_FA[kind],
          months: rateMonths,
          ...avgs,
        },
      }
    })
    .filter(Boolean)
}

function buildIndustryEnergyRates(companies) {
  const byInd = new Map()
  for (const c of companies) {
    if (!c.industry) continue
    if (!byInd.has(c.industry)) {
      byInd.set(c.industry, { industry: c.industry, industryFa: c.industryFa, members: [] })
    }
    byInd.get(c.industry).members.push(c)
  }

  return [...byInd.values()].map((g) => {
    const energy = {}
    for (const kind of Object.keys(ENERGY_META)) {
      const seriesList = g.members
        .map((c) => c.energy?.find((e) => e.id === kind)?.rates)
        .filter(Boolean)
      if (!seriesList.length) continue

      // Align by fiscal key for monthly industry average rate
      const keyMap = new Map()
      for (const rates of seriesList) {
        for (const m of rates.months || []) {
          if (m.value == null || !(m.value > 0)) continue
          const k = `${m.fiscalYear}-${String(m.fiscalMonth).padStart(2, '0')}`
          if (!keyMap.has(k)) keyMap.set(k, { ...m, _vals: [] })
          keyMap.get(k)._vals.push(m.value)
        }
      }
      const months = [...keyMap.keys()]
        .sort()
        .map((k) => {
          const row = keyMap.get(k)
          const value = avgOf(row._vals)
          return {
            fiscalYear: row.fiscalYear,
            fiscalMonth: row.fiscalMonth,
            periodEndingDate: row.periodEndingDate,
            label: row.label,
            value,
            priorValue: null,
            yoyPct: null,
          }
        })
      // fill prior/yoy for industry series
      const byKey = new Map(months.map((m) => [`${m.fiscalYear}-${String(m.fiscalMonth).padStart(2, '0')}`, m]))
      for (const m of months) {
        const prior = byKey.get(`${m.fiscalYear - 1}-${String(m.fiscalMonth).padStart(2, '0')}`)
        m.priorValue = prior?.value ?? null
        m.yoyPct = yoyPct(m.value, m.priorValue)
      }
      const avgs = rollingAvgs(months)
      energy[kind] = {
        id: kind,
        labelFa: ENERGY_META[kind].labelFa,
        unitFa: RATE_UNIT_FA[kind],
        months,
        ...avgs,
        companyCount: seriesList.length,
      }
    }
    return {
      industry: g.industry,
      industryFa: g.industryFa,
      symbols: g.members.map((c) => c.symbol),
      energy,
    }
  })
}

async function fetchCompany(cookie, idToken, h) {
  const base = `/api/v2/exchanges/${h.exchange}/stocks/${h.isin}`
  const [prod, energy] = await Promise.all([
    bvJson(cookie, idToken, `${base}/productions?timeFrame=monthly&lastN=${LAST_N}`).catch(() => ({ items: [] })),
    bvJson(cookie, idToken, `${base}/energy?timeFrame=monthly&lastN=${LAST_N}`).catch(() => ({ items: [] })),
  ])
  const products = extractProducts(prod.items || [])
  const energySeries = extractEnergy(energy.items || [])
  if (!products.length && !energySeries.length) {
    return { ...h, products: [], energy: [], ok: false }
  }
  const allMonths = [
    ...products.flatMap((p) => p.months),
    ...energySeries.flatMap((e) => e.months),
  ]
  let latest = null
  for (const m of allMonths) {
    if (m.value == null) continue
    if (
      !latest ||
      m.fiscalYear > latest.fiscalYear ||
      (m.fiscalYear === latest.fiscalYear && m.fiscalMonth > latest.fiscalMonth)
    ) {
      latest = m
    }
  }
  return {
    symbol: h.symbol,
    name: h.name,
    isin: h.isin,
    exchange: h.exchange,
    industry: h.industry,
    industryFa: h.industryFa,
    ok: true,
    latestFiscalYear: latest?.fiscalYear ?? null,
    latestFiscalMonth: latest?.fiscalMonth ?? null,
    latestLabel: latest?.label ?? null,
    products,
    energy: energySeries,
  }
}

export async function buildProductionBundle(cookie, idToken = '') {
  const companies = []
  const errors = []
  for (let i = 0; i < HOLDINGS.length; i += 3) {
    const chunk = HOLDINGS.slice(i, i + 3)
    const part = await Promise.allSettled(chunk.map((h) => fetchCompany(cookie, idToken, h)))
    part.forEach((r, idx) => {
      const h = chunk[idx]
      if (r.status === 'fulfilled') {
        if (r.value.ok) companies.push(r.value)
        else errors.push(`${h.symbol}: empty`)
      } else {
        errors.push(`${h.symbol}: ${r.reason}`)
      }
    })
  }
  const industryEnergyRates = buildIndustryEnergyRates(companies)
  return {
    ok: companies.length > 0,
    updatedAt: new Date().toISOString(),
    source: 'bourseview',
    note: 'حجم ماهانه از گزارش تجمعی · نرخ انرژی از EnergyUnitPrice/هزینه÷حجم · میانگین صنعت ساده بین شرکت‌های همان گروه',
    companies,
    industryEnergyRates,
    errors: errors.slice(0, 12),
  }
}
