Exit code: 0
Wall time: 0.7 seconds
Total output lines: 1451
Output:
/**
 * Cloudflare Pages Function â€” live overview refresh
 * GET /api/overview
 *
 * Pulls fresh:
 *  - TGJU quotes (TEDPIX, USD)
 *  - TGJU today-table-data (intraday index path)
 *  - shakhesban indices (equal-weight, IFB)
 *  - SourceArena market_bourse + market_farabourse (official MV sum)
 *  - parsistahlil.ir latest retail / money-flow report
 *  - TradersArena /data/market for order-book + per-capita pulse
 */
import {
  fetchTradersArenaPulse,
  loadPulseStore,
  savePulseStore,
  mergePulseHistory,
} from '../lib/pulse.js'

const TGJU_AJAX = 'https://call2.tgju.org/ajax.json'
const TGJU_TODAY = 'https://api.tgju.org/v1/market/indicator/today-table-data/bourse?lang=fa'
const TSETMC_OVERVIEW = 'https://cdn.tsetmc.com/api/MarketData/GetMarketOverview/'
// Official TSETMC ranking: 2 = Farabourse, 7 = IFB total index.
const TSETMC_IFB_EFFECT = 'https://cdn.tsetmc.com/api/Index/GetInstEffect/0/2/7'
const SHAKH_INDEX = 'https://www.shakhesban.com/markets/index'
const SHAKH_LIST = 'https://www.shakhesban.com/stocks/list-data'
const TA_HEATMAP_STOCK_FUNDS = 'https://tradersarena.ir/data/heatmap/stock-funds'
/** Default featured watch under Ø­Ù‚ÛŒÙ‚ÛŒ/Ø­Ù‚ÙˆÙ‚ÛŒ â€” already the live Â«Ø§Ø±Ø²Ø´Â» ranking table. */
const TA_MAINWATCH_SYMBOLS = 'https://tradersarena.ir/data/mainwatch/symbols'
const PARSIS_HOME = 'https://parsistahlil.ir/'
const SOURCEARENA_API = 'https://apis.sourcearena.ir/api/'
const RAHAVARD_API = 'https://rahavard365.com/api/v2'
const TOP_TRADES_LIMIT = 12
const BILLION_RIAL_PER_HEMAT = 10000
const RIAL_PER_HEMAT = 1e13
const RIAL_PER_BILLION_TOMAN = 1e10

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

const UPSTREAM_MS = 4500

