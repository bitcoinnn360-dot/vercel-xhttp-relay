/**
 * Cloudflare Pages Function: steel-chain live snapshot.
 * Custeel (login or cookie) + IME offer-stat (Iran IP often required).
 *
 * Secrets:
 *   CUSTEEL_USER + CUSTEEL_PASS
 *   or CUSTEEL_COOKIE=`JSESSIONID=…`
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const CUSTEEL_LOGIN =
  'http://www.custeel.net/sec/dgserverlet?classname=login.LoginCtrl&method=loginInUiHomeByXmlHttp&ENG=yes'
const CUSTEEL_PRICE = 'http://www.custeel.net/luliao/price_center_image_en.jsp'
const CUSTEEL_INDICATORS = 'http://www.custeel.com/reform/title/indexup_en.html'
const IME_URL =
  'https://www.ime.co.ir/subsystems/ime/services/home/imedata.asmx/GetAmareMoamelatList'

const SERIES = {
  pb61: {
    code: '001005001001008',
    nameFa: 'نرمه استرالیا PB ۶۱.۵٪ FOB',
    region: 'global',
    currency: 'usd',
    basis: 'FOB',
    unit: 'دلار/تن FOB',
  },
  brbf: {
    code: '001005001001005',
    nameFa: 'نرمه کاراجاس برزیل ۶۵٪ FOB',
    region: 'global',
    currency: 'usd',
    basis: 'FOB',
    unit: 'دلار/تن FOB',
  },
  br_pellet: {
    code: '001005001001007',
    nameFa: 'گندله برزیل ۶۵٪ FOB',
    region: 'global',
    currency: 'usd',
    basis: 'FOB',
    unit: 'دلار/تن FOB',
  },
  tangshan_billet: {
    code: '001002001001001',
    nameFa: 'بیلت تانگشان',
    region: 'china',
    currency: 'cny',
    basis: 'market',
    unit: 'دلار/تن',
  },
  hr_shanghai: {
    code: '001001001001005031',
    nameFa: 'ورق گرم شانگهای',
    region: 'china',
    currency: 'cny',
    basis: 'market',
    unit: 'دلار/تن',
  },
  rebar_beijing: {
    code: '001001001001002075',
    nameFa: 'میلگرد تانگشان',
    region: 'china',
    currency: 'cny',
    basis: 'market',
    unit: 'دلار/تن',
  },
}

const IME_PRODUCTS = [
  { id: 'ime_hr', product: 'ورق گرم (مبارکه)', keywords: ['ورق گرم', 'گرم نورد'], prefer: ['مبارکه'] },
  { id: 'ime_rebar', product: 'میلگرد متوسط', keywords: ['میلگرد'], prefer: [] },
  { id: 'ime_billet', product: 'بیلت (میانگین شمش)', keywords: ['شمش', 'بیلت'], prefer: ['بلوم'] },
  { id: 'ime_dri', product: 'آهن اسفنجی', keywords: ['اسفنجی'], prefer: [] },
  { id: 'ime_pellet', product: 'گندله', keywords: ['گندله'], prefer: [] },
  { id: 'ime_conc', product: 'کنسانتره', keywords: ['کنسانتره'], prefer: [] },
  {
    id: 'ime_ore',
    product: 'سنگ آهن دانه‌بندی ۶۰٪',
    keywords: ['دانه‌بندی', 'دانه بندی', 'سنگ آهن'],
    prefer: ['دانه‌بندی', 'دانه بندی'],
  },
]

function num(x) {
  if (x == null) return null
  if (typeof x === 'number') return Number.isFinite(x) ? x : null
  const s = String(x).replace(/[,٬%]/g, '').trim()
  if (!s || s === '-' || s === '—') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

function cookieFromSetCookie(setCookieHeaders) {
  if (!setCookieHeaders) return ''
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]
  return list
    .map((h) => String(h).split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

async function fetchCnyUsd() {
  try {
    const res = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json',
      { headers: { 'User-Agent': UA } },
    )
    if (res.ok) {
      const j = await res.json()
      const v = num(j?.cny?.usd)
      if (v > 0) return v
    }
  } catch {
    /* ignore */
  }
  return 0.139
}

