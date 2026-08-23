import fs from 'node:fs/promises'

const OUT = new URL('../public/data/impacts_cache.json', import.meta.url)
const clean = (value) => String(value || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim()
const WATCH = 'https://cdn.tsetmc.com/api/ClosingPrice/GetMarketWatch?market=2&industrialGroup=&boardId=0&paperTypes[0]=1'
const isBondLike = (name) => /اراد|اخزا|اجاره|مرابحه|صکوک|تسه|اختیار|اختيار|درآمد ثابت|طلا|سکه|نقره|زعفران/.test(String(name || ''))

const watchPayload = await fetch(WATCH).then((res) => {
  if (!res.ok) throw new Error(`TSETMC IFB market watch ${res.status}`)
  return res.json()
})
const watchRows = watchPayload?.marketwatch || watchPayload?.marketWatch || watchPayload?.data || []
const all = (Array.isArray(watchRows) ? watchRows : [])
  .map((row) => {
    const symbol = clean(row?.lva || row?.symbol)
    const name = clean(row?.lvc || row?.name || symbol)
    const yesterday = Number(row?.py)
    const priceChange = Number(row?.pcpc)
    if (!symbol || !Number.isFinite(yesterday) || yesterday <= 0 || !Number.isFinite(priceChange) || priceChange === 0) return null
    if (/[23]$/.test(symbol) || isBondLike(name)) return null
    const impact = Math.round((priceChange / yesterday) * 10000) / 100
    return { symbol, impact, priceChange }
  })
  .filter(Boolean)
if (all.length < 20) throw new Error(`TSETMC IFB list incomplete (${all.length})`)

const current = JSON.parse(await fs.readFile(OUT, 'utf8'))
current.ifbPos = all.filter((row) => row.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, 5)
current.ifbNeg = all.filter((row) => row.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, 5)
current.updatedAt = new Date().toISOString()
current.sources = ['tsetmc-marketwatch-ifb-percent']
await fs.writeFile(OUT, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
console.log(`updated ${all.length} IFB market-watch instruments`)