async function fetchText(url, ms = UPSTREAM_MS) {
  const res = await fetch(url, {
    headers: { Accept: '*/*', 'User-Agent': UA, Referer: 'https://www.tgju.org/' },
    signal: AbortSignal.timeout(ms),
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.text()
}

async function fetchJson(url, ms = UPSTREAM_MS) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(ms),
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

/** Official TSETMC market overview: flow 1 = TSE, flow 2 = IFB. */
async function fetchTsetmcMarketSummary() {
  const read = async (flow) => {
    const payload = await fetchJson(`${TSETMC_OVERVIEW}${flow}`, 4000)
    const row = payload?.marketOverview || payload?.data || payload || {}
    const num = (...keys) => {
      for (const key of keys) {
        const value = parseNum(row?.[key])
        if (value != null) return value
      }
      return null
    }
    return {
      index: num('indexLastValue', 'indexValue', 'lastValue'),
      indexChange: num('indexChange', 'change'),
      equalIndex: num('indexEqualWeightedLastValue', 'equalWeightedLastValue'),
      equalIndexChange: num('indexEqualWeightedChange', 'equalWeightedChange'),
      marketValue: num('marketValue', 'marketCap', 'marketCapitalization'),
    }
  }
  const [bourse, ifb] = await Promise.all([read(1), read(2)])
  const bMv = bourse.marketValue
  const fMv = ifb.marketValue
  return {
    ok: bourse.index != null || ifb.index != null || bMv != null || fMv != null,
    bourse,
    ifb,
    bourseMarketValueHmt: bMv != null ? Math.round((bMv / RIAL_PER_HEMAT) * 10) / 10 : null,
    ifbMarketValueHmt: fMv != null ? Math.round((fMv / RIAL_PER_HEMAT) * 10) / 10 : null,
  }
}

/**
 * Official IFB index constituents ranked by their actual index-point effect.
 * This must not be replaced with a market-cap Ã— price-change approximation:
 * TSETMC publishes the calculated effect itself as instEffectValue.
 */
async function fetchTsetmcIfbEffects() {
  const payload = await fetchJson(TSETMC_IFB_EFFECT, 5000)
  const rows = Array.isArray(payload)
    ? payload
    : payload?.instrumentEffect || payload?.instrumentEffects || payload?.data || payload?.items || []
  if (!Array.isArray(rows)) throw new Error('TSETMC IFB effect: unexpected response')

  const normalized = rows
    .map((row) => {
      const instrument = row?.instrument || row?.ins || {}
      const symbol = String(
        instrument?.lVal18AFC || instrument?.symbol || row?.lVal18AFC || row?.symbol || row?.namad || '',
      ).trim()
      const name = String(
        instrument?.lVal30 || instrument?.name || row?.lVal30 || row?.name || symbol,
      ).trim()
      const effect = parseNum(row?.instEffectValue ?? row?.effectValue ?? row?.indexEffect ?? row?.effect)
      return symbol && effect != null ? { symbol, name, effect } : null
    })
    .filter(Boolean)

  if (!normalized.length) throw new Error('TSETMC IFB effect: no usable rows')
  return {
    ok: true,
    ifbPos: normalized.filter((x) => x.effect > 0).sort((a, b) => b.effect - a.effect).slice(0, 5),
    ifbNeg: normalized.filter((x) => x.effect < 0).sort((a, b) => a.effect - b.effect).slice(0, 5),
  }
}

async function fetchJsonRetry(url, attempts = 2) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': UA,
          Referer: 'https://sourcearena.ir/',
        },
        signal: AbortSignal.timeout(UPSTREAM_MS),
      })
      if (!res.ok) throw new Error(`${url} ${res.status}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 200 * (i + 1)))
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
    'Ø´-Ú©Ù„-Ø¨ÙˆØ±Ø³': 'tedpix',
    'Ø´-Ú©Ù„-Ù‡Ù…-ÙˆØ²Ù†': 'equalWeight',
    'Ø´-Ú©Ù„-ÙØ±Ø§Ø¨ÙˆØ±Ø³': 'ifb',
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

function jalaliToday() {
  const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
  const y = String(parts.year).padStart(4, '0')
  const mo = String(parts.month).padStart(2, '0')
  const d = String(parts.day).padStart(2, '0')
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return {
    dateJalali: `${y}/${mo}/${d}`,
    dateGregorian: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' }),
    time: timeFmt.format(new Date()),
  }
}

function parseShakhesbanTbody(tbody) {
  const rows = []
  const trRe = /<tr\s+data-symbol="([^"]+)">([\s\S]*?)<\/tr>/g
  let m
  while ((m = trRe.exec(tbody || ''))) {
    const symbol = m[1]
    const block = m[2]
    const vals = {}
    const tdRe1 = /<td[^>]*data-val="([^"]*)"[^>]*data-col="([^"]+)"/g
    const tdRe2 = /<td[^>]*data-col="([^"]+)"[^>]*data-val="([^"]*)"/g
    let td
    while ((td = tdRe1.exec(block))) vals[td[2]] = td[1]
    while ((td = tdRe2.exec(block))) vals[td[1]] = td[2]
    const marketFa = vals['info.market_fa'] || ''
    if (marketFa === 'Ø¢ØªÛŒ') continue
    const yesterday = parseNum(vals['info.PriceYesterday']) || 0
    const close = parseNum(vals['info.last_price.PClosing']) || 0
    const last = parseNum(vals['info.last_trade.PDrCotVal']) || 0
    let closeChg = parseNum(vals['info.last_price.closing_change'])
    let lastChg = parseNum(vals['info.last_trade.last_change'])
    if (closeChg == null && close && yesterday) closeChg = close - yesterday
    if (lastChg == null && last && yesterday) lastChg = last - yesterday
    const finalChg = closeChg != null && closeChg !== 0 ? closeChg : lastChg
    rows.push({
      symbol,
      title: vals['info.title'] || '',
      marketFa,
      flow: vals['info.flow.title'] || '',
      marketValue: parseNum(vals['trades.arzesh_bazar']) || 0,
      tradeValue: parseNum(vals['trades.QTotCap']) || 0,
      close,
      last,
      yesterday,
      closeChg,
      lastChg,
      finalChg,
      changePctLast: parseNum(vals['info.last_trade.last_change_percentage']) || 0,
      changePctClose: parseNum(vals['info.last_price.closing_change_percentage']) || 0,
      buyIVol: parseNum(vals['trades.buy_and_sell.Buy_I_Volume']) || 0,
      sellIVol: parseNum(vals['trades.buy_and_sell.Sell_I_Volume']) || 0,
      orderBuyVol: parseNum(vals['demands.1_0']) || 0,
      orderBuyCnt: parseNum(vals['demands.1_1']) || 0,
      orderBuyPx: parseNum(vals['demands.1_2']) || 0,
      orderSellPx: parseNum(vals['demands.1_3']) || 0,
      orderSellCnt: parseNum(vals['demands.1_4']) || 0,
      orderSellVol: parseNum(vals['demands.1_5']) || 0,
    })
  }
  return rows
}

async function scrapeShakhesbanPages({ maxPages = 12, orderCol = 'trades.arzesh_bazar', market = null } = {}) {
  const pages = Array.from({ length: maxPages }, (_, i) => i + 1)
  const results = await Promise.allSettled(
    pages.map(async (page) => {
      const qs = new URLSearchParams({
        limit: '100',
        page: String(page),
        order_col: orderCol,
        order_dir: 'desc',
        _: String(Date.now()),
      })
      if (market) qs.set('market', market)
      const res = await fetch(`${SHAKH_LIST}?${qs}`, {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'User-Agent': UA,
          Referer: 'https://www.shakhesban.com/',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(UPSTREAM_MS),
      })
      if (!res.ok) throw new Error(`shakhesban ${page} ${res.status}`)
      return res.json()
    }),
  )
  const rows = []
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    rows.push(...parseShakhesbanTbody(r.value?.tbody || ''))
  }
  return rows
}

async function scrapeShakhesbanBoardLite(maxPages = 4) {
  // Full board (Ø³Ù‡Ø§Ù…+ØµÙ†Ø¯ÙˆÙ‚+Ø§ÙˆØ±Ø§Ù‚) â€” no market=stock filter. Used for IFB impacts + fallback pulse.
  return scrapeShakhesbanPages({ maxPages, orderCol: 'trades.arzesh_bazar' })
}

/** Normalize Persian symbols for set membership (Ø¯Ø§Ø±Ø§ ÛŒÚ©Ù… â†” Ø¯Ø§Ø±Ø§ÛŒÚ©Ù…). */
function normalizeSymbolKey(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/\u200c/g, '')
    .replace(/\u200d/g, '')
    .replace(/\u00a0/g, '')
    .trim()
}

/**
 * Equity-fund universe from TradersArena heatmap Â«ØµÙ†Ø¯ÙˆÙ‚ Ù‡Ø§ÛŒ Ø³Ù‡Ø§Ù…ÛŒÂ»
 * (includes Ø§Ù‡Ø±Ù…ÛŒ / Ø¨Ø®Ø´ÛŒ / Ø´Ø§Ø®ØµÛŒ / Ú©Ù„Ø§Ø³ÛŒÚ© subclasses).
 */
async function fetchEquityFundSymbolSet() {
  const res = await fetch(TA_HEATMAP_STOCK_FUNDS, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': UA,
      Referer: 'https://tradersarena.ir/',
    },
    signal: AbortSignal.timeout(UPSTREAM_MS),
  })
  if (!res.ok) throw new Error(`ta heatmap stock-funds ${res.status}`)
  const rows = await res.json()
  const set = new Set()
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const key = normalizeSymbolKey(row?.name)
      if (key) set.add(key)
    }
  }
  // shakhesban ticker spelling for Ø¯Ø§Ø±Ø§ ÛŒÚ©Ù…
  set.add(normalizeSymbolKey('Ø¯Ø§Ø±Ø§ÛŒÚ©Ù…'))
  set.add(normalizeSymbolKey('Ø¯Ø§Ø±Ø§ ÛŒÚ©Ù…'))
  return set
}

function isEquityFundRow(row, fundSet) {
  if ((row?.marketFa || '') !== 'ØµÙ†Ø¯ÙˆÙ‚') return false
  const key = normalizeSymbolKey(row.symbol)
  if (fundSet && fundSet.size && fundSet.has(key)) return true
  const flow = row.flow || ''
  const title = row.title || row.name || ''
  if (flow.includes('Ø¨ÙˆØ±Ø³ Ú©Ø§Ù„Ø§')) return false
  if (/Ø·Ù„Ø§|Ø³Ú©Ù‡|Ù†Ù‚Ø±Ù‡|Ø²Ø¹ÙØ±Ø§Ù†|Ø¯Ø±Ø¢Ù…Ø¯\s*Ø«Ø§Ø¨Øª|Ø§Ù…Ù„Ø§Ú©|Ù…Ø³ØªØºÙ„Ø§Øª/.test(title)) return false
  if (/(Ø³Ù‡Ø§Ù…ÛŒ|Ø¯Ø± Ø³Ù‡Ø§Ù…|Ø§Ù‡Ø±Ù…|Ø¨Ø®Ø´ÛŒ|Ø´Ø§Ø®ØµÛŒ|Ù…Ø®ØªÙ„Ø·)/.test(title)) return true
  return false
}

function isTopTradeCandidate(row, fundSet) {
  if (!row || !(row.tradeValue > 0)) return false
  const marketFa = row.marketFa || ''
  if (!marketFa || marketFa === 'Ø³Ù‡Ø§Ù…') return true
  return isEquityFundRow(row, fundSet)
}

function buildTopTradesFromBoard(rows, fundSet, limit = TOP_TRADES_LIMIT) {
  return (rows || [])
    .filter((s) => isTopTradeCandidate(s, fundSet))
    .sort((a, b) => (b.tradeValue || 0) - (a.tradeValue || 0))
    .slice(0, limit)
    .map((s) => ({
      name: s.symbol,
      valueBr: Math.round((s.tradeValue / RIAL_PER_BILLION_TOMAN) * 10) / 10,
    }))
}

function isBondLikeName(name) {
  const n = String(name || '').trim()
  if (!n) return true
  if (/^Ø§Ø±Ø§Ø¯\d*/i.test(n)) return true
  if (/^Ø§Ø®Ø²Ø§\d*/i.test(n)) return true
  if (/^Ø§Ø¬Ø§Ø±Ù‡/i.test(n)) return true
  if (/^Ù…Ø±Ø§Ø¨Ø­Ù‡/i.test(n)) return true
  if (/^ØµÚ©ÙˆÚ©/i.test(n)) return true
  if (/^ØªØ³Ù‡\d*/i.test(n)) return true
  if (/Ø§Ø®ØªÙŠØ§Ø±|Ø§Ø®ØªÛŒØ§Ø±/i.test(n)) return true
  if (/^Øµ[Ø§-ÛŒ]{2,}/.test(n) && /\d{2,}$/.test(n)) return true
  if (/\d{2,}$/.test(n) && /(?:Ø§Ø±Ø§Ø¯|ØµØ¨Ø§|Ø·Ø¨ÛŒØ¹Øª|Ø¢Ø³Ù…Ø§Ù†|Ø³Ø§Ù…Ø§Ù†|Ú¯Ø³ØªØ±|Ù‚Ø±Ù†)/.test(n)) return true
  return false
}

/**
 * Top trades from TradersArena main watch table (third table on homepage,
 * under Ø­Ù‚ÛŒÙ‚ÛŒ/Ø­Ù‚ÙˆÙ‚ÛŒ). Rows are [id, isin, name, volume, tradeValueRial, ...].
 * Sort by trade value â€” same order the site shows when sorted by Â«Ø§Ø±Ø²Ø´Â».
 */
async function fetchMainWatchTradeRows() {
  const res = await fetch(TA_MAINWATCH_SYMBOLS, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': UA,
      Referer: 'https://tradersarena.ir/',
    },
    signal: AbortSignal.timeout(UPSTREAM_MS),
  })
  if (!res.ok) throw new Error(`ta mainwatch symbols ${res.status}`)
  const rows = await res.json()
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => {
      if (!Array.isArray(r) || r.length < 5) return null
      const name = String(r[2] || '').trim()
      const tradeValue = Number(r[4])
      if (!name || !Number.isFinite(tradeValue) || tradeValue <= 0) return null
      if (isBondLikeName(name)) return null
      return {
        name,
        valueBr: Math.round((tradeValue / RIAL_PER_BILLION_TOMAN) * 10) / 10,
      }
    })
    .filter(Boolean)
}

async function buildLiveTopTrades(_fundSet) {
  const rows = await fetchMainWatchTradeRows()
  const byKey = new Map()
  for (const row of rows) {
    const key = normalizeSymbolKey(row.name)
    const prev = byKey.get(key)
    if (!prev || row.valueBr > prev.valueBr) byKey.set(key, row)
  }
  const top = [...byKey.values()].sort((a, b) => b.valueBr - a.valueBr).slice(0, TOP_TRADES_LIMIT)
  return {
    topTrades: top.map(({ name, valueBr }) => ({ name, valueBr })),
    topTradesSource: top.length ? 'tradersarena-mainwatch-symbols' : null,
  }
}

/** Dedicated scrape ordered by trade value: Ø³Ù‡Ø§Ù… + ØµÙ†Ø¯ÙˆÙ‚ (filtered later). */
function computeBoardImpacts(stocks, indices, maxMove = 0.22) {
  const equities = stocks.filter((s) => !s.marketFa || s.marketFa === 'Ø³Ù‡Ø§Ù…')
  const bourse = equities.filter((s) => !(s.flow || '').includes('ÙØ±Ø§Ø¨ÙˆØ±Ø³'))
  const ifb = equities.filter((s) => (s.flow || '').includes('ÙØ±Ø§Ø¨ÙˆØ±Ø³'))
  const indexB = indices?.tedpix?.value || 0
  const indexF = indices?.ifb?.value || 0
  const totalB = bourse.reduce((a, s) => a + (s.marketValue || 0), 0)
  const totalF = ifb.reduce((a, s) => a + (s.marketValue || 0), 0)

  /**
   * Index effects are a closing-price measure. Using last trade for IFB
   * distorted the rank mid-session (e.g. pushed ÙˆØ³Ù¾Ù‡Ø± above Ú©Ú¯Ù‡Ø±).
   */
  const build = (rows, index, total, preferLastTrade) => {
    if (!index || !total) return { pos: [], neg: [] }
    const items = []
    for (const s of rows) {
      const mv = s.marketValue || 0
      const yest = s.yesterday || 0
      let chg
      if (preferLastTrade) {
        chg = s.lastChg
        if (chg == null || chg === 0) chg = s.finalChg
        if (chg == null || chg === 0) chg = s.closeChg
      } else {
        chg = s.finalChg
        if (chg == null || chg === 0) chg = s.closeChg
        if (chg == null || chg === 0) chg = s.lastChg
      }
      if (!mv || !yest || chg == null) continue
      const move = chg / yest
      if (Math.abs(move) > maxMove) continue
      items.push({ symbol: s.symbol, impact: Math.round(index * (mv / total) * move * 10) / 10 })
    }
    return {
      pos: items.filter((x) => x.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, 5),
      neg:…3698 tokens truncated… = []
  if (rahavard?.ok) {
    out.boursePos = rahavard.boursePos || []
    out.bourseNeg = rahavard.bourseNeg || []
    sources.push('rahavard365')
  }
  // Rahavard's IFB endpoint returns price changes, not index-point effects.
  // Leave Farabourse slots to the board calculation below.
  if (arena?.impacts) {
    if (!out.boursePos.length) out.boursePos = arena.impacts.boursePos || []
    if (!out.bourseNeg.length) out.bourseNeg = arena.impacts.bourseNeg || []
    if (!out.ifbPos.length) out.ifbPos = arena.impacts.ifbPos || []
    if (!out.ifbNeg.length) out.ifbNeg = arena.impacts.ifbNeg || []
    sources.push('sourcearena')
  }
  // TSETMC is authoritative for IFB impact ordering and values.
  if (tsetmcIfb?.ok) {
    out.ifbPos = tsetmcIfb.ifbPos || []
    out.ifbNeg = tsetmcIfb.ifbNeg || []
    sources.push('tsetmc-ifb-effect')
  }
  if (board) {
    if (!out.boursePos.length) out.boursePos = board.boursePos || []
    if (!out.bourseNeg.length) out.bourseNeg = board.bourseNeg || []
    if (!out.ifbPos.length) out.ifbPos = board.ifbPos || []
    if (!out.ifbNeg.length) out.ifbNeg = board.ifbNeg || []
    sources.push('shakhesban-board')
  }
  const has = Object.values(out).some((arr) => arr.length > 0)
  return { impacts: has ? out : null, source: sources.join('+') || null }
}

const JALALI_MONTHS = {
  ÙØ±ÙˆØ±Ø¯ÛŒÙ†: 1,
  Ø§Ø±Ø¯ÛŒØ¨Ù‡Ø´Øª: 2,
  Ø®Ø±Ø¯Ø§Ø¯: 3,
  ØªÛŒØ±: 4,
  Ù…Ø±Ø¯Ø§Ø¯: 5,
  Ø´Ù‡Ø±ÛŒÙˆØ±: 6,
  Ù…Ù‡Ø±: 7,
  Ø¢Ø¨Ø§Ù†: 8,
  Ø¢Ø°Ø±: 9,
  Ø¯ÛŒ: 10,
  Ø¨Ù‡Ù…Ù†: 11,
  Ø§Ø³ÙÙ†Ø¯: 12,
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
    /^(\d{1,2})\s*(ÙØ±ÙˆØ±Ø¯ÛŒÙ†|Ø§Ø±Ø¯ÛŒØ¨Ù‡Ø´Øª|Ø®Ø±Ø¯Ø§Ø¯|ØªÛŒØ±|Ù…Ø±Ø¯Ø§Ø¯|Ø´Ù‡Ø±ÛŒÙˆØ±|Ù…Ù‡Ø±|Ø¢Ø¨Ø§Ù†|Ø¢Ø°Ø±|Ø¯ÛŒ|Ø¨Ù‡Ù…Ù†|Ø§Ø³ÙÙ†Ø¯)\s*(\d{4})$/,
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
  let m = text.match(/Ù…Ø¹Ø§Ù…Ù„Ø§Øª\s*#?Ø®Ø±Ø¯[\s\S]{0,80}?Ù…Ø¨Ù„Øº\s*([\d,]+)\s*Ù…ÛŒÙ„ÛŒØ§Ø±Ø¯/) || text.match(/Ù…Ø¨Ù„Øº\s*([\d,]+)\s*Ù…ÛŒÙ„ÛŒØ§Ø±Ø¯ ØªÙˆÙ…Ø§Ù† Ø¨ÙˆØ¯/)
  if (m) retail = parseNum(m[1])

  let totalTrades = null
  m = text.match(/Ø§Ø±Ø²Ø´ Ú©Ù„ Ù…Ø¹Ø§Ù…Ù„Ø§Øª Ø§Ù…Ø±ÙˆØ² Ø¨Ø§Ø²Ø§Ø±\s*([\d,]+)\s*Ù…ÛŒÙ„ÛŒØ§Ø±Ø¯/)
  if (m) totalTrades = parseNum(m[1])

  let flow = null
  m = text.match(/Ù…Ø¨Ù„Øº\s*([\d,]+)\s*Ù…ÛŒÙ„ÛŒØ§Ø±Ø¯ ØªÙˆÙ…Ø§Ù†\s*(ÙˆØ±ÙˆØ¯|Ø®Ø±ÙˆØ¬)\s*Ø­Ù‚ÛŒÙ‚ÛŒ/)
  if (m) {
    flow = parseNum(m[1])
    if (flow != null) flow = m[2] === 'Ø®Ø±ÙˆØ¬' ? -Math.abs(flow) : Math.abs(flow)
  }

  let dateJalaliRaw = null
  m = text.match(/Ù…ÙˆØ±Ø®\s*(\d{1,2}\s*[\u0600-\u06FF]+\s*\d{4}|\d{4}\/\d{2}\/\d{2})/)
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
  // Keep this cheap: sequential page probes previously took ~50s and made
  // /api/overview feel like the whole site was down on refresh.
  const home = await fetchText(PARSIS_HOME, 5000)
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
  const probe = new Set(seedIds.slice(0, 3))
  for (let i = newest; i > newest - 3 && i > 0; i--) probe.add(i)
  const ordered = [...probe].sort((a, b) => b - a).slice(0, 3)

  const settled = await Promise.allSettled(
    ordered.map(async (cidNum) => {
      const cid = String(cidNum)
      const url = `https://parsistahlil.ir/contents/${cid}-${slug}`
      const html = await fetchText(url, 4000)
      const row = parseParsistahlilHtml(html, cid, url)
      if (!row) throw new Error(`content ${cid} no numbers`)
      return row
    }),
  )
  for (const r of settled) {
    if (r.status === 'fulfilled') days.push(r.value)
    else lastErr = String(r.reason)
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

const OVERVIEW_CACHE_URL = 'https://pulse-cache.internal/midco-overview-v3'
const OVERVIEW_CACHE_TTL_MS = 45_000

export async function onRequestGet(context) {
  const cache = typeof caches !== 'undefined' ? caches.default : null
  if (cache) {
    try {
      const hit = await cache.match(OVERVIEW_CACHE_URL)
      if (hit) {
        const cachedAt = Number(hit.headers.get('x-overview-cached-at') || 0)
        if (cachedAt && Date.now() - cachedAt < OVERVIEW_CACHE_TTL_MS) {
          const headers = new Headers(hit.headers)
          headers.set('x-overview-cache', 'HIT')
          headers.set('Access-Control-Allow-Origin', '*')
          return new Response(hit.body, { status: 200, headers })
        }
      }
    } catch {
      /* ignore cache read errors */
    }
  }

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
    scrapeRahavardImpacts(),
    scrapeShakhesbanBoardLite(4),
    fetchJson(`${origin}/data/market_pulse.json`).catch(() => null),
    fetchJson(`${origin}/data/impacts_cache.json`).catch(() => null),
    fetchTradersArenaPulse(),
    fetchJson(`${origin}/data/market.json`).catch(() => null),
    fetchEquityFundSymbolSet(),
    scrapeRahavardIfbMovers(),
    fetchTsetmcMarketSummary(),
    fetchTsetmcIfbEffects(),
  ])

  if (tasks[0].status === 'fulfilled') {
    const current = tasks[0].value.current || {}
    quotes = {
      bourse: tgjuQuote(current.bourse, 'bourse', 'Ø´Ø§Ø®Øµ Ú©Ù„ Ø¨ÙˆØ±Ø³'),
      price_dollar_rl: tgjuQuote(current.price_dollar_rl, 'price_dollar_rl', 'Ø¯Ù„Ø§Ø± Ø¢Ø²Ø§Ø¯'),
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

  let rahavard = { ok: false }
  if (tasks[6].status === 'fulfilled') {
    rahavard = tasks[6].value
    if (!rahavard.ok) errors.push(`rahavard: ${rahavard.error || 'empty'}`)
  } else {
    errors.push(`rahavard: ${tasks[6].reason}`)
  }

  let rahavardIfb = { ok: false }
  if (tasks[13].status === 'fulfilled') {
    rahavardIfb = tasks[13].value
    if (!rahavardIfb.ok) errors.push(`rahavard-ifb: ${rahavardIfb.error || 'empty'}`)
  } else if (tasks[13].status === 'rejected') {
    errors.push(`rahavard-ifb: ${tasks[13].reason}`)
  }

  let tsetmcSummary = { ok: false }
  if (tasks[14].status === 'fulfilled') {
    tsetmcSummary = tasks[14].value
  } else if (tasks[14].status === 'rejected') {
    errors.push(`tsetmc-overview: ${tasks[14].reason}`)
  }

  let tsetmcIfb = { ok: false }
  if (tasks[15].status === 'fulfilled') {
    tsetmcIfb = tasks[15].value
  } else if (tasks[15].status === 'rejected') {
    errors.push(`tsetmc-ifb-effects: ${tasks[15].reason}`)
  }

  let boardRows = []
  if (tasks[7].status === 'fulfilled') {
    boardRows = tasks[7].value || []
  } else {
    errors.push(`shakhesban-board: ${tasks[7].reason}`)
  }

  const pulseStoreStatic = tasks[8].status === 'fulfilled' ? tasks[8].value : null
  const impactsCache = tasks[9].status === 'fulfilled' ? tasks[9].value : null

  let tradersPulse = null
  if (tasks[10].status === 'fulfilled') {
    tradersPulse = tasks[10].value
  } else {
    errors.push(`tradersarena: ${tasks[10].reason}`)
  }

  const marketJson = tasks[11].status === 'fulfilled' ? tasks[11].value : null
  const staticLive = marketJson?.overviewLive || null

  let equityFundSet = new Set()
  if (tasks[12].status === 'fulfilled' && tasks[12].value) {
    equityFundSet = tasks[12].value
  } else if (tasks[12].status === 'rejected') {
    errors.push(`equity-funds: ${tasks[12].reason}`)
  }

  let topTrades = []
  let topTradesSource = null
  try {
    const liveTop = await buildLiveTopTrades(equityFundSet)
    topTrades = liveTop.topTrades || []
    topTradesSource = liveTop.topTradesSource
  } catch (e) {
    errors.push(`top-trades: ${e}`)
    // last-resort: board equities only (may be stale/wrong â€” better than empty)
    const fallbackRows = boardRows.filter((s) => (!s.marketFa || s.marketFa === 'Ø³Ù‡Ø§Ù…') && s.tradeValue > 0)
    topTrades = buildTopTradesFromBoard(fallbackRows, equityFundSet, TOP_TRADES_LIMIT)
    topTradesSource = topTrades.length ? 'shakhesban-board-fallback' : null
  }

  const boardImpacts = boardRows.length ? computeBoardImpacts(boardRows, indices) : null
  const mergedImpacts = mergeImpacts(rahavard, boardImpacts, sourcearena, tsetmcIfb)
  // fill gaps from deployed cache
  if (mergedImpacts.impacts && impactsCache) {
    for (const k of ['boursePos', 'bourseNeg', 'ifbPos', 'ifbNeg']) {
      if (!mergedImpacts.impacts[k]?.length && impactsCache[k]?.length) {
        mergedImpacts.impacts[k] = impactsCache[k]
        mergedImpacts.source = `${mergedImpacts.source || ''}+cache`.replace(/^\+/, '')
      }
    }
  }

  const today = jalaliToday()
  if (sourcearena?.ok) await saveSaGlanceCache(cache, sourcearena, today.dateJalali)
  const saCache = sourcearena?.ok ? null : await loadSaGlanceCache(cache)
  const boardStats = computeBoardMarketStats(boardRows)

  let pulseStore = await loadPulseStore(cache, pulseStoreStatic)
  const marketPulse =
    tradersPulse ||
    (boardRows.length ? buildMarketPulseFallback(boardRows) : null) ||
    pulseStore?.current ||
    null
  if (marketPulse) {
    pulseStore = mergePulseHistory(pulseStore, marketPulse)
    await savePulseStore(cache, pulseStore)
  }
  const marketPulseHistory = Array.isArray(pulseStore?.history) ? pulseStore.history : []

  // topTrades already resolved above via TradersArena market-values + Rahavard equity funds

  const merged = mergeMoneyFlowStore(moneyFlowStore, parsistahlil.days || [])
  moneyFlowStore = merged.store

  const usd = quotes.price_dollar_rl?.value ?? null
  const taIndices = tradersPulse?.indices || {}
  const tedpix = taIndices.tedpix || indices.tedpix || (quotes.bourse
    ? {
        name: quotes.bourse.name,
        value: quotes.bourse.value,
        change: quotes.bourse.change,
        changePct: quotes.bourse.changePct,
        source: 'tgju',
      }
    : null)

  let marketStats = resolveMarketStats({
    sourcearena,
    boardStats,
    tradersPulse: marketPulse,
    saCache,
    staticLive,
    usd,
    todayJalali: today.dateJalali,
    todayGregorian: today.dateGregorian,
    tedpixChangePct: tedpix?.changePct,
    ifbChangePct: indices?.ifb?.changePct,
  })
  // Official TSETMC values take priority for market capitalization. TradersArena
  // remains the primary display source for TEDPIX and equal-weight index.
  if (tsetmcSummary?.ok) {
    const bMv = tsetmcSummary.bourseMarketValueHmt
    const fMv = tsetmcSummary.ifbMarketValueHmt
    const totalMv = bMv != null && fMv != null ? Math.round((bMv + fMv) * 10) / 10 : bMv ?? fMv
    if (totalMv != null) {
      marketStats = {
        ...marketStats,
        bourseMarketValueHmt: bMv,
        ifbMarketValueHmt: fMv,
        totalMarketValueHmt: totalMv,
        totalMarketValueUsdM: usd > 0 ? Math.round((totalMv * RIAL_PER_HEMAT) / usd / 1e6) : null,
        marketValueSource: 'tsetmc-official-bourse+ifb',
      }
    }
  }

  const blocked = [
    ...(sourcearena.ok ? [] : ['sourcearena']),
    ...(parsistahlil.ok ? [] : ['parsistahlil']),
    ...(rahavard.ok ? [] : ['rahavard365']),
  ]

  const body = {
    ok: true,
    updatedAt: new Date().toISOString(),
    dateJalali: today.dateJalali,
    dateGregorian: today.dateGregorian,
    quotes,
    indices: {
      tedpix,
      equalWeight: taIndices.equalWeight || indices.equalWeight || null,
      ifb:
        tsetmcSummary?.ifb?.index != null
          ? {
              name: 'Ø´Ø§Ø®Øµ Ú©Ù„ ÙØ±Ø§Ø¨ÙˆØ±Ø³',
              value: tsetmcSummary.ifb.index,
              change: tsetmcSummary.ifb.indexChange || 0,
              changePct:
                tsetmcSummary.ifb.indexChange != null && tsetmcSummary.ifb.index
                  ? Math.round((tsetmcSummary.ifb.indexChange / (tsetmcSummary.ifb.index - tsetmcSummary.ifb.indexChange)) * 10000) / 100
                  : 0,
              source: 'tsetmc-official',
            }
          : indices.ifb || null,
    },
    intraday: {
      source: 'tgju-today-table',
      note: 'Ù…Ø³ÛŒØ± Ø±ÙˆØ²Ø§Ù†Ù‡ TGJU (Ø±Ø²ÙˆÙ„ÙˆØ´Ù† Ú†Ù†Ø¯Ø¯Ù‚ÛŒÙ‚Ù‡â€ŒØ§ÛŒ).',
      points: intraday,
    },
    sourcearena,
    rahavard,
    bourseMarketValueHmt: marketStats.bourseMarketValueHmt,
    ifbMarketValueHmt: marketStats.ifbMarketValueHmt,
    totalMarketValueHmt: marketStats.totalMarketValueHmt,
    totalMarketValueUsdM: marketStats.totalMarketValueUsdM,
    marketValueSource: marketStats.marketValueSource,
    totalTradeValueHmt: marketStats.totalTradeValueHmt,
    totalTradeValueSource: marketStats.totalTradeValueSource,
    impacts: mergedImpacts.impacts,
    impactsFromSourceArena: Boolean(mergedImpacts.source?.includes('sourcearena')),
    impactsFromRahavard: Boolean(mergedImpacts.source?.includes('rahavard')),
    impactsSource: mergedImpacts.source,
    topTrades,
    topTradesSource,
    marketPulse,
    marketPulseHistory,
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
  }

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    'Access-Control-Allow-Origin': '*',
    'x-overview-cache': 'MISS',
    'x-overview-cached-at': String(Date.now()),
  }
  const response = new Response(JSON.stringify(body), { status: 200, headers })
  if (cache) {
    try {
      await cache.put(OVERVIEW_CACHE_URL, response.clone())
    } catch {
      /* ignore */
    }
  }
  return response
}