async function fetchUsdIrr() {
  try {
    const res = await fetch('https://call2.tgju.org/ajax.json', { headers: { 'User-Agent': UA } })
    if (!res.ok) return null
    const j = await res.json()
    return num(j?.current?.price_dollar_rl?.p)
  } catch {
    return null
  }
}

async function custeelSession(env) {
  const cookieSecret = String(env?.CUSTEEL_COOKIE || '').trim()
  if (cookieSecret) return cookieSecret

  const user = String(env?.CUSTEEL_USER || '').trim()
  const pass = String(env?.CUSTEEL_PASS || '').trim()
  if (!user || !pass) return ''

  const url = `${CUSTEEL_LOGIN}&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, Referer: 'http://www.custeel.net/en/' },
    body: '',
  })
  const text = (await res.text()).trim()
  if (text !== '0') throw new Error(`custeel login ${text || res.status}`)
  return cookieFromSetCookie(res.headers.getSetCookie?.() || res.headers.get('set-cookie'))
}

function parsePriceHtml(raw) {
  const parts = String(raw).split('|')
  const title = (parts[3] || '').replace(/<[^>]+>/g, '').trim()
  const table = parts[2] || ''
  const pts = []
  const trs = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []
  for (const tr of trs) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    )
    if (cells.length < 2 || cells[0].toLowerCase() === 'date') continue
    const v = num(cells[1])
    if (cells[0] && v != null) pts.push({ date: cells[0].slice(0, 10), value: v })
  }
  pts.reverse()
  return { title, pts }
}

async function scrapeCusteel(cookie, cnyUsd) {
  const steel = []
  const histories = {}
  let ok = 0
  for (const [sid, meta] of Object.entries(SERIES)) {
    const body = new URLSearchParams({
      table: meta.code,
      typeNum: '1',
      quanxian: 'true',
    })
    const res = await fetch(CUSTEEL_PRICE, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: cookie,
        Referer: 'http://www.custeel.net/luliao/price_center_en.jsp',
        Origin: 'http://www.custeel.net',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
    })
    if (!res.ok) continue
    const { title, pts } = parsePriceHtml(await res.text())
    if (pts.length < 2) continue
    const last = pts[pts.length - 1]
    const prev = pts[pts.length - 2]
    const lastUsd = meta.currency === 'cny' ? +(last.value * cnyUsd).toFixed(2) : +last.value.toFixed(2)
    const prevUsd = meta.currency === 'cny' ? +(prev.value * cnyUsd).toFixed(2) : +prev.value.toFixed(2)
    const change = +(lastUsd - prevUsd).toFixed(3)
    const changePct = prevUsd ? +((change / prevUsd) * 100).toFixed(2) : 0
    steel.push({
      id: sid,
      name: title || sid,
      nameFa: meta.nameFa,
      value: lastUsd,
      unit: meta.unit || 'دلار/تن',
      change,
      changePct,
      region: meta.region,
      basis: meta.basis,
      asOf: last.date,
      source: 'custeel-price-center',
    })
    histories[sid] = pts.slice(-180).map((p) => ({
      date: p.date,
      value: meta.currency === 'cny' ? +(p.value * cnyUsd).toFixed(3) : +p.value.toFixed(3),
    }))
    ok += 1
  }
  return { steel, histories, ok }
}

function findIndicatorRow(rows, ...needles) {
  return rows.find((r) => {
    const j = r.join(' ').toLowerCase()
    return needles.every((n) => j.includes(n.toLowerCase()))
  })
}

const CUSTEEL_HOME = 'http://www.custeel.net/en/'

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function parseEnglishDate(text) {
  const m = String(text || '').match(/\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/)
  if (!m) return null
  const mon = MONTHS[m[1].slice(0, 3).toLowerCase()]
  if (!mon) return null
  return `${m[3]}-${String(mon).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
}

function articlePlain(html) {
  return String(html || '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
}

async function scrapeTangshanBf(cookie) {
  const homeRes = await fetch(CUSTEEL_HOME, {
    headers: { 'User-Agent': UA, Cookie: cookie || '' },
  })
  if (!homeRes.ok) return { ok: false }
  const home = await homeRes.text()
  const links = [...home.matchAll(/href="(viewDetail\.do\?flag=3&id=\d+)"[^>]*>\s*([^<]*BF Operating Rate in Tangshan[^<]*)/gi)]
  if (!links.length) return { ok: false, error: 'no BF links' }
  const href = links[0][1]
  const url = href.startsWith('http') ? href : `http://www.custeel.net/en/${href}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie || '' } })
  if (!res.ok) return { ok: false }
  const text = articlePlain(await res.text())
  const sess = text.match(/session ending\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i)
  const asOf = sess ? parseEnglishDate(sess[1]) : null
  const pub = text.match(/(20\d{2}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}/)
  const mNum = text.match(
    /operating rate by number of blast furnaces was\s*([\d.]+)\s*%(.{0,80})/i,
  )
  const mCap = text.match(/leading to an operating rate of\s*([\d.]+)\s*%/i)
  if (!mNum) return { ok: false, error: 'bf rate missing' }
  const rate = num(mNum[1])
  const tail = mNum[2] || ''
  let wow = 0
  const down = tail.match(/(?:falling|down|declining)\s+by\s*([\d.]+)\s*%/i)
  const up = tail.match(/(?:rising|up|gaining)\s+by\s*([\d.]+)\s*%/i)
  if (down) wow = -Math.abs(Number(down[1]))
  else if (up) wow = Math.abs(Number(up[1]))
  return {
    ok: true,
    rate,
    wowChangePct: wow,
    capacityRate: mCap ? num(mCap[1]) : null,
    asOf: asOf || (pub ? pub[1] : null),
    published: pub ? pub[1] : null,
    source: 'custeel-tangshan-bf-article',
    note: 'by number of blast furnaces; asOf=session ending',
  }
}

async function scrapeOrePortStocks(cookie) {
  const homeRes = await fetch(CUSTEEL_HOME, {
    headers: { 'User-Agent': UA, Cookie: cookie || '' },
  })
  if (!homeRes.ok) return { ok: false }
  const home = await homeRes.text()
  const links = [...home.matchAll(/href="(viewDetail\.do\?flag=3&id=\d+)"[^>]*>\s*([^<]*Iron Ore in Stock of Major[^<]*)/gi)]
  if (!links.length) return { ok: false }
  const href = links[0][1]
  const title = links[0][2]
  const url = href.startsWith('http') ? href : `http://www.custeel.net/en/${href}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie || '' } })
  if (!res.ok) return { ok: false }
  const html = await res.text()
  const upd = `${title} ${html}`.match(/Update:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i)
  const asOf = upd ? parseEnglishDate(upd[1]) : null
  let total = null
  let wow = 0
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    ).filter(Boolean)
    if (cells[0]?.toLowerCase() === 'total' && cells.length >= 3) {
      total = num(cells[1])
      wow = num(cells[2]) || 0
      break
    }
  }
  if (total == null) return { ok: false }
  return {
    ok: true,
    label: 'موجودی انبار سنگ‌آهن بنادر چین',
    value: total,
    wowChange: wow,
    unit: 'هزار تن',
    asOf,
    source: 'custeel-port-stocks-article',
  }
}

