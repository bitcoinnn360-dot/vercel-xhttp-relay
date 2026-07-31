#!/usr/bin/env node
/**
 * CLI: fetch Midco portfolio monthly production + energy from BourseView
 * → public/data/production.json
 *
 * Env: BOURSEVIEW_COOKIE or BOURSEVIEW_TOKEN
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildProductionBundle,
  normalizeCookie,
} from '../functions/lib/production_core.js'

async function main() {
  const cookie = normalizeCookie(process.env.BOURSEVIEW_COOKIE || process.env.BOURSEVIEW_TOKEN || '')
  const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'production.json')
  if (!cookie) {
    console.error('BOURSEVIEW_COOKIE missing — writing empty stub')
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          ok: false,
          updatedAt: new Date().toISOString(),
          source: 'stub',
          note: 'missing cookie',
          companies: [],
          errors: ['BOURSEVIEW_COOKIE missing'],
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
    return
  }
  const bundle = await buildProductionBundle(cookie)
  writeFileSync(outPath, JSON.stringify(bundle, null, 2))
  console.log(
    `wrote ${outPath} companies=${bundle.companies.length} ok=${bundle.ok} errors=${(bundle.errors || []).length}`,
  )
  for (const c of bundle.companies) {
    console.log(
      `  ${c.symbol}: products=${c.products.length} energy=${c.energy.map((e) => e.id).join(',') || '—'} latest=${c.latestLabel}`,
    )
  }
  if (!bundle.ok) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
