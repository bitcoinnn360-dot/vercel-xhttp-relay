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
  'https://www.custeel.net/sec/dgserverlet?classname=login.LoginCtrl&method=loginInUiHomeByXmlHttp&ENG=yes'
const CUSTEEL_INDICATORS = 'https://www.custeel.com/reform/title/indexup_en.html'
const IME_URL =
  'https://www.ime.co.ir/subsystems/ime/services/home/imedata.asmx/GetAmareMoamelatList'

/** Seaborne FOB from country articles — not price-center CFR/外盘. */
const FOB_SERIES = {
  pb61: {
    country: 'Australia',
    desc: ['pb fines'],
    grade: '61.5',
    name: 'Australian PB fines 61.5% FOB',
    nameFa: 'نرمه استرالیا PB ۶۱.۵٪ FOB',
    region: 'global',
    unit: 'دلار/تن FOB',
  },
  brbf: {
    country: 'Brazil',
    desc: ['brbf'],
    grade: '62.5',
    name: 'Brazilian BRBF fines 62.5% FOB',
    nameFa: 'نرمه BRBF برزیل ۶۲.۵٪ FOB',
    region: 'global',
    unit: 'دلار/تن FOB',
  },
  br_pellet: {
    country: 'Brazil',
    desc: ['brazilian pellets', 'pellets'],
    grade: '65',
    name: 'Brazilian pellets 65% FOB',
    nameFa: 'گندله برزیل ۶۵٪ FOB',
    region: 'global',
    unit: 'دلار/تن FOB',
  },
  iran_conc: {
    country: 'Iran',
    desc: ['iranian concentrates', 'concentrates'],
    grade: '67',
    name: 'Iranian concentrates 67% FOB',
    nameFa: 'کنسانتره ایران ۶۷٪ FOB',
    region: 'iran',
    unit: 'دلار/تن FOB',
  },
  iran_hem: {
    country: 'Iran',
    desc: ['iranian hematite', 'hematite'],
    grade: '62',
    name: 'Iranian hematite fines 62% FOB',
    nameFa: 'هماتیت ایران ۶۲٪ FOB',
    region: 'iran',
    unit: 'دلار/تن FOB',
  },
  chile_conc: {
    country: 'Chile',
    desc: ['chilean concentrates', 'concentrates'],
    grade: '67',
    name: 'Chilean concentrates 67% FOB',
    nameFa: 'کنسانتره شیلی ۶۷٪ FOB',
    region: 'global',
    unit: 'دلار/تن FOB',
  },
}

const DOMESTIC_META = {
  rebar_beijing: { name: 'Beijing Rebar 16mm HRB400E', nameFa: 'میلگرد پکن ۱۶ میل', region: 'china' },
  hr_shanghai: { name: 'Shanghai HRC 3.0×1500 Q235B', nameFa: 'ورق گرم شانگهای', region: 'china' },
  tangshan_billet: { name: 'Tangshan Billet 150×150', nameFa: 'بیلت تانگشان', region: 'china' },
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
  if (cookieSecret) return cookieSecret.includes('=') ? cookieSecret : `JSESSIONID=${cookieSecret}`

  const user = String(env?.CUSTEEL_USER || '').trim()
  const pass = String(env?.CUSTEEL_PASS || '').trim()
  if (!user || !pass) return ''

  const url = `${CUSTEEL_LOGIN}&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`

  const tryLogin = async (warmCookie) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Referer: 'https://www.custeel.net/en/',
        Origin: 'https://www.custeel.net',
        ...(warmCookie ? { Cookie: warmCookie } : {}),
      },
      body: '',
      redirect: 'follow',
    })
    const text = (await res.text()).trim()
    if (text !== '0') throw new Error(`custeel login ${text || res.status}`)
    const loginCookie = cookieFromSetCookie(res.headers.getSetCookie?.() || res.headers.get('set-cookie'))
    return loginCookie || warmCookie || ''
  }

  // Prefer direct login (usually returns JSESSIONID). Warm home only as fallback.
  try {
    const cookie = await tryLogin('')
    if (cookie) return cookie
  } catch {
    /* try warm path */
  }

  let warmCookie = ''
  try {
    const home = await Promise.race([
      fetch('https://www.custeel.net/en/', {
        headers: { 'User-Agent': UA, Referer: 'https://www.custeel.net/' },
        redirect: 'follow',
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('warm timeout')), 2500)),
    ])
    warmCookie = cookieFromSetCookie(home.headers.getSetCookie?.() || home.headers.get('set-cookie'))
  } catch {
    /* continue */
  }
  return tryLogin(warmCookie)
}

