/**
 * Cloudflare Pages Function — live overview refresh
 * GET /api/overview
 *
 * Pulls fresh:
 *  - TGJU quotes (TEDPIX, USD)
 *  - TGJU today-table-data (intraday index path)
 *  - shakhesban indices (equal-weight, IFB)
 *  - SourceArena market_bourse + market_farabourse (official MV sum)
 *  - parsistahlil.ir latest retail / money-flow report
 */
const TGJU_AJAX = 'https://call2.tgju.org/ajax.json'
const TGJU_TODAY = 'https://api.tgju.org/v1/market/indicator/today-table-data/bourse?lang=fa'
const SHAKH_INDEX = 'https://www.shakhesban.com/markets/index'
const PARSIS_HOME = 'https://parsistahlil.ir/'
const SOURCEARENA_API = 'https://apis.sourcearena.ir/api/'
const BILLION_RIAL_PER_HEMAT = 10000
const RIAL_PER_HEMAT = 1e13

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function parseNum(raw) {
  if (raw == null) return null
  const n = Number(String(raw).replace(/,/g, '').replace(/[^\d.eE+-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function parseBillionRial(raw) {
  if (raw == null) return null
  const s = String(raw).trim().replace(/,/g, '').replace(/\s/g, '').replace(/[Bb]$/, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function toHmt(billionRial) {
  if (billionRial == null) return null
  return Math.round((billionRial / BILLION_RIAL_PER_HEMAT) * 10) / 10
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { Accept: '*/*', 'User-Agent': UA, Referer: 'https://www.tgju.org/' },
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.text()
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

async function fetchJsonRetry(url, attempts = 4) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': UA,
          Referer: 'https://sourcearena.ir/',
        },
      })
      if (!res.ok) throw new Error(`${url} ${res.status}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr
}

function tgjuQuote(row, id, name) {
  if (!row) return null
  const value = parseNum(row.p)
  const change = parseNum(row.d) ?? 0
  const changePct = parseNum(row.dp) ?? 0
  const signedChange = row.dt === 'low' || changePct < 0 ? -Math.abs(change) : Math.abs(change)
  return {
    id,
    name,
    value,
    change: signedChange,
    changePct: row.dt === 'low' ? -Math.abs(changePct) : Math.abs(changePct),
    time: row.t || row.t_en || null,
    source: 'tgju',
  }
}

function parseShakhesbanIndices(html) {
  const wanted = {
    'ش-کل-بورس': 'tedpix',
    'ش-کل-هم-وزن': 'equalWeight',
    'ش-کل-فرابورس': 'ifb',
  }
  const out = {}
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let m
  while ((m = trRe.exec(html))) {
    const block = m[1]
    const hm = block.match(/\/markets\/index\/([^"']+)"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/)
    if (!hm) continue
    const slug = decodeURIComponent(hm[1])
    const key = wanted[slug]
    if (!key) continue
    const title = stripHtml(hm[2])
    const vals = {}
    const tdRe1 = /<td[^>]*data-val="([^"]*)"[^>]*data-col="([^"]+)"/g
    const tdRe2 = /<td[^>]*data-col="([^"]+)"[^>]*data-val="([^"]*)"/g
    let td
    while ((td = tdRe1.exec(block))) vals[td[2]] = td[1]
    while ((td = tdRe2.exec(block))) vals[td[1]] = td[2]
    const value = parseNum(vals.value || vals['info.last_trade.PDrCotVal'])
    const change = parseNum(vals.change || vals['info.last_trade.last_change'])
    let pct = parseNum(vals['info.last_trade.last_change_percentage'] || vals.percent)
    if (pct != null && Math.abs(pct) < 1) pct = pct * 100
    else if (pct == null && value != null && change != null && value !== change) {
      const prev = value - change
      if (prev) pct = (change / prev) * 100
    }
    out[key] = {
      name: title,
      value,
      change,
      changePct: pct != null ? Math.round(pct * 100) / 100 : null,
      source: 'shakhesban',
    }
  }
  return out
}

function parseIntraday(payload) {
  const rows = payload?.data || []
  const points = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue
    const value = parseNum(row[0])
    const time = String(row[1] || '').trim()
    if (value == null || !time) continue
    const chg = parseNum(stripHtml(row[2]))
    points.push({ time, value, change: chg })
  }
  points.reverse()
  return points
}

async function scrapeSourceArena(token) {
  const tok = (token || '').trim()
  if (!tok) return { ok: false, error: 'SOURCEARENA_TOKEN missing' }

  const [bourseRes, ifbRes, indBourseRes, indIfbRes] = await Promise.allSettled([
    fetchJsonRetry(`${SOURCEARENA_API}?token=${encodeURIComponent(tok)}&market=market_bourse`),
    fetchJsonRetry(`${SOURCEARENA_API}?token=${encodeURIComponent(tok)}&market=market_farabourse`),
    fetchJsonRetry(`${SOURCEARENA_API}?token=${encodeURIComponent(tok)}&market=ind_namad_bourse`, 3),
    fetchJsonRetry(`${SOURCEARENA_API}?token=${encodeURIComponent(tok)}&market=ind_namad_farabourse`, 3),
  ])

  if (bourseRes.status !== 'fulfilled' || ifbRes.status !== 'fulfilled') {
    const err =
      (bourseRes.status === 'rejected' && String(bourseRes.reason)) ||
      (ifbRes.status === 'rejected' && String(ifbRes.reason)) ||
      'sourcearena failed'
    return { ok: false, error: err }
  }

  const bourse = bourseRes.value?.bourse
  const ifb = ifbRes.value?.['fara-bourse']
  if (!bourse || !ifb) return { ok: false, error: 'unexpected sourcearena payload' }

  const bMv = toHmt(parseBillionRial(bourse.market_value))
  const fMv = toHmt(parseBillionRial(ifb.market_value))
  const bTr = toHmt(parseBillionRial(bourse.trade_value))
  const fTr = toHmt(parseBillionRial(ifb.trade_value))
  if (bMv == null || fMv == null) return { ok: false, error: 'missing market_value' }

  let totalTrade = null
  let tradeSource = null
  // ارزش معاملات فرابورس «در یک نگاه» اغلب اوراق را هم دارد؛ فقط وقتی معقول است جمع کن
  if (bTr != null && fTr != null && fTr <= Math.max(bTr * 4, 80)) {
    totalTrade = Math.round((bTr + fTr) * 100) / 100
    tradeSource = 'sourcearena-bourse+ifb'
  } else if (bTr != null) {
    totalTrade = bTr
    tradeSource = 'sourcearena-bourse-only'
  }

  function splitImpacts(rows) {
    const list = Array.isArray(rows) ? rows : []
    const mapped = []
    for (const row of list.slice(0, 16)) {
      const symbol = String(row?.name || row?.symbol || '').trim()
      const effect = parseBillionRial(row?.effect ?? row?.impact)
      if (!symbol || effect == null) continue
      mapped.push({ symbol, impact: effect })
    }
    return {
      pos: mapped.filter((x) => x.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, 7),
      neg: mapped.filter((x) => x.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, 7),
    }
  }

  const bImp = splitImpacts(indBourseRes.status === 'fulfilled' ? indBourseRes.value : [])
  const fImp = splitImpacts(indIfbRes.status === 'fulfilled' ? indIfbRes.value : [])
  const impacts = {
    boursePos: bImp.pos,
    bourseNeg: bImp.neg,
    ifbPos: fImp.pos,
    ifbNeg: fImp.neg,
  }
  const hasImpacts = Object.values(impacts).some((arr) => arr.length > 0)

  return {
    ok: true,
    source: 'sourcearena',
    bourseMarketValueHmt: bMv,
    ifbMarketValueHmt: fMv,
    totalMarketValueHmt: Math.round((bMv + fMv) * 10) / 10,
    totalTradeValueHmt: totalTrade,
    totalTradeValueSource: tradeSource,
    marketValueSource: 'sourcearena-bourse+ifb',
    impacts: hasImpacts ? impacts : null,
    impactsFromSourceArena: hasImpacts,
  }
}

const JALALI_MONTHS = {
  فروردین: 1,
  اردیبهشت: 2,
  خرداد: 3,
  تیر: 4,
  مرداد: 5,
  شهریور: 6,
  مهر: 7,
  آبان: 8,
  آذر: 9,
  دی: 10,
  بهمن: 11,
  اسفند: 12,
}

function parseJalaliDate(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    return {
      dateJalali: `${String(y).padStart(4, '0')}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
      date: `${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
    }
  }
  m = s.match(
    /^(\d{1,2})\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*(\d{4})$/,
  )
  if (!m) return null
  const d = Number(m[1])
  const mo = JALALI_MONTHS[m[2]]
  const y = Number(m[3])
  return {
    dateJalali: `${String(y).padStart(4, '0')}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
    date: `${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
  }
}

function parseParsistahlilHtml(html, cid, url) {
  const text = stripHtml(html.replace(/<script[\s\S]*?<\/script>/g, ' '))
  let retail = null
  let m = text.match(/معاملات\s*#?خرد[\s\S]{0,80}?مبلغ\s*([\d,]+)\s*میلیارد/) || text.match(/مبلغ\s*([\d,]+)\s*میلیارد تومان بود/)
  if (m) retail = parseNum(m[1])

  let totalTrades = null
  m = text.match(/ارزش کل معاملات امروز بازار\s*([\d,]+)\s*میلیارد/)
  if (m) totalTrades = parseNum(m[1])

  let flow = null
  m = text.match(/مبلغ\s*([\d,]+)\s*میلیارد تومان\s*(ورود|خروج)\s*حقیقی/)
  if (m) {
    flow = parseNum(m[1])
    if (flow != null) flow = m[2] === 'خروج' ? -Math.abs(flow) : Math.abs(flow)
  }

  let dateJalaliRaw = null
  m = text.match(/مورخ\s*(\d{1,2}\s*[\u0600-\u06FF]+\s*\d{4}|\d{4}\/\d{2}\/\d{2})/)
  if (m) dateJalaliRaw = m[1].trim()
  const parsed = parseJalaliDate(dateJalaliRaw)
  if (retail == null && flow == null) return null
  return {
    ok: true,
    source: 'parsistahlil.ir',
    contentId: String(cid),
    url,
    dateJalaliRaw,
    dateJalali: parsed?.dateJalali || null,
    date: parsed?.date || null,
    retailTradeValueBillionToman: retail,
    totalTradeValueBillionToman: totalTrades,
    retailMoneyFlowDailyBillionToman: flow,
  }
}

async function scrapeParsistahlil() {
  const home = await fetchText(PARSIS_HOME)
  const ids = [...home.matchAll(/\/contents\/(\d+)-%DA%AF%D8%B2%D8%A7%D8%B1%D8%B4-%D9%88%D8%B6%D8%B9%DB%8C%D8%AA-%D8%A8%D8%A7%D8%B2%D8%A7%D8%B1/g)].map(
    (x) => x[1],
  )
  const uniq = [...new Set(ids)].sort((a, b) => Number(b) - Number(a))
  const slug =
    '%DA%AF%D8%B2%D8%A7%D8%B1%D8%B4-%D9%88%D8%B6%D8%B9%DB%8C%D8%AA-%D8%A8%D8%A7%D8%B2%D8%A7%D8%B1-%D8%A7%D8%B1%D8%B2%D8%B4-%D9%85%D8%B9%D8%A7%D9%85%D9%84%D8%A7%D8%AA-%D8%AE%D8%B1%D8%AF-%D9%88-%D9%88%D8%B1%D9%88%D8%AF-%D9%88-%D8%AE%D8%B1%D9%88%D8%AC-%D9%BE%D9%88%D9%84-%D8%AD%D9%82%DB%8C%D9%82%DB%8C'

  let lastErr = 'no report link'
  const days = []
  const seedIds = uniq.map(Number).filter((n) => Number.isFinite(n))
  const newest = seedIds.length ? Math.max(...seedIds) : 1180
  const probe = new Set(seedIds)
  for (let i = newest; i > newest - 10 && i > 0; i--) probe.add(i)
  const ordered = [...probe].sort((a, b) => b - a).slice(0, 12)

  for (const cidNum of ordered) {
    const cid = String(cidNum)
    const url = `https://parsistahlil.ir/contents/${cid}-${slug}`
    try {
      const html = await fetchText(url)
      const row = parseParsistahlilHtml(html, cid, url)
      if (row) days.push(row)
      else lastErr = `content ${cid} no numbers`
    } catch (e) {
      lastErr = String(e)
    }
  }
  if (!days.length) return { ok: false, error: lastErr, days: [] }
  days.sort((a, b) => String(b.dateJalali || '').localeCompare(String(a.dateJalali || '')))
  const latest = days[0]
  return {
    ok: true,
    source: 'parsistahlil.ir',
    contentId: latest.contentId,
    url: latest.url,
    dateJalali: latest.dateJalaliRaw || latest.dateJalali,
    retailTradeValueBillionToman: latest.retailTradeValueBillionToman,
    totalTradeValueBillionToman: latest.totalTradeValueBillionToman,
    retailMoneyFlowDailyBillionToman: latest.retailMoneyFlowDailyBillionToman,
    days,
  }
}

function recomputeMoneyFlowYtd(store) {
  const baseline = Number(store.baselineYtdBillionToman ?? -25271)
  const through = String(store.baselineThroughJalali || '1405/04/29')
  let extra = 0
  let asOf = through
  let asLabel = through.slice(5)
  for (const row of store.series || []) {
    const dj = String(row.dateJalali || '')
    if (!dj || dj <= through) continue
    extra += Number(row.value) || 0
    asOf = dj
    asLabel = row.date || dj.slice(5)
  }
  return {
    ...store,
    ytdBillionToman: Math.round(baseline + extra),
    asOfJalali: asOf,
    asOfLabel: asLabel,
    updatedAt: new Date().toISOString(),
    source: 'parsistahlil.ir',
  }
}

function mergeMoneyFlowStore(store, days) {
  const through = String(store.baselineThroughJalali || '1405/04/29')
  const series = [...(store.series || [])]
  const byDate = new Map(series.filter((r) => r.dateJalali).map((r) => [String(r.dateJalali), r]))
  const added = []
  const ordered = [...(days || [])]
    .filter((d) => d.dateJalali && d.retailMoneyFlowDailyBillionToman != null)
    .sort((a, b) => String(a.dateJalali).localeCompare(String(b.dateJalali)))

  for (const day of ordered) {
    const dj = String(day.dateJalali)
    if (dj <= through) continue
    const value = Math.round(Number(day.retailMoneyFlowDailyBillionToman))
    if (!Number.isFinite(value)) continue
    const point = {
      date: day.date || dj.slice(5),
      dateJalali: dj,
      value,
      contentId: String(day.contentId || ''),
    }
    if (byDate.has(dj)) {
      const prev = byDate.get(dj)
      if (Number(prev.value) !== value) {
        Object.assign(prev, point)
        added.push(`update:${dj}`)
      }
      continue
    }
    series.push(point)
    byDate.set(dj, point)
    added.push(dj)
  }
  series.sort((a, b) => String(a.dateJalali).localeCompare(String(b.dateJalali)))
  const next = recomputeMoneyFlowYtd({ ...store, series })
  return { store: next, added }
}

export async function onRequestGet(context) {
  const errors = []
  let quotes = {}
  let indices = {}
  let intraday = []
  let parsistahlil = { ok: false }
  let sourcearena = { ok: false }
  let moneyFlowStore = {
    baselineYtdBillionToman: -25271,
    baselineThroughJalali: '1405/04/29',
    ytdBillionToman: -25271,
    asOfJalali: '1405/04/29',
    series: [],
  }

  const token =
    context?.env?.SOURCEARENA_TOKEN ||
    'bba6d330a87bac533f18cc245d3baeaa'

  const origin = new URL(context.request.url).origin

  const tasks = await Promise.allSettled([
    fetchJson(TGJU_AJAX),
    fetchJson(TGJU_TODAY),
    fetchText(SHAKH_INDEX),
    scrapeParsistahlil(),
    scrapeSourceArena(token),
    fetchJson(`${origin}/data/money_flow_ytd.json`).catch(() => null),
  ])

  if (tasks[0].status === 'fulfilled') {
    const current = tasks[0].value.current || {}
    quotes = {
      bourse: tgjuQuote(current.bourse, 'bourse', 'شاخص کل بورس'),
      price_dollar_rl: tgjuQuote(current.price_dollar_rl, 'price_dollar_rl', 'دلار آزاد'),
    }
  } else errors.push(`tgju: ${tasks[0].reason}`)

  if (tasks[1].status === 'fulfilled') {
    intraday = parseIntraday(tasks[1].value)
  } else errors.push(`intraday: ${tasks[1].reason}`)

  if (tasks[2].status === 'fulfilled') {
    indices = parseShakhesbanIndices(tasks[2].value)
  } else errors.push(`shakhesban: ${tasks[2].reason}`)

  if (tasks[3].status === 'fulfilled') {
    parsistahlil = tasks[3].value
  } else {
    parsistahlil = { ok: false, error: String(tasks[3].reason) }
    errors.push(`parsistahlil: ${tasks[3].reason}`)
  }

  if (tasks[4].status === 'fulfilled') {
    sourcearena = tasks[4].value
    if (!sourcearena.ok) errors.push(`sourcearena: ${sourcearena.error}`)
  } else {
    sourcearena = { ok: false, error: String(tasks[4].reason) }
    errors.push(`sourcearena: ${tasks[4].reason}`)
  }

  if (tasks[5].status === 'fulfilled' && tasks[5].value) {
    moneyFlowStore = tasks[5].value
  } else if (tasks[5].status === 'rejected') {
    errors.push(`money_flow_ytd: ${tasks[5].reason}`)
  }

  const merged = mergeMoneyFlowStore(moneyFlowStore, parsistahlil.days || [])
  moneyFlowStore = merged.store

  const usd = quotes.price_dollar_rl?.value ?? null
  const tedpix = indices.tedpix || (quotes.bourse
    ? {
        name: quotes.bourse.name,
        value: quotes.bourse.value,
        change: quotes.bourse.change,
        changePct: quotes.bourse.changePct,
        source: 'tgju',
      }
    : null)

  let totalMarketValueUsdM = null
  if (sourcearena.ok && sourcearena.totalMarketValueHmt != null && usd > 0) {
    totalMarketValueUsdM = Math.round((sourcearena.totalMarketValueHmt * RIAL_PER_HEMAT) / usd / 1e6)
  }

  const blocked = [
    ...(sourcearena.ok ? [] : ['sourcearena']),
    ...(parsistahlil.ok ? [] : ['parsistahlil']),
  ]

  return Response.json(
    {
      ok: true,
      updatedAt: new Date().toISOString(),
      quotes,
      indices: {
        tedpix,
        equalWeight: indices.equalWeight || null,
        ifb: indices.ifb || null,
      },
      intraday: {
        source: 'tgju-today-table',
        note: 'مسیر روزانه TGJU (رزولوشن چنددقیقه‌ای).',
        points: intraday,
      },
      sourcearena,
      bourseMarketValueHmt: sourcearena.bourseMarketValueHmt ?? null,
      ifbMarketValueHmt: sourcearena.ifbMarketValueHmt ?? null,
      totalMarketValueHmt: sourcearena.totalMarketValueHmt ?? null,
      totalMarketValueUsdM,
      marketValueSource: sourcearena.marketValueSource ?? null,
      totalTradeValueHmt: sourcearena.totalTradeValueHmt ?? null,
      totalTradeValueSource: sourcearena.totalTradeValueSource ?? null,
      impacts: sourcearena.impacts ?? null,
      impactsFromSourceArena: Boolean(sourcearena.impactsFromSourceArena),
      parsistahlil,
      retailMoneyFlowYtd: moneyFlowStore.ytdBillionToman,
      retailMoneyFlowYtdSource: 'parsistahlil-cumulative',
      moneyFlowAsOfJalali: moneyFlowStore.asOfJalali,
      moneyFlowSeries: (moneyFlowStore.series || []).map((r) => ({
        date: r.date,
        dateJalali: r.dateJalali,
        value: r.value,
      })),
      moneyFlowAdded: merged.added,
      usdRate: usd,
      errors,
      blocked,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}
