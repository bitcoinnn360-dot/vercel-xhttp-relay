/**
 * Portfolio annual income statements (GuruFocus-style viz data).
 * Static-first from /data/financials.json unless ?fresh=1 / ?refresh=1.
 */

import { buildFinancialsBundle, normalizeCookie } from '../lib/financials_core.js'

const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const CACHE_KEY = 'https://cache.local/midco-financials-bv-v2'

async function loadStatic(origin) {
  try {
    const res = await fetch(`${origin}/data/financials.json`)
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
  const idToken = String(env?.BOURSEVIEW_ID_TOKEN || '').trim()
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

  if (false && !forceRefresh && staticBundle?.ok) {
    return new Response(JSON.stringify({ ...staticBundle, served: 'static-fast' }), { headers })
  }

  if (cache && !forceRefresh) {
    const hit = await cache.match(CACHE_KEY)
    if (hit) {
      const cachedAt = Number(hit.headers.get('x-cached-at') || 0)
      if (cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) {
        return new Response(hit.body, {
          headers: { ...headers, 'x-cached-at': String(cachedAt), 'x-cache': 'HIT' },
        })
      }
    }
  }

  if (!cookie) {
    if (false && staticBundle) {
      return new Response(JSON.stringify({ ...staticBundle, served: 'static-no-cookie' }), { headers })
    }
    return new Response(
      JSON.stringify({ ok: false, error: 'BOURSEVIEW_COOKIE missing', companies: [] }),
      { status: 503, headers },
    )
  }

  try {
    const payload = await buildFinancialsBundle(cookie, idToken)
    payload.served = 'live'
    const body = JSON.stringify(payload)
    const response = new Response(body, {
      headers: { ...headers, 'x-cached-at': String(Date.now()), 'x-cache': 'MISS' },
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
    if (false && staticBundle) {
      return new Response(
        JSON.stringify({ ...staticBundle, served: 'static-fallback', note: String(e?.message || e) }),
        { headers },
      )
    }
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e), companies: [] }), {
      status: 502,
      headers,
    })
  }
}
