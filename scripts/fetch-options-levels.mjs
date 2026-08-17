#!/usr/bin/env node
/**
 * Local helper: print weekly options levels (max pain / call wall / put wall).
 * Usage:
 *   node scripts/fetch-options-levels.mjs
 *   node scripts/fetch-options-levels.mjs BTC
 *   COINGLASS_API_KEY=xxx node scripts/fetch-options-levels.mjs BTC
 */

const currency = (process.argv[2] || "BTC").toUpperCase();
const base = process.env.OPTIONS_LEVELS_URL || "http://127.0.0.1:3000/api/options-levels";
const deribit =
  "https://www.deribit.com/api/v2/public/get_book_summary_by_currency" +
  `?currency=${encodeURIComponent(currency)}&kind=option`;

const MONTHS = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function parseExpiry(token) {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(token);
  if (!m) return null;
  return new Date(Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1]), 8, 0, 0));
}

function computeMaxPain(callOi, putOi) {
  const strikes = [...new Set([...Object.keys(callOi), ...Object.keys(putOi)])]
    .map(Number)
    .sort((a, b) => a - b);
  let best = strikes[0];
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
      best = settle;
    }
  }
  return best;
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
  return { strike: best, open_interest: bestOi };
}

async function fromDeribit() {
  const res = await fetch(deribit);
  const body = await res.json();
  const rows = body.result || [];
  const byExp = new Map();
  for (const r of rows) {
    const parts = String(r.instrument_name || "").split("-");
    if (parts.length < 4) continue;
    const exp = parts[1];
    const strike = Number(parts[2]);
    const cp = parts[3];
    const oi = Number(r.open_interest || 0);
    if (!byExp.has(exp)) {
      byExp.set(exp, { token: exp, date: parseExpiry(exp), callOi: {}, putOi: {}, callT: 0, putT: 0 });
    }
    const b = byExp.get(exp);
    if (cp === "C") {
      b.callOi[strike] = (b.callOi[strike] || 0) + oi;
      b.callT += oi;
    } else if (cp === "P") {
      b.putOi[strike] = (b.putOi[strike] || 0) + oi;
      b.putT += oi;
    }
  }
  const now = Date.now();
  const chosen = [...byExp.values()]
    .filter((e) => e.date && e.date.getTime() >= now - 6 * 3600 * 1000 && e.callT + e.putT > 0)
    .sort((a, b) => a.date - b.date)[0];
  if (!chosen) throw new Error("No future expiry found");
  const maxPain = computeMaxPain(chosen.callOi, chosen.putOi);
  const callWall = topStrike(chosen.callOi);
  const putWall = topStrike(chosen.putOi);
  return {
    expiry: chosen.token,
    expiry_iso: chosen.date.toISOString(),
    max_pain: maxPain,
    call_wall: callWall.strike,
    call_wall_oi: callWall.open_interest,
    put_wall: putWall.strike,
    put_wall_oi: putWall.open_interest,
  };
}

async function maybeCoinglass(expiryIso) {
  const key = process.env.COINGLASS_API_KEY;
  if (!key) return null;
  const url = `https://open-api-v4.coinglass.com/api/option/max-pain?symbol=${currency}&exchange=Deribit`;
  const res = await fetch(url, { headers: { "CG-API-KEY": key } });
  const body = await res.json();
  if (String(body.code) !== "0") return { error: body.msg };
  const day = expiryIso.slice(0, 10);
  const hit = (body.data || []).find((row) => {
    const s = String(row.date || "");
    if (!/^\d{6}$/.test(s)) return false;
    const iso = new Date(Date.UTC(2000 + Number(s.slice(0, 2)), Number(s.slice(2, 4)) - 1, Number(s.slice(4, 6)))).toISOString().slice(0, 10);
    return iso === day;
  });
  return hit || { note: "no matching expiry row", sample: (body.data || []).slice(0, 3) };
}

const levels = await fromDeribit();
const cg = await maybeCoinglass(levels.expiry_iso);
console.log(JSON.stringify({ currency, ...levels, coinglass: cg }, null, 2));
console.log("\nPine inputs:");
console.log(`Put Wall   = ${levels.put_wall}`);
console.log(`Max Pain   = ${levels.max_pain}`);
console.log(`Call Wall  = ${levels.call_wall}`);
console.log(`Expiry     = ${levels.expiry}`);
// silence unused
void base;
