#!/usr/bin/env python3
"""
Market data scraper for MIDCO dashboard.

What works from most cloud/VPS environments:
  - TGJU live quotes + histories (bourse, FX, metals, energy, iron ore)

What usually needs an Iran IP / office network:
  - TSETMC detailed market watch
  - IME (بورس کالا) trade tables

Usage:
  python scripts/scrape_market.py
  # writes public/data/market.json and public/data/scraped.json

Optional cron on any always-on machine (Iran VPS recommended for TSETMC/IME):
  */15 * * * * cd /path/to/repo && python3 scripts/scrape_market.py
"""
from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "data"
UA = {"User-Agent": "Mozilla/5.0 (compatible; MIDCODashboard/1.1)"}

TGJU_LIVE_KEYS = [
    "bourse",
    "price_dollar_rl",
    "ons",
    "sekee",
    "copper",
    "aluminium",
    "zinc",
    "oil_brent",
    "crypto-bitcoin",
    "base-us-iron-ore",
    "base-us-steel-coil",
    "base-us-aluminum",
    "base-us-zinc",
]

HIST_KEYS = [
    "bourse",
    "ons",
    "price_dollar_rl",
    "sekee",
    "copper",
    "aluminium",
    "zinc",
    "oil_brent",
    "crypto-bitcoin",
    "base-us-iron-ore",
    "base-us-steel-coil",
]


def fetch(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def num(x) -> float | None:
    if x is None:
        return None
    try:
        return float(re.sub(r"[^\d.-]", "", str(x).replace(",", "")))
    except ValueError:
        return None


def scrape_tgju_ajax() -> dict:
    raw = json.loads(fetch("https://call2.tgju.org/ajax.json"))
    current = raw.get("current") or {}
    quotes = {}
    for key in TGJU_LIVE_KEYS:
        row = current.get(key) or {}
        if not row:
            continue
        change_pct = num(row.get("dp")) or 0.0
        change = num(row.get("d")) or 0.0
        if row.get("dt") == "low" or change_pct < 0:
            change = -abs(change)
            change_pct = -abs(change_pct)
        quotes[key] = {
            "value": num(row.get("p")),
            "change": change,
            "changePct": change_pct,
            "high": num(row.get("h")),
            "low": num(row.get("l")),
            "time": row.get("t") or row.get("t_en"),
            "source": "tgju",
        }
    return {"quotes": quotes, "quoteCount": len(quotes)}


def scrape_tgju_history(key: str, limit: int = 120) -> list[dict]:
    url = f"https://api.tgju.org/v1/market/indicator/summary-table-data/{key}"
    try:
        payload = json.loads(fetch(url))
    except Exception:
        return []
    points = []
    for row in (payload.get("data") or [])[:limit]:
        value = num(row[3])
        if value is None:
            continue
        points.append({"date": row[6], "dateJalali": row[7], "value": value})
    points.reverse()
    return points


def scrape_tsetmc() -> dict:
    """Try public CDN; typically blocked outside Iran."""
    endpoints = [
        "https://cdn.tsetmc.com/api/Index/GetIndexB1LastDay/32097828799138957",
        "https://cdn.tsetmc.com/api/ClosingPrice/GetMarketWatch?market=0&industrialGroup=&boardId=0&paperTypes[0]=1",
    ]
    for url in endpoints:
        try:
            raw = fetch(url, timeout=20)
            if not raw:
                continue
            return {"ok": True, "source": "tsetmc-cdn", "endpoint": url, "data": json.loads(raw)}
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
    return {"ok": False, "source": "tsetmc", "status": "blocked", "error": last_err if "last_err" in locals() else "empty"}


def scrape_ime() -> dict:
    try:
        html = fetch("https://www.ime.co.ir/", timeout=20).decode("utf-8", errors="replace")
        title = re.search(r"<title>(.*?)</title>", html, re.I)
        return {
            "ok": True,
            "source": "ime",
            "title": title.group(1).strip() if title else None,
            "bytes": len(html),
            "note": "Homepage reachable; trade table endpoints still need dedicated parsers.",
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "source": "ime", "status": "blocked", "error": str(exc)}


def build_sectors(quotes: dict) -> list[dict]:
    """GuruFocus-like sector cards derived from available live quotes."""
    mapping = [
        ("بورس ایران", ["bourse"], "#0b3d6e"),
        ("فلزات اساسی", ["copper", "aluminium", "zinc"], "#b45309"),
        ("انرژی", ["oil_brent"], "#1e3a5f"),
        ("ارز و طلا", ["price_dollar_rl", "ons", "sekee"], "#0e7490"),
        ("فولاد / سنگ‌آهن", ["base-us-iron-ore", "base-us-steel-coil"], "#334155"),
        ("کریپتو", ["crypto-bitcoin"], "#c2410c"),
    ]
    sectors = []
    for name, keys, color in mapping:
        vals = [quotes[k] for k in keys if k in quotes and quotes[k].get("value") is not None]
        if not vals:
            continue
        avg_pct = sum(v.get("changePct") or 0 for v in vals) / len(vals)
        sectors.append({
            "name": name,
            "color": color,
            "count": len(vals),
            "avgChangePct": round(avg_pct, 2),
            "members": keys,
        })
    return sectors


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tgju = scrape_tgju_ajax()
    histories = {k: scrape_tgju_history(k) for k in HIST_KEYS}
    tsetmc = scrape_tsetmc()
    ime = scrape_ime()
    sectors = build_sectors(tgju.get("quotes") or {})

    market = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "infra": {
            "tgju": "no special infra — works from Cloudflare/most VPS",
            "tsetmc": "usually needs Iran IP / office network",
            "ime": "usually needs Iran IP; parser can be extended when reachable",
            "custeel": "paid; interim uses TGJU iron-ore/steel-coil + FRED",
            "fred": "free API key recommended; CSV snapshot via scripts/fetch_fred.py",
        },
        "tgju": tgju,
        "histories": {k: v for k, v in histories.items() if v},
        "sectors": sectors,
        "tsetmc": tsetmc,
        "ime": ime,
    }

    scraped = {
        "updatedAt": market["updatedAt"],
        "tgjuBourse": (tgju.get("quotes") or {}).get("bourse"),
        "tsetmc": tsetmc,
        "ime": ime,
        "custeelAlternative": {
            "providers": ["tgju:base-us-iron-ore", "tgju:base-us-steel-coil", "fred:PIORECRUSDM"],
        },
    }

    (OUT_DIR / "market.json").write_text(json.dumps(market, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "scraped.json").write_text(json.dumps(scraped, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT_DIR / 'market.json'}")
    print(f"tgju quotes={tgju.get('quoteCount')} histories={len(market['histories'])}")
    print(f"tsetmc ok={tsetmc.get('ok')} ime ok={ime.get('ok')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
