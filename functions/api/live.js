/**
 * Cloudflare Pages Function — live snapshot from TGJU ajax.json
 * GET /api/live
 */
const TGJU = 'https://call2.tgju.org/ajax.json'

const MAP = {
  bourse: { id: 'bourse', name: 'شاخص کل بورس' },
  price_dollar_rl: { id: 'price_dollar_rl', name: 'دلار آزاد' },
  ons: { id: 'ons', name: 'انس طلا' },
  sekee: { id: 'sekee', name: 'سکه بهار آزادی' },
  copper: { id: 'copper', name: 'مس جهانی' },
  aluminium: { id: 'aluminium', name: 'آلومینیوم جهانی' },
  zinc: { id: 'zinc', name: 'روی جهانی' },
  oil_brent: { id: 'oil_brent', name: 'نفت برنت' },
  'crypto-bitcoin': { id: 'crypto-bitcoin', name: 'بیت‌کوین' },
  'base-us-iron-ore': { id: 'base-us-iron-ore', name: 'سنگ‌آهن (جایگزین Custeel)' },
  'base-us-steel-coil': { id: 'base-us-steel-coil', name: 'ورق گرم آمریکا' },
  'energy-natural-gas': { id: 'energy-natural-gas', name: 'گاز طبیعی آمریکا' },
}

function parseNum(raw) {
  if (raw == null) return null
  const n = Number(String(raw).replace(/,/g, '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export async function onRequestGet() {
  try {
    const res = await fetch(TGJU, {
      headers: { Accept: 'application/json', 'User-Agent': 'MIDCO-MarketDashboard/1.0' },
    })
    if (!res.ok) {
      return Response.json({ ok: false, error: `tgju ${res.status}` }, { status: 502 })
    }
    const json = await res.json()
    const current = json.current || {}
    const quotes = {}
    for (const [key, meta] of Object.entries(MAP)) {
      const row = current[key]
      if (!row) continue
      const value = parseNum(row.p)
      const change = parseNum(row.d) ?? 0
      const changePct = parseNum(row.dp) ?? 0
      const signedChange = (row.dt === 'low' || changePct < 0) ? -Math.abs(change) : Math.abs(change)
      quotes[meta.id] = {
        ...meta,
        value,
        change: signedChange,
        changePct: row.dt === 'low' ? -Math.abs(changePct) : changePct,
        high: parseNum(row.h),
        low: parseNum(row.l),
        time: row.t || row['t_en'] || null,
        source: 'tgju',
      }
    }

    return Response.json(
      { ok: true, updatedAt: new Date().toISOString(), quotes },
      {
        headers: {
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