async function scrapeIndicators(cookie) {
  const res = await fetch(CUSTEEL_INDICATORS, {
    headers: { 'User-Agent': UA, Cookie: cookie || '' },
  })
  if (!res.ok) return { ok: false }
  const html = await res.text()
  const rows = []
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    )
    if (cells.length) rows.push(cells)
  }
  const steelExtra = []
  const sea = findIndicatorRow(rows, 'seaborne', '62')
  const port = findIndicatorRow(rows, 'portside', '62')
  const bil = findIndicatorRow(rows, 'tangshan billet stocks')

  if (sea) {
    const v = num(sea[1])
    const ch = num(sea[2]) || 0
    if (v != null)
      steelExtra.push({
        id: 'seaborne62',
        name: 'CSI Seaborne Fe62%',
        nameFa: 'شاخص سنگ‌آهن دریایی ۶۲٪ (CSI)',
        value: v,
        unit: 'دلار/تن',
        change: ch,
        changePct: v - ch ? +((ch / (v - ch)) * 100).toFixed(2) : 0,
        region: 'global',
        basis: 'index',
        source: 'custeel-indicator',
      })
  }
  if (port) {
    const v = num(port[1])
    const ch = num(port[2]) || 0
    if (v != null)
      steelExtra.push({
        id: 'portside62',
        name: 'CSI Portside Fe62%',
        nameFa: 'شاخص سنگ‌آهن بندری ۶۲٪',
        value: v,
        unit: 'دلار/تن',
        change: ch,
        changePct: v - ch ? +((ch / (v - ch)) * 100).toFixed(2) : 0,
        region: 'china',
        basis: 'portside',
        source: 'custeel-indicator',
      })
  }

  let billetStocks = null
  if (bil) {
    const v = num(bil[1])
    const ch = num(bil[2]) || 0
    if (v != null)
      billetStocks = {
        label: 'موجودی بیلت تانگشان',
        value: v,
        wowChange: ch,
        unit: 'هزار تن',
        source: 'custeel-indicator',
      }
  }

  const [bf, ore] = await Promise.all([scrapeTangshanBf(cookie), scrapeOrePortStocks(cookie)])
  return {
    ok: true,
    steelExtra,
    inventories: ore.ok
      ? {
          label: ore.label,
          value: ore.value,
          wowChange: ore.wowChange,
          unit: ore.unit,
          asOf: ore.asOf,
          source: ore.source,
        }
      : null,
    bfRate: bf.ok
      ? {
          rate: bf.rate,
          wowChangePct: bf.wowChangePct,
          capacityRate: bf.capacityRate,
          asOf: bf.asOf,
          published: bf.published,
          source: bf.source,
          note: bf.note,
        }
      : null,
    billetStocks,
  }
}

