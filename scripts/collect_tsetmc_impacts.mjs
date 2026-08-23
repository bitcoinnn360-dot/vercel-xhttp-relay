import fs from 'node:fs/promises'

const OUT = new URL('../public/data/impacts_cache.json', import.meta.url)
const clean = (value) => String(value || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim()

const overviewPayload = await fetch('https://cdn.tsetmc.com/api/MarketData/GetMarketOverview/2').then((res) => {
  if (!res.ok) throw new Error(`TSETMC overview ${res.status}`)
  return res.json()
})
const overview = overviewPayload?.marketOverview || overviewPayload?.data || overviewPayload || {}
const dEven = Math.trunc(Number(overview.marketActivityDEven ?? overview.lastDataDEven ?? overview.dEven ?? 0))
if (!dEven) throw new Error('TSETMC trading date missing')

const payload = await fetch(`https://cdn.tsetmc.com/api/Index/GetInstEffect/${dEven}/0/500`).then((res) => {
  if (!res.ok) throw new Error(`TSETMC IFB effects ${res.status}`)
  return res.json()
})
const rows = payload?.instEffect || payload?.instrumentEffect || payload?.data || []
const all = (Array.isArray(rows) ? rows : [])
  .map((row) => {
    const inst = row?.instrument || row?.ins || {}
    const symbol = clean(inst.lVal18AFC || inst.symbol || row.lVal18AFC || row.symbol)
    const impact = Number(row.instEffectValue ?? row.effectValue ?? row.indexEffect ?? row.effect)
    return symbol && Number.isFinite(impact) ? { symbol, impact } : null
  })
  .filter(Boolean)
if (all.length < 20) throw new Error(`TSETMC IFB list incomplete (${all.length})`)

const current = JSON.parse(await fs.readFile(OUT, 'utf8'))
current.ifbPos = all.filter((row) => row.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, 5)
current.ifbNeg = all.filter((row) => row.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, 5)
current.dEven = dEven
current.updatedAt = new Date().toISOString()
current.sources = ['tsetmc-official-ifb']
await fs.writeFile(OUT, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
console.log(`updated ${all.length} IFB instruments for ${dEven}`)