function tableRows(html) {
  const rows = []
  for (const tr of String(html).match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (cells.length) rows.push(cells)
  }
  return rows
}

function articleTitle(html) {
  const m = String(html).match(/formatTitle\("([^"]+)"/)
  return m ? m[1] : ''
}

function absCusteel(href) {
  if (!href) return ''
  if (href.startsWith('http')) return href
  return `https://www.custeel.net/en/${href.replace(/^\//, '')}`
}

function listLinks(html, flag, limit = 8) {
  const out = []
  const seen = new Set()
  for (const m of String(html).matchAll(/href="(viewDetail\.do\?flag=(\d+)&id=[^"]+)"[^>]*>([^<]+)/gi)) {
    const href = m[1]
    const fl = Number(m[2])
    const title = m[3].replace(/\s+/g, ' ').trim()
    if (flag != null && fl !== flag) continue
    if (seen.has(href)) continue
    seen.add(href)
    out.push({ href, title })
    if (out.length >= limit) break
  }
  return out
}

function gradeMatches(cell, want) {
  const g = String(cell || '').replace(/[^\d.]/g, '')
  const w = String(want || '').replace(/[^\d.]/g, '')
  if (!g || !w) return false
  return Math.abs(Number(g) - Number(w)) < 0.05
}

function fobFromRows(rows, descNeedles, grade) {
  let fobI, chgI, descI, gradeI
  let best = null
  for (const row of rows) {
    const low = row.map((c) => c.toLowerCase())
    if (low.includes('fob') && (low.includes('description') || low.includes('grade'))) {
      fobI = low.indexOf('fob')
      chgI = low.indexOf('change')
      descI = low.indexOf('description')
      gradeI = low.indexOf('grade')
      continue
    }
    if (fobI == null || descI == null) continue
    const desc = (row[descI] || '').toLowerCase()
    if (!descNeedles.some((n) => desc.includes(n.toLowerCase()))) continue
    if (gradeI != null && row[gradeI] != null && !gradeMatches(row[gradeI], grade)) continue
    const fob = num(row[fobI])
    if (fob == null) continue
    const hit = { fob, change: chgI >= 0 ? num(row[chgI]) : null }
    // Prefer the higher FOB quote when multiple matching rows exist (e.g. pellets).
    if (!best || hit.fob > best.fob) best = hit
  }
  return best
}

function isSize16(size) {
  return /^[^\d]*16(?:\s*mm)?$/i.test(String(size || '').trim())
}

function pickBeijingRebar(rows) {
  const cands = []
  for (const row of rows) {
    if (row.length < 5) continue
    if (row[0].toLowerCase() !== 'beijing' || row[1].toLowerCase() !== 'rebar') continue
    if (!isSize16(row[2]) || !/hrb400/i.test(row[3])) continue
    const price = num(row[4])
    if (price == null) continue
    const mill = row[5] || ''
    cands.push({ rank: /hebei/i.test(mill) ? 0 : 1, price, change: num(row[6]), mill })
  }
  cands.sort((a, b) => a.rank - b.rank)
  return cands[0] || null
}

function pickShanghaiHrc(rows) {
  const cands = []
  for (const row of rows) {
    if (row.length < 5) continue
    if (row[0].toLowerCase() !== 'shanghai' || row[1].toUpperCase() !== 'HRC') continue
    const spec = row[2].replace(/\s+/g, '').toUpperCase()
    const grade = row[3].toUpperCase()
    const price = num(row[4])
    if (price == null) continue
    let rank = 99
    if (spec.includes('3.0*1500') && grade.includes('Q235')) rank = 0
    else if (spec.includes('5.5*1500')) rank = 1
    else if (spec.includes('3.0*') && grade.includes('Q235')) rank = 2
    else continue
    cands.push({ rank, price, change: num(row[6]), note: `${spec} ${grade}` })
  }
  cands.sort((a, b) => a.rank - b.rank)
  return cands[0] || null
}

