/**
 * Cloudflare Pages Function: portfolio monthly production + energy (YoY).
 *
 * Static-first from /data/production.json unless ?fresh=1 / ?refresh=1.
 * Live scrape requires env BOURSEVIEW_COOKIE.
 */

import { buildProductionBundle, normalizeCookie } from '../lib/production_core.js'

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const CACHE_KEY = 'https://cache.local/midco-production-v1'

async function loadStatic(origin) {
  try {
    const res = await fetch(`${origin}/data/production.json`)
    if (!res.ok) return null
    const json = await res.json()
    return json?.companies?.length ? json : null
  } catch {
    return null
  }
}

export async function onRequestGet(context) {
  const { request, env } = context
  const origin = new URL(request.url).origin
  const url = new URL(request.url)
  const forceRefresh = url.searchParams.has('refresh') || url.searchParams.has('fresh')
  const cookie = normalizeCookie(env?.BOURSEVIEW_COOKIE || env?.BOURSEVIEW_TOKEN || '')
  const cache = typeof caches !== 'undefined' ? caches.default : null
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
  }

  let staticBundle = null
  try {
    staticBundle = await loadStatic(origin)
  } catch {
    /* ignore */
  }

  if (!forceRefresh && staticBundle?.ok) {
    return new Response(
      JSON.stringify({
        ...staticBundle,
        served: 'static-fast',
      }),
      { headers },
    )
  }

  if (cache && !forceRefresh) {
    const hit = await cache.match(CACHE_KEY)
    if (hit) {
      const cachedAt = Number(hit.headers.get('x-cached-at') || 0)
      if (cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) {
        return new Response(hit.body, {
          headers: {
            ...headers,
            'x-cached-at': String(cachedAt),
            'x-cache': 'HIT',
          },
        })
      }
    }
  }

  if (!cookie) {
    if (staticBundle) {
      return new Response(
        JSON.stringify({ ...staticBundle, served: 'static-no-cookie', bourseviewReady: false }),
        { headers },
      )
    }
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'BOURSEVIEW_COOKIE missing',
        source: 'bourseview',
        companies: [],
      }),
      { status: 503, headers },
    )
  }

  try {
    const payload = await buildProductionBundle(cookie)
    payload.bourseviewReady = true
    payload.served = 'live'
    const body = JSON.stringify(payload)
    const response = new Response(body, {
      headers: {
        ...headers,
        'x-cached-at': String(Date.now()),
        'x-cache': 'MISS',
      },
    })
    if (cache && payload.ok) {
      try {
        await cache.put(CACHE_KEY, response.clone())
      } catch {
        /* ignore */
      }
    }
    return response
  } catch (e) {
    if (staticBundle) {
      return new Response(
        JSON.stringify({
          ...staticBundle,
          served: 'static-fallback',
          note: `live failed: ${e?.message || e}`,
        }),
        { headers },
      )
    }
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e), companies: [] }),
      { status: 502, headers },
    )
  }
}
