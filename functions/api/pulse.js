/**
 * Cloudflare Pages Function — lightweight market pulse tick
 * GET /api/pulse
 * GET /api/pulse?date=1405/05/06  → history for that Jalali day
 *
 * Fetches TradersArena, merges cron/static/cache history (08:45→17:00;
 * cash board ~12:30, gold ETFs into the afternoon),
 * returns current snapshot + intraday series.
 */
import {
  fetchTradersArenaPulse,
  loadPulseStore,
  savePulseStore,
  mergePulseHistory,
  jalaliTodayTehran,
  historyForDay,
  clampPulseHistoryTime,
  PULSE_HIST_START,
  PULSE_CASH_END,
  PULSE_HIST_END,
} from '../lib/pulse.js'

function clampPulseSnapshot(pulse) {
  if (!pulse || typeof pulse !== 'object') return pulse
  const t = clampPulseHistoryTime(pulse.time) || (String(pulse.time || '') > PULSE_HIST_END ? PULSE_HIST_END : pulse.time)
  return { ...pulse, time: t || PULSE_HIST_END }
}

export async function onRequestGet(context) {
  const errors = []
  const cache = typeof caches !== 'undefined' ? caches.default : null
  const origin = new URL(context.request.url).origin
  const url = new URL(context.request.url)
  const dateParam = url.searchParams.get('date')

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

  pulse = clampPulseSnapshot(pulse)

  const today = jalaliTodayTehran()
  const history = historyForDay(store, dateParam || today.dateJalali)
  const days = Object.keys(store?.days || {}).sort()

  return Response.json(
    {
      ok: Boolean(pulse) || history.length > 0,
      updatedAt: new Date().toISOString(),
      dateJalali: dateParam || pulse?.dateJalali || store?.dateJalali || today.dateJalali,
      marketPulse: pulse,
      marketPulseHistory: history,
      availableDays: days.slice(-45),
      session: { start: PULSE_HIST_START, cashEnd: PULSE_CASH_END, end: PULSE_HIST_END },
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
