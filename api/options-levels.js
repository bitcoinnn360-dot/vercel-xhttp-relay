export const config = { runtime: "edge" };

// Fetches Deribit option chain (public) and optionally Coinglass max-pain (API key).
// Returns three trade levels for the nearest weekly-style expiry:
//   max_pain, top_call_oi_strike (call wall), top_put_oi_strike (put wall)

const MONTHS = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, s-maxage=60, stale-while-revalidate=120",
      "access-control-allow-origin": "*",
    },
  });
}

function parseExpiry(token) {
  // e.g. 25JUL26
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(token);
  if (!m) return null;
  const day = Number(m[1]);
  const mon = MONTHS[m[2]];
  const year = 2000 + Number(m[3]);
  if (mon == null) return null;
  // Deribit BTC options typically expire 08:00 UTC
  return new Date(Date.UTC(year, mon, day, 8, 0, 0));
}

function computeMaxPain(callOi, putOi) {
  const strikes = Array.from(new Set([...Object.keys(callOi), ...Object.keys(putOi)]))
    .map(Number)
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  if (!strikes.length) return null;

  let bestStrike = strikes[0];
  let bestPain = Infinity;
  for (const settle of strikes) {
    let pain = 0;
    for (const k of strikes) {
      const c = callOi[k] || 0;
      const p = putOi[k] || 0;
      if (settle > k) pain += c * (settle - k);
      if (k > settle) pain += p * (k - settle);
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settle;
    }
  }
  return bestStrike;
}

function topStrike(map) {
  let best = null;
  let bestOi = -1;
  for (const [k, v] of Object.entries(map)) {
    if (v > bestOi) {
      bestOi = v;
      best = Number(k);
    }
  }
  return best == null ? null : { strike: best, open_interest: bestOi };
}

async function fetchDeribit(currency) {
  const url =
    "https://www.deribit.com/api/v2/public/get_book_summary_by_currency" +
    `?currency=${encodeURIComponent(currency)}&kind=option`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Deribit HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || "Deribit error");
  return body.result || [];
}