function pickTangshanBillet(rows) {
  for (const row of rows) {
    const joined = row.join(' ').toLowerCase()
    if (!joined.includes('tangshan') || !joined.includes('billet')) continue
    if (/\bexcluded\b/.test(joined)) continue
    const spec = row.join(' ').replace(/[×x]/gi, '*').toLowerCase()
    if (!spec.includes('150*150')) continue
    for (let i = 0; i < row.length; i++) {
      if (!/^-?\d+(?:\.\d+)?$/.test(String(row[i]).trim())) continue
      const price = num(row[i])
      if (price == null || price < 1000 || price > 20000) continue
      return { price, change: num(row[i + 1]), note: 'Common Carbon Square Billet(150*150)' }
    }
  }
  return null
}

async function fetchText(url, cookie, attempts = 2) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Cookie: cookie || '',
          Referer: 'https://www.custeel.net/en/',
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      lastErr = err
      if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 250 * (i + 1)))
    }
  }
  throw lastErr || new Error(url)
}

function countryListUrl(country) {
  const q = new URLSearchParams({
    menuCode: '1006004',
    typeCode: '1009001002',
    title: country,
    urlName: `Seaborne Iron Ore Price > ${country}`,
  })
  return `https://www.custeel.net/en/listMore.do?${q}`
}