function jalaliToday() {
  // Approx via Intl persian calendar
  try {
    const fmt = new Intl.DateTimeFormat('en-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
    return `${parts.year}/${parts.month}/${parts.day}`
  } catch {
    return '1405/01/01'
  }
}

function jalaliMinusDays(n) {
  const d = new Date(Date.now() - n * 86400000)
  try {
    const fmt = new Intl.DateTimeFormat('en-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
    return `${parts.year}/${parts.month}/${parts.day}`
  } catch {
    return jalaliToday()
  }
}

async function scrapeIme(usdIrr) {
  const end = jalaliToday()
  const start = jalaliMinusDays(21)
  const payload = {
    Language: 8,
    fari: false,
    GregorianFromDate: start,
    GregorianToDate: end,
    MainCat: 0,
    Cat: 0,
    SubCat: 0,
    Producer: 0,
  }
  const res = await fetch(IME_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*; q=0.01',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: 'https://www.ime.co.ir',
      Referer: 'https://www.ime.co.ir/offer-stat.html',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`ime ${res.status}`)
  const data = await res.json()
  const raw = data?.d ?? '[]'
  const records = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!Array.isArray(records)) throw new Error('ime shape')

  const normed = []
  for (const row of records) {
    if (!row || typeof row !== 'object') continue
    const goods = String(row.GoodsName || row.bArzehNameKala || row.goodsName || '')
    const symbol = String(row.Symbol || row.bArzehRadifNamad || row.symbol || '')
    const producer = String(row.ProducerName || row.producerName || '')
    const close = num(row.ClosePrice || row.bArzehRadifGheymat || row.closePrice)
    const date = String(row.Date || row.bArzehTarSal || row.date || '')
      .replace(/-/g, '/')
      .slice(0, 10)
    if (close == null || close <= 0) continue
    normed.push({ goods, symbol, producer, close, date })
  }
  if (!normed.length) throw new Error('ime empty')

  const chain = []
  const steel = []
  for (const spec of IME_PRODUCTS) {
    let hits = normed.filter((r) => {
      const blob = `${r.goods} ${r.symbol} ${r.producer}`
      return spec.keywords.some((k) => blob.includes(k))
    })
    if (spec.prefer?.length) {
      const pref = hits.filter((r) => spec.prefer.some((p) => `${r.goods} ${r.producer}`.includes(p)))
      if (pref.length) hits = pref
    }
    if (!hits.length) continue
    hits.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    const latest = hits[0].date
    const day = hits.filter((r) => r.date === latest)
    const avg = day.reduce((a, r) => a + r.close, 0) / day.length
    chain.push({
      product: spec.product,
      priceRialKg: Math.round(avg),
      ratioToBilletPct: 0,
      tradeDate: latest,
      source: 'ime-offer-stat',
      samples: day.length,
    })
    if (usdIrr > 0) {
      steel.push({
        id: spec.id,
        name: spec.product,
        nameFa: spec.product.replace(' (مبارکه)', '').replace(' (میانگین شمش)', ''),
        value: +((avg * 1000) / usdIrr).toFixed(2),
        unit: 'دلار/تن',
        change: 0,
        changePct: 0,
        region: 'iran',
        asOf: latest,
        source: 'ime-offer-stat',
      })
    }
  }
  const billet = chain.find((c) => c.product.startsWith('بیلت'))
  if (billet?.priceRialKg) {
    for (const c of chain) c.ratioToBilletPct = +((c.priceRialKg / billet.priceRialKg) * 100).toFixed(1)
  }
  const order = IME_PRODUCTS.map((p) => p.product)
  chain.sort((a, b) => order.indexOf(a.product) - order.indexOf(b.product))
  return { ok: true, imeChain: chain, steel, from: start, to: end, tradeCount: normed.length }
}

function mergeSteel(...lists) {
  const by = new Map()
  for (const list of lists) {
    for (const row of list || []) if (row?.id) by.set(row.id, row)
  }
  const preferred = [
    'seaborne62',
    'portside62',
    'pb61',
    'brbf',
    'br_pellet',
    'ime_ore',
    'ime_conc',
    'ime_pellet',
    'ime_dri',
    'tangshan_billet',
    'ime_billet',
    'hr_shanghai',
    'ime_hr',
    'rebar_beijing',
    'ime_rebar',
  ]
  const out = []
  const seen = new Set()
  for (const id of preferred) {
    if (by.has(id)) {
      out.push(by.get(id))
      seen.add(id)
    }
  }
  for (const [id, row] of by) if (!seen.has(id)) out.push(row)
  return out
}

export async function onRequestGet(context) {
  const { env, request } = context
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=120',
    'access-control-allow-origin': '*',
  }

  try {
    const cnyUsd = await fetchCnyUsd()
    const usdIrr = await fetchUsdIrr()
    let cookie = ''
    let custeelErr = null
    try {
      cookie = await custeelSession(env)
    } catch (e) {
      custeelErr = String(e?.message || e)
    }

    let series = { steel: [], histories: {}, ok: 0 }
    let indicators = { ok: false }
    if (cookie) {
      try {
        indicators = await scrapeIndicators(cookie)
        series = await scrapeCusteel(cookie, cnyUsd)
      } catch (e) {
        custeelErr = String(e?.message || e)
      }
    } else if (!custeelErr) {
      custeelErr = 'missing CUSTEEL_USER/PASS or CUSTEEL_COOKIE'
    }

    let ime = { ok: false }
    try {
      ime = await scrapeIme(usdIrr)
    } catch (e) {
      ime = { ok: false, error: String(e?.message || e) }
    }

    // Fallback to static bundle when live thin
    let staticBundle = null
    try {
      const origin = new URL(request.url).origin
      const sres = await fetch(`${origin}/data/steel_chain.json`, { cf: { cacheTtl: 60 } })
      if (sres.ok) staticBundle = await sres.json()
    } catch {
      /* ignore */
    }

    const steel = mergeSteel(
      series.steel,
      indicators.steelExtra,
      ime.steel,
      !series.ok && staticBundle?.steel ? staticBundle.steel : [],
    )
    const imeChain = ime.ok ? ime.imeChain : staticBundle?.imeChain || []
    const custeelOk = series.ok > 0
    const payload = {
      ok: custeelOk || ime.ok || Boolean(staticBundle?.ok),
      updatedAt: new Date().toISOString(),
      custeelOk,
      imeOk: Boolean(ime.ok),
      custeelError: custeelErr,
      imeError: ime.error || null,
      cnyUsd,
      usdIrr,
      steel,
      imeChain,
      inventories: indicators.inventories || staticBundle?.inventories || null,
      bfRate: indicators.bfRate || staticBundle?.bfRate || null,
      billetStocks: indicators.billetStocks || staticBundle?.billetStocks || null,
      histories: Object.keys(series.histories || {}).length
        ? series.histories
        : staticBundle?.histories || {},
      source: custeelOk && ime.ok ? 'custeel+ime' : custeelOk ? 'custeel' : ime.ok ? 'ime' : 'static',
      imeMeta: ime.ok ? { from: ime.from, to: ime.to, tradeCount: ime.tradeCount } : null,
    }
    return new Response(JSON.stringify(payload), { headers })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers,
    })
  }
}
