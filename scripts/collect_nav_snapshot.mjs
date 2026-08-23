import fs from 'node:fs/promises'
import { onRequestGet } from '../functions/api/nav.js'

const rawCookie = String(process.env.BOURSEVIEW_COOKIE || '').trim()
if (!rawCookie) throw new Error('BOURSEVIEW_COOKIE missing')
const cookie = /authentication=/i.test(rawCookie) ? rawCookie : `authentication=${rawCookie}`
const response = await onRequestGet({
  env: { BOURSEVIEW_COOKIE: cookie, BOURSEVIEW_ID_TOKEN: process.env.BOURSEVIEW_ID_TOKEN || '' },
  request: new Request('https://snapshot.local/api/nav?fresh=1'),
})
const payload = await response.json()
if (!payload?.ok || !payload?.holdings?.length || !payload?.nav?.asOf) {
  throw new Error(`BourseView NAV snapshot failed: ${JSON.stringify(payload?.errors || payload?.error || payload)}`)
}
delete payload.served
await fs.writeFile(new URL('../public/data/nav_snapshot.json', import.meta.url), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`NAV snapshot ${payload.nav.asOf}: ${payload.holdings.length} holdings, NAV ${payload.nav.navPerShare}`)

