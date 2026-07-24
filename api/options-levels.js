export const config = { runtime: "edge" };

// Options levels + risk-neutral style probabilities for daily trading.
// Levels from Deribit OI; IV from mark_iv; optional Coinglass max-pain cross-check.
// Probabilities are MODEL ESTIMATES (GBM / ATM IV), not guaranteed forecasts.

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
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(token);
  if (!m) return null;
  const mon = MONTHS[m[2]];
  if (mon == null) return null;
  return new Date(Date.UTC(2000 + Number(m[3]), mon, Number(m[1]), 8, 0, 0));
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a));
  return sign * y;
}

function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function clamp01(x) {
  if (!Number.isFinite(x)) return null;
  return Math.min(1, Math.max(0, x));
}

function pct(x) {
  const v = clamp01(x);
  return v == null ? null : Math.round(v * 1000) / 10; // one decimal percent
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

async function fetchDvol(currency) {
  const end = Date.now();
  const start = end - 2 * 24 * 3600 * 1000;
  const url =
    "https://www.deribit.com/api/v2/public/get_volatility_index_data" +
    `?currency=${encodeURIComponent(currency)}&start_timestamp=${start}&end_timestamp=${end}&resolution=3600`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    const data = (body.result && body.result.data) || [];
    if (!data.length) return null;
    const last = data[data.length - 1];
    // [ts, open, high, low, close]
    return { last: last[4], high: last[2], low: last[3], ts: last[0] };
  } catch {
    return null;
  }
}

