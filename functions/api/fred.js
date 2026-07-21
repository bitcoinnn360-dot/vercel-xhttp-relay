/**
 * Cloudflare Pages Function — proxy FRED CSV (no browser CORS).
 * GET /api/fred?id=DCOILBRENTEU&limit=120
 */
export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  const id = url.searchParams.get('id') || 'DCOILBRENTEU'
  const limit = Math.min(Number(url.searchParams.get('limit') || 180), 2000)
  if (!/^[A-Z0-9]+$/i.test(id)) {
    return Response.json({ ok: false, error: 'invalid series id' }, { status: 400 })
  }

  try {
    const fredUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`
    const res = await fetch(fredUrl, {
      headers: { 'User-Agent': 'MIDCO-MarketDashboard/1.0' },
    })
    if (!res.ok) {
      return Response.json({ ok: false, error: `fred ${res.status}` }, { status: 502 })
    }
    const text = await res.text()
    const lines = text.trim().split(/\r?\n/).slice(1)
    const points = []
    for (const line of lines) {
      const [date, value] = line.split(',')
      if (!date || value === '.' || value === '' || Number.isNaN(Number(value))) continue
      points.push({ date, value: Number(value) })
    }
    const sliced = points.slice(-limit)
    const last = sliced[sliced.length - 1]
    const prev = sliced[sliced.length - 2]
    const change = last && prev ? last.value - prev.value : 0
    const changePct = last && prev && prev.value ? (change / prev.value) * 100 : 0

    return Response.json(
      {
        ok: true,
        id,
        last: last?.value ?? null,
        change,
        changePct,
        history: sliced,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=1800',
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