async function fetchCoinglassMaxPain(symbol, exchange, apiKey) {
  const url =
    "https://open-api-v4.coinglass.com/api/option/max-pain" +
    `?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "CG-API-KEY": apiKey,
    },
  });
  const body = await res.json();
  if (String(body.code) !== "0") {
    return { ok: false, error: body.msg || `Coinglass code ${body.code}` };
  }
  return { ok: true, data: body.data || [] };
}

function yyMmDdToToken(dateStr) {
  // Coinglass uses YYMMDD e.g. 250725 → compare with Deribit 25JUL25 style via Date
  if (!/^\d{6}$/.test(dateStr)) return null;
  const yy = Number(dateStr.slice(0, 2));
  const mm = Number(dateStr.slice(2, 4));
  const dd = Number(dateStr.slice(4, 6));
  return new Date(Date.UTC(2000 + yy, mm - 1, dd, 8, 0, 0));
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const currency = (url.searchParams.get("currency") || "BTC").toUpperCase();
    const symbol = (url.searchParams.get("symbol") || currency).toUpperCase();
    const exchange = url.searchParams.get("exchange") || "Deribit";
    const expiryParam = url.searchParams.get("expiry"); // optional Deribit token e.g. 25JUL26
    const apiKey = req.headers.get("cg-api-key") || process.env.COINGLASS_API_KEY || "";

    const rows = await fetchDeribit(currency);
    const byExp = new Map();

    for (const r of rows) {
      const name = r.instrument_name || "";
      const parts = name.split("-");
      if (parts.length < 4) continue;
      const exp = parts[1];
      const strike = Number(parts[2]);
      const cp = parts[3];
      const oi = Number(r.open_interest || 0);
      const vol = Number(r.volume || 0);
      if (!Number.isFinite(strike)) continue;
      if (!byExp.has(exp)) {
        byExp.set(exp, {
          token: exp,
          date: parseExpiry(exp),
          callOi: {},
          putOi: {},
          callVol: {},
          putVol: {},
          callOiTotal: 0,
          putOiTotal: 0,
        });
      }
      const bucket = byExp.get(exp);
      if (cp === "C") {
        bucket.callOi[strike] = (bucket.callOi[strike] || 0) + oi;
        bucket.callVol[strike] = (bucket.callVol[strike] || 0) + vol;
        bucket.callOiTotal += oi;
      } else if (cp === "P") {
        bucket.putOi[strike] = (bucket.putOi[strike] || 0) + oi;
        bucket.putVol[strike] = (bucket.putVol[strike] || 0) + vol;
        bucket.putOiTotal += oi;
      }
    }

    const now = Date.now();
    let chosen = null;
    if (expiryParam && byExp.has(expiryParam.toUpperCase())) {
      chosen = byExp.get(expiryParam.toUpperCase());
    } else {
      // nearest future expiry with some OI (weekly end-of-week target)
      const candidates = [...byExp.values()]
        .filter((e) => e.date && e.date.getTime() >= now - 6 * 3600 * 1000)
        .filter((e) => e.callOiTotal + e.putOiTotal > 0)
        .sort((a, b) => a.date - b.date);
      chosen = candidates[0] || null;
    }

    if (!chosen) {
      return json({ ok: false, error: "No suitable options expiry found on Deribit" }, 404);
    }

    const maxPain = computeMaxPain(chosen.callOi, chosen.putOi);
    const topCall = topStrike(chosen.callOi);
    const topPut = topStrike(chosen.putOi);
    // volume walls as secondary metrics
    const topCallVol = topStrike(chosen.callVol);
    const topPutVol = topStrike(chosen.putVol);

    let coinglass = null;
    if (apiKey) {
      const cg = await fetchCoinglassMaxPain(symbol, exchange, apiKey);
      if (cg.ok) {
        const match = (cg.data || []).find((row) => {
          const d = yyMmDdToToken(String(row.date || ""));
          return d && chosen.date && d.toISOString().slice(0, 10) === chosen.date.toISOString().slice(0, 10);
        });
        const nearestWeek = (cg.data || [])
          .map((row) => ({ row, d: yyMmDdToToken(String(row.date || "")) }))
          .filter((x) => x.d && x.d.getTime() >= now - 6 * 3600 * 1000)
          .sort((a, b) => a.d - b.d)[0];
        coinglass = {
          matched_expiry: match || null,
          nearest_future: nearestWeek ? nearestWeek.row : null,
          note: "Official Coinglass options API exposes max pain only — not strike-level call/put walls.",
        };
      } else {
        coinglass = { error: cg.error };
      }
    } else {
      coinglass = {
        skipped: true,
        note: "Set COINGLASS_API_KEY env or CG-API-KEY header to also pull Coinglass max-pain.",
      };
    }

    return json({
      ok: true,
      source: {
        deribit: "public get_book_summary_by_currency",
        coinglass: apiKey ? "option/max-pain" : null,
      },
      currency,
      exchange_assumed: "Deribit",
      expiry: {
        token: chosen.token,
        iso: chosen.date ? chosen.date.toISOString() : null,
        call_oi_total: chosen.callOiTotal,
        put_oi_total: chosen.putOiTotal,
      },
      levels: {
        max_pain: maxPain,
        call_wall: topCall ? topCall.strike : null,
        put_wall: topPut ? topPut.strike : null,
      },
      details: {
        call_wall_oi: topCall,
        put_wall_oi: topPut,
        call_wall_volume: topCallVol,
        put_wall_volume: topPutVol,
        max_pain_computed_from: "deribit_open_interest",
      },
      trade_hint: {
        levels: [topPut?.strike, maxPain, topCall?.strike].filter((x) => x != null),
        idea: "Trade mean-reversion / range reactions between put wall, max pain, and call wall into expiry.",
      },
      coinglass,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}