async function fetchCoinglassMaxPain(symbol, exchange, apiKey) {
  const url =
    "https://open-api-v4.coinglass.com/api/option/max-pain" +
    `?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "CG-API-KEY": apiKey },
  });
  const body = await res.json();
  if (String(body.code) !== "0") {
    return { ok: false, error: body.msg || `Coinglass code ${body.code}` };
  }
  return { ok: true, data: body.data || [] };
}

function yyMmDdToDate(dateStr) {
  if (!/^\d{6}$/.test(dateStr)) return null;
  return new Date(
    Date.UTC(2000 + Number(dateStr.slice(0, 2)), Number(dateStr.slice(2, 4)) - 1, Number(dateStr.slice(4, 6)), 8, 0, 0)
  );
}

/** P(S_T > K) under r≈0 Black-Scholes */
function probAbove(spot, strike, ivPct, tYears) {
  if (!(spot > 0 && strike > 0 && ivPct > 0 && tYears > 0)) return null;
  const sig = ivPct / 100;
  const volSqrt = sig * Math.sqrt(tYears);
  const d2 = (Math.log(spot / strike) - 0.5 * sig * sig * tYears) / volSqrt;
  return clamp01(normCdf(d2));
}

/**
 * P(hit upper before lower) for GBM with r=0.
 * γ = 2r/σ² - 1 = -1 → P = (S^{-1} - L^{-1}) / (U^{-1} - L^{-1})
 */
function probHitUpperBeforeLower(spot, lower, upper) {
  if (!(spot > 0 && lower > 0 && upper > 0 && lower < upper)) return null;
  if (spot <= lower) return 0;
  if (spot >= upper) return 1;
  const invS = 1 / spot;
  const invL = 1 / lower;
  const invU = 1 / upper;
  return clamp01((invS - invL) / (invU - invL));
}

function buildProbabilities(spot, putWall, maxPain, callWall, atmIv, tYears) {
  // Order levels for path logic
  const ordered = [
    { name: "put_wall", price: putWall },
    { name: "max_pain", price: maxPain },
    { name: "call_wall", price: callWall },
  ]
    .filter((x) => x.price != null && Number.isFinite(x.price))
    .sort((a, b) => a.price - b.price);

  const pAbovePut = probAbove(spot, putWall, atmIv, tYears);
  const pAboveMax = probAbove(spot, maxPain, atmIv, tYears);
  const pAboveCall = probAbove(spot, callWall, atmIv, tYears);

  const expiry_zones = {
    below_put_wall: pct(pAbovePut == null ? null : 1 - pAbovePut),
    put_to_max_pain: pct(pAbovePut != null && pAboveMax != null ? pAbovePut - pAboveMax : null),
    max_pain_to_call_wall: pct(pAboveMax != null && pAboveCall != null ? pAboveMax - pAboveCall : null),
    above_call_wall: pct(pAboveCall),
  };

  // Adjacent transition probs (path): hit next level before previous
  const transitions = [];
  if (ordered.length >= 2) {
    for (let i = 0; i < ordered.length - 1; i++) {
      const lo = ordered[i];
      const hi = ordered[i + 1];
      const up = probHitUpperBeforeLower(spot, lo.price, hi.price);
      const down = up == null ? null : clamp01(1 - up);
      transitions.push({
        from: lo.name,
        to: hi.name,
        from_price: lo.price,
        to_price: hi.price,
        // If currently in/near the band, chance of reaching upper before lower
        prob_reach_upper_before_lower_pct: pct(up),
        prob_reach_lower_before_upper_pct: pct(down),
        label_up: `${lo.name} → ${hi.name}`,
        label_down: `${hi.name} → ${lo.name}`,
      });
    }
  }

  // Named convenience for the user's example (put wall → max pain)
  let put_to_max = null;
  let max_to_call = null;
  for (const t of transitions) {
    if (t.from === "put_wall" && t.to === "max_pain") put_to_max = t.prob_reach_upper_before_lower_pct;
    if (t.from === "max_pain" && t.to === "call_wall") max_to_call = t.prob_reach_upper_before_lower_pct;
  }
  // If ordering differs (e.g. max pain below put), match by prices
  if (put_to_max == null && putWall != null && maxPain != null && putWall < maxPain) {
    put_to_max = pct(probHitUpperBeforeLower(spot, putWall, maxPain));
  }
  if (max_to_call == null && maxPain != null && callWall != null && maxPain < callWall) {
    max_to_call = pct(probHitUpperBeforeLower(spot, maxPain, callWall));
  }

  let location = "unknown";
  if (putWall != null && spot < putWall) location = "below_put_wall";
  else if (putWall != null && maxPain != null && spot >= putWall && spot < maxPain) location = "between_put_and_max_pain";
  else if (maxPain != null && callWall != null && spot >= maxPain && spot < callWall) location = "between_max_pain_and_call";
  else if (callWall != null && spot >= callWall) location = "above_call_wall";

  // Suggested next move bias from current location
  let next_move = null;
  if (location === "between_put_and_max_pain" && put_to_max != null) {
    next_move = {
      scenario: "put_wall → max_pain",
      probability_pct: put_to_max,
      opposite_scenario: "max_pain → put_wall",
      opposite_probability_pct: pct((100 - put_to_max) / 100),
    };
  } else if (location === "between_max_pain_and_call" && max_to_call != null) {
    next_move = {
      scenario: "max_pain → call_wall",
      probability_pct: max_to_call,
      opposite_scenario: "call_wall → max_pain",
      opposite_probability_pct: pct((100 - max_to_call) / 100),
    };
  } else if (location === "below_put_wall" && putWall != null && maxPain != null) {
    const p = pct(probHitUpperBeforeLower(Math.max(spot, putWall * 0.98), putWall * 0.95, maxPain));
    next_move = {
      scenario: "reclaim put_wall → max_pain",
      probability_pct: put_to_max,
      note: "Spot is already below put wall; put→max path prob shown for the put/max band.",
    };
  } else if (location === "above_call_wall" && maxPain != null && callWall != null) {
    next_move = {
      scenario: "call_wall → max_pain (mean reversion toward max pain)",
      probability_pct: pct(1 - (max_to_call == null ? 0.5 : max_to_call / 100)),
      note: "Above call wall; opposite of max→call path used as mean-reversion hint.",
    };
  }

  return {
    model: {
      name: "risk_neutral_gbm_r0",
      assumptions: [
        "r ≈ 0",
        "ATM IV used as constant volatility",
        "Path probs = hit upper barrier before lower (GBM)",
        "Expiry zone probs = Black-Scholes N(d2)",
        "NOT a guarantee — dealer flow / news can dominate intraday",
      ],
      spot,
      atm_iv_pct: atmIv,
      years_to_expiry: tYears,
      hours_to_expiry: tYears * 365.25 * 24,
    },
    spot_location: location,
    expiry_zones_pct: expiry_zones,
    transitions,
    highlight: {
      put_wall_to_max_pain_pct: put_to_max,
      max_pain_to_call_wall_pct: max_to_call,
      max_pain_to_put_wall_pct: put_to_max == null ? null : pct((100 - put_to_max) / 100),
      call_wall_to_max_pain_pct: max_to_call == null ? null : pct((100 - max_to_call) / 100),
      next_move,
    },
  };
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const currency = (url.searchParams.get("currency") || "BTC").toUpperCase();
    const symbol = (url.searchParams.get("symbol") || currency).toUpperCase();
    const exchange = url.searchParams.get("exchange") || "Deribit";
    const expiryParam = url.searchParams.get("expiry");
    const apiKey = req.headers.get("cg-api-key") || process.env.COINGLASS_API_KEY || "";

    const [rows, dvol] = await Promise.all([fetchDeribit(currency), fetchDvol(currency)]);
    const byExp = new Map();
    let spot = null;

    for (const r of rows) {
      const name = r.instrument_name || "";
      const parts = name.split("-");
      if (parts.length < 4) continue;
      const exp = parts[1];
      const strike = Number(parts[2]);
      const cp = parts[3];
      const oi = Number(r.open_interest || 0);
      const vol = Number(r.volume || 0);
      const markIv = Number(r.mark_iv || 0);
      if (!Number.isFinite(strike)) continue;
      if (spot == null && Number(r.underlying_price) > 0) spot = Number(r.underlying_price);
      if (!byExp.has(exp)) {
        byExp.set(exp, {
          token: exp,
          date: parseExpiry(exp),
          callOi: {},
          putOi: {},
          callVol: {},
          putVol: {},
          callIv: {},
          putIv: {},
          callOiTotal: 0,
          putOiTotal: 0,
        });
      }
      const bucket = byExp.get(exp);
      if (cp === "C") {
        bucket.callOi[strike] = (bucket.callOi[strike] || 0) + oi;
        bucket.callVol[strike] = (bucket.callVol[strike] || 0) + vol;
        if (markIv > 0) bucket.callIv[strike] = markIv;
        bucket.callOiTotal += oi;
      } else if (cp === "P") {
        bucket.putOi[strike] = (bucket.putOi[strike] || 0) + oi;
        bucket.putVol[strike] = (bucket.putVol[strike] || 0) + vol;
        if (markIv > 0) bucket.putIv[strike] = markIv;
        bucket.putOiTotal += oi;
      }
    }

    const now = Date.now();
    let chosen = null;
    if (expiryParam && byExp.has(expiryParam.toUpperCase())) {
      chosen = byExp.get(expiryParam.toUpperCase());
    } else {
      const candidates = [...byExp.values()]
        .filter((e) => e.date && e.date.getTime() >= now - 6 * 3600 * 1000)
        .filter((e) => e.callOiTotal + e.putOiTotal > 0)
        .sort((a, b) => a.date - b.date);
      chosen = candidates[0] || null;
    }
    if (!chosen || spot == null) {
      return json({ ok: false, error: "No suitable options expiry / spot found" }, 404);
    }

    const maxPain = computeMaxPain(chosen.callOi, chosen.putOi);
    const topCall = topStrike(chosen.callOi);
    const topPut = topStrike(chosen.putOi);
    const putWall = topPut ? topPut.strike : null;
    const callWall = topCall ? topCall.strike : null;

    // ATM IV: nearest strike to spot with available mark_iv
    const strikes = Array.from(
      new Set([...Object.keys(chosen.callIv), ...Object.keys(chosen.putIv)].map(Number))
    ).sort((a, b) => a - b);
    let atmStrike = strikes[0];
    let bestDist = Infinity;
    for (const k of strikes) {
      const d = Math.abs(k - spot);
      if (d < bestDist) {
        bestDist = d;
        atmStrike = k;
      }
    }
    const atmIvParts = [chosen.callIv[atmStrike], chosen.putIv[atmStrike]].filter((x) => x > 0);
    let atmIvRaw =
      atmIvParts.length > 0
        ? atmIvParts.reduce((a, b) => a + b, 0) / atmIvParts.length
        : null;
    const dvolLast = dvol && dvol.last > 0 ? dvol.last : null;
    // If chain mark_iv looks broken vs DVOL, fall back to DVOL for probability model
    let atmIv = atmIvRaw;
    if (atmIv == null && dvolLast != null) atmIv = dvolLast;
    if (atmIv != null && dvolLast != null && (atmIv < dvolLast * 0.4 || atmIv > dvolLast * 2.5)) {
      atmIv = dvolLast;
    }


    // Simple skew: ~5% OTM put IV vs ~5% OTM call IV
    const otmPutK = strikes.filter((k) => k <= spot * 0.95).pop();
    const otmCallK = strikes.find((k) => k >= spot * 1.05);
    const putIvOtm = otmPutK != null ? chosen.putIv[otmPutK] : null;
    const callIvOtm = otmCallK != null ? chosen.callIv[otmCallK] : null;
    const skew = putIvOtm != null && callIvOtm != null ? putIvOtm - callIvOtm : null;

    const tYears = Math.max((chosen.date.getTime() - now) / (365.25 * 24 * 3600 * 1000), 1 / (365.25 * 24));
    const probabilities =
      atmIv != null
        ? buildProbabilities(spot, putWall, maxPain, callWall, atmIv, tYears)
        : null;

    let coinglass = null;
    if (apiKey) {
      const cg = await fetchCoinglassMaxPain(symbol, exchange, apiKey);
      if (cg.ok) {
        const match = (cg.data || []).find((row) => {
          const d = yyMmDdToDate(String(row.date || ""));
          return d && d.toISOString().slice(0, 10) === chosen.date.toISOString().slice(0, 10);
        });
        coinglass = { matched_expiry: match || null };
      } else {
        coinglass = { error: cg.error };
      }
    } else {
      coinglass = {
        skipped: true,
        note: "Set COINGLASS_API_KEY or CG-API-KEY for Coinglass max-pain cross-check.",
      };
    }

    const pcOi =
      chosen.putOiTotal + chosen.callOiTotal > 0
        ? chosen.putOiTotal / (chosen.putOiTotal + chosen.callOiTotal)
        : null;

    return json({
      ok: true,
      currency,
      spot,
      expiry: {
        token: chosen.token,
        iso: chosen.date.toISOString(),
        call_oi_total: chosen.callOiTotal,
        put_oi_total: chosen.putOiTotal,
      },
      levels: {
        put_wall: putWall,
        max_pain: maxPain,
        call_wall: callWall,
      },
      details: {
        put_wall_oi: topPut,
        call_wall_oi: topCall,
        atm_strike: atmStrike,
        atm_iv_pct: atmIv,
        atm_iv_raw_pct: atmIvRaw,
        dvol,
        skew_otm5_put_minus_call_iv: skew,
        put_share_of_oi: pcOi,
      },
      probabilities,
      pine_inputs: {
        put_wall: putWall,
        max_pain: maxPain,
        call_wall: callWall,
        expiry: chosen.token,
        prob_put_to_max_pain_pct: probabilities?.highlight?.put_wall_to_max_pain_pct ?? null,
        prob_max_to_call_pct: probabilities?.highlight?.max_pain_to_call_wall_pct ?? null,
        prob_max_to_put_pct: probabilities?.highlight?.max_pain_to_put_wall_pct ?? null,
        prob_call_to_max_pct: probabilities?.highlight?.call_wall_to_max_pain_pct ?? null,
      },
      coinglass,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}
