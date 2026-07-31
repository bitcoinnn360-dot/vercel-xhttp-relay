#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFinancialsBundle, normalizeCookie } from '../functions/lib/financials_core.js'

async function main() {
  const cookie = normalizeCookie(process.env.BOURSEVIEW_COOKIE || process.env.BOURSEVIEW_TOKEN || '')
  const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'financials.json')
  if (!cookie) {
    writeFileSync(
      outPath,
      JSON.stringify({ ok: false, companies: [], source: 'stub', errors: ['missing cookie'] }, null, 2),
    )
    process.exitCode = 1
    return
  }
  const bundle = await buildFinancialsBundle(cookie)
  writeFileSync(outPath, JSON.stringify(bundle, null, 2))
  console.log(`wrote ${outPath} n=${bundle.companies.length}`)
  for (const c of bundle.companies) {
    console.log(`  ${c.symbol}: lines=${c.lines.length} ${c.label}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