async function scrapeCusteel(cookie, cnyUsd) {
  const steel = []
  const histories = {}
  let ok = 0

  // Warm home (login cookies sometimes need a GET first).
  try {
    await fetchText('https://www.custeel.net/en/', cookie, 1)
  } catch {
    /* ignore */
  }

  const byCountry = {}
  for (const [sid, meta] of Object.entries(FOB_SERIES)) {
    ;(byCountry[meta.country] ||= []).push([sid, meta])
  }

  // Parallelize countries — sequential scrapes exceed CF/Pages wall-clock limits.
  const countryResults = await Promise.all(
    Object.entries(byCountry).map(async ([country, items]) => {
      let listHtml
      try {
        listHtml = await fetchText(countryListUrl(country), cookie)
      } catch {
        return []
      }
      const links = listLinks(listHtml, 5, 2)
      const perSid = Object.fromEntries(items.map(([sid]) => [sid, []]))
      const articles = await Promise.all(
        links.map(async ({ href, title }) => {
          try {
            const html = await fetchText(absCusteel(href), cookie)
            return { html, title }
          } catch {
            return null
          }
        }),
      )
      for (const art of articles) {
        if (!art) continue
        const asOf = parseEnglishDate(articleTitle(art.html) || art.title)
        if (!asOf) continue
        const rows = tableRows(art.html)
        for (const [sid, meta] of items) {
          const hit = fobFromRows(rows, meta.desc, meta.grade)
          if (!hit) continue
          const pts = perSid[sid]
          if (pts.length && pts[pts.length - 1].date === asOf) continue
          pts.push({ date: asOf, value: hit.fob })
        }
      }
      const out = []
      for (const [sid, meta] of items) {
        const pts = [...perSid[sid]].reverse()
        if (!pts.length) continue
        const last = pts[pts.length - 1]
        const prev = pts.length > 1 ? pts[pts.length - 2] : null
        const change = prev ? +(last.value - prev.value).toFixed(3) : 0
        const changePct = prev?.value ? +((change / prev.value) * 100).toFixed(2) : 0
        out.push({
          row: {
            id: sid,
            name: meta.name,
            nameFa: meta.nameFa,
            value: +last.value.toFixed(2),
            unit: meta.unit,
            change,
            changePct,
            region: meta.region,
            basis: 'FOB',
            nativeValue: last.value,
            nativeUnit: meta.unit,
            asOf: last.date,
            source: 'custeel-seaborne-fob',
          },
          hist: pts.map((p) => ({ date: p.date, value: +p.value.toFixed(3) })),
        })
      }
      return out
    }),
  )
  for (const batch of countryResults) {
    for (const { row, hist } of batch) {
      steel.push(row)
      histories[row.id] = hist
      ok += 1
    }
  }

  const domesticSpecs = [
    {
      id: 'rebar_beijing',
      page: 'https://www.custeel.net/en/steelpz.do?id=011004',
      need: ['beijing', 'rebar'],
      pick: pickBeijingRebar,
    },
    {
      id: 'hr_shanghai',
      page: 'https://www.custeel.net/en/steelpz.do?id=011001',
      need: ['shanghai', 'hr coil'],
      pick: pickShanghaiHrc,
    },
    {
      id: 'tangshan_billet',
      page: 'https://www.custeel.net/en/steelpz.do?id=011008',
      need: ['summarization of billet'],
      pick: pickTangshanBillet,
    },
  ]

  const domesticResults = await Promise.all(
    domesticSpecs.map(async (spec) => {
      let page
      try {
        page = await fetchText(spec.page, cookie)
      } catch {
        return null
      }
      const links = listLinks(page, 3, 40)
        .filter((l) => spec.need.every((n) => l.title.toLowerCase().includes(n)))
        .slice(0, 2)
      const articles = await Promise.all(
        links.map(async ({ href, title }) => {
          try {
            const html = await fetchText(absCusteel(href), cookie)
            return { html, title }
          } catch {
            return null
          }
        }),
      )
      const pts = []
      for (const art of articles) {
        if (!art) continue
        const asOf = parseEnglishDate(articleTitle(art.html) || art.title)
        if (!asOf) continue
        const picked = spec.pick(tableRows(art.html))
        if (!picked) continue
        if (pts.length && pts[pts.length - 1].date === asOf) continue
        pts.push({ date: asOf, value: picked.price, change: picked.change })
      }
      const chrono = [...pts].reverse()
      if (!chrono.length) return null
      const last = chrono[chrono.length - 1]
      const prev = chrono.length > 1 ? chrono[chrono.length - 2] : null
      const lastUsd = +(last.value * cnyUsd).toFixed(2)
      const prevUsd = prev
        ? +(prev.value * cnyUsd).toFixed(2)
        : last.change != null
          ? +((last.value - last.change) * cnyUsd).toFixed(2)
          : lastUsd
      const change = +(lastUsd - prevUsd).toFixed(3)
      const changePct = prevUsd ? +((change / prevUsd) * 100).toFixed(2) : 0
      const meta = DOMESTIC_META[spec.id]
      return {
        row: {
          id: spec.id,
          name: meta.name,
          nameFa: meta.nameFa,
          value: lastUsd,
          unit: 'دلار/تن',
          change,
          changePct,
          region: meta.region,
          basis: 'market',
          nativeValue: last.value,
          nativeUnit: 'یوان/تن',
          asOf: last.date,
          source: 'custeel-steel-market',
        },
        hist: chrono.map((p) => ({
          date: p.date,
          value: +(p.value * cnyUsd).toFixed(3),
        })),
      }
    }),
  )
  for (const hit of domesticResults) {
    if (!hit) continue
    steel.push(hit.row)
    histories[hit.row.id] = hit.hist
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

const CUSTEEL_HOME = 'https://www.custeel.net/en/'

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
  const url = href.startsWith('http') ? href : `https://www.custeel.net/en/${href}`
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
  const url = href.startsWith('http') ? href : `https://www.custeel.net/en/${href}`
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
  // IME's reporting week starts on Saturday.  Keep the window pinned to the
  // current week so every displayed price is comparable and reproducible.
  const tehranWeekday = new Date(Date.now() + 3.5 * 3600000).getUTCDay()
  const start = jalaliMinusDays((tehranWeekday + 1) % 7)
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
    const close = num(row.Price ?? row.ClosePrice ?? row.bArzehRadifGheymat ?? row.closePrice)
    const quantity = num(row.Quantity ?? row.quantity ?? row.bArzehRadifHajm)
    const totalPrice = num(row.TotalPrice ?? row.totalPrice)
    const date = String(row.Date || row.bArzehTarSal || row.date || '')
      .replace(/-/g, '/')
      .slice(0, 10)
    if (close == null || close <= 0 || quantity == null || quantity <= 0) continue
    normed.push({ goods, symbol, producer, close, quantity, totalPrice, date })
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
    const tradedVolumeTon = hits.reduce((sum, r) => sum + r.quantity, 0)
    const avg = hits.reduce((sum, r) => sum + r.close * r.quantity, 0) / tradedVolumeTon
    const producers = [...new Set(hits.map((r) => r.producer).filter(Boolean))]
    chain.push({
      product: spec.product,
      priceRialKg: Math.round(avg),
      ratioToBilletPct: 0,
      tradeDate: latest,
      weekStart: start,
      weekEnd: end,
      source: 'ime-offer-stat-weekly-weighted',
      samples: hits.length,
      tradedVolumeTon: Math.round(tradedVolumeTon),
      producerCount: producers.length,
      producers,
      calculation: 'sum(price*quantity)/sum(quantity)',
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
        source: 'ime-offer-stat-weekly-weighted',
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
    'chile_conc',
    'iran_conc',
    'iran_hem',
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

  const withTimeout = async (promise, ms, label) => {
    let timer
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  const staticPayload = (bundle, extra = {}) => {
    if (!bundle) return null
    return {
      ok: Boolean(bundle.ok || bundle.steel?.length),
      updatedAt: new Date().toISOString(),
      custeelOk: Boolean(bundle.custeelOk),
      imeOk: Boolean(bundle.imeOk),
      custeelError: null,
      imeError: null,
      cnyUsd: bundle.cnyUsd ?? null,
      usdIrr: bundle.usdIrr ?? null,
      steel: bundle.steel || [],
      imeChain: bundle.imeChain || [],
      inventories: bundle.inventories || null,
      bfRate: bundle.bfRate || null,
      billetStocks: bundle.billetStocks || null,
      histories: bundle.histories || {},
      source: bundle.source || 'static',
      imeMeta: bundle.imeMeta || null,
      ...extra,
    }
  }

  try {
    // Static first so a hung Custeel scrape never leaves the client waiting forever.
    let staticBundle = null
    try {
      const origin = new URL(request.url).origin
      const sres = await fetch(`${origin}/data/steel_chain.json`, {
        cf: { cacheTtl: 0, cacheEverything: false },
      })
      if (sres.ok) staticBundle = await sres.json()
    } catch {
      /* ignore */
    }

    const url = new URL(request.url)
    const wantFresh = url.searchParams.has('fresh') || url.searchParams.get('live') === '1'
    const asOfs = (staticBundle?.steel || []).map((s) => s.asOf).filter(Boolean).sort()
    const newestAsOf = asOfs.length ? asOfs[asOfs.length - 1] : null
    const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const staticFreshEnough = Boolean(
      staticBundle?.steel?.length && newestAsOf && newestAsOf >= yday,
    )

    // Fast path: serve bundled snapshot so the SPA never waits on Custeel.
    if (!wantFresh && staticFreshEnough) {
      const fast = staticPayload(staticBundle, {
        custeelOk: true,
        source: 'static',
        note: `static-fast asOf=${newestAsOf}`,
      })
      return new Response(JSON.stringify(fast), { headers })
    }

    const [cnyUsd, usdIrr, sessionRes] = await Promise.all([
      withTimeout(fetchCnyUsd(), 3000, 'cnyUsd').catch(() => staticBundle?.cnyUsd ?? null),
      withTimeout(fetchUsdIrr(), 3000, 'usdIrr').catch(() => staticBundle?.usdIrr ?? null),
      withTimeout(custeelSession(env), 8000, 'custeel-login').then(
        (cookie) => ({ cookie, err: null }),
        (e) => ({ cookie: '', err: String(e?.message || e) }),
      ),
    ])

    let cookie = sessionRes.cookie || ''
    let custeelErr = sessionRes.err
    if (!cookie && !custeelErr) {
      const user = String(env?.CUSTEEL_USER || '').trim()
      const pass = String(env?.CUSTEEL_PASS || '').trim()
      const cookieSecret = String(env?.CUSTEEL_COOKIE || '').trim()
      if (!user && !pass && !cookieSecret) custeelErr = 'missing CUSTEEL_USER/PASS or CUSTEEL_COOKIE'
    }

    let series = { steel: [], histories: {}, ok: 0 }
    let indicators = { ok: false }
    if (cookie) {
      const [indRes, seriesRes] = await Promise.allSettled([
        withTimeout(scrapeIndicators(cookie), 12000, 'custeel-indicators'),
        withTimeout(scrapeCusteel(cookie, cnyUsd), 18000, 'custeel-scrape'),
      ])
      if (indRes.status === 'fulfilled') indicators = indRes.value
      else custeelErr = String(indRes.reason?.message || indRes.reason)
      if (seriesRes.status === 'fulfilled') series = seriesRes.value
      else custeelErr = String(seriesRes.reason?.message || seriesRes.reason)
    }

    let ime = { ok: false }
    try {
      ime = await withTimeout(scrapeIme(usdIrr), 5000, 'ime')
    } catch (e) {
      ime = { ok: false, error: String(e?.message || e) }
    }

    const steel = mergeSteel(
      series.steel,
      indicators.steelExtra,
      ime.steel,
      !(series.ok > 0) && staticBundle?.steel ? staticBundle.steel : [],
    )
    const imeChain = ime.ok ? ime.imeChain : staticBundle?.imeChain || []
    const custeelOk = series.ok > 0
    const payload = {
      ok: custeelOk || ime.ok || Boolean(staticBundle?.ok || staticBundle?.steel?.length),
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

