/**
 * Cloudflare Pages Function — lightweight market pulse tick
 * GET /api/pulse
 *
 * Fetches TradersArena /data/market, appends to CF Cache history (09:00→now),
 * returns current snapshot + intraday series for the pulse charts.
 */
import {
  fetchTradersArenaPulse,
  loadPulseStore,
  savePulseStore,
  mergePulseHistory,
  jalaliTodayTehran,
} from '../lib/pulse.js'

export async function onRequestGet(context) {
  const errors = []
  const cache = typeof caches !== 'undefined' ? caches.default : null
  const origin = new URL(context.request.url).origin

  let fallback = null
  try {
    const res = await fetch(`${origin}/data/market_pulse.json`)
    if (res.ok) fallback = await res.json()
  } catch (e) {
    errors.push(`static-pulse: ${e}`)
  }

  let store = await loadPulseStore(cache, fallback)
  let pulse = null

  try {
    pulse = await fetchTradersArenaPulse()
    store = mergePulseHistory(store, pulse)
    await savePulseStore(cache, store)
  } catch (e) {
    errors.push(`tradersarena: ${e}`)
    pulse = store?.current || fallback?.current || null
  }

  const today = jalaliTodayTehran()
  if (store?.dateJalali && store.dateJalali !== today.dateJalali && pulse) {
    store = mergePulseHistory({ dateJalali: today.dateJalali, history: [] }, pulse)
    await savePulseStore(cache, store)
  }

  return Response.json(
    {
      ok: Boolean(pulse),
      updatedAt: new Date().toISOString(),
      dateJalali: pulse?.dateJalali || today.dateJalali,
      marketPulse: pulse,
      marketPulseHistory: store?.history || [],
      source: pulse?.source || null,
      errors,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=15',
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}
