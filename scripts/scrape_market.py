#!/usr/bin/env python3
"""
Market data scraper for MIDCO dashboard.

Works from most cloud/VPS hosts:
  - TGJU live quotes + OHLC histories (bourse, FX, metals, …)
  - shakhesban.com/stocks/list-data (HTML board mirror → market value, trades, impacts, retail flow)

Usually needs Iran IP:
  - TSETMC, IME, parsistahlil membership pages, tradersarena /data

Usage:
  python3 scripts/scrape_market.py
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "data"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )
}

# 1 همت = 10^13 ریال | 1 میلیارد تومان = 10^10 ریال
RIAL_PER_HEMAT = 1e13
RIAL_PER_BILLION_TOMAN = 1e10
TEDPIX_FROM_1401 = "2022/03/21"

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


def fetch(url: str, timeout: int = 45, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def num(x) -> float | None:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", "").replace("٬", "").replace("%", "")
    if not s or s in {"-", "—", "null", "None"}:
        return None
    # scientific notation e.g. 1.84E+15
    try:
        return float(s)
    except ValueError:
        pass
    try:
        return float(re.sub(r"[^\d.-]", "", s))
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
    """Close-only points for sparklines (newest last)."""
    url = f"https://api.tgju.org/v1/market/indicator/summary-table-data/{key}"
    try:
        payload = json.loads(fetch(url))
    except Exception:  # noqa: BLE001
        return []
    points = []
    for row in (payload.get("data") or [])[:limit]:
        value = num(row[3])
        if value is None:
            continue
        points.append({"date": row[6], "dateJalali": row[7], "value": value})
    points.reverse()
    return points


def scrape_tgju_ohlc(key: str = "bourse", length: int = 2800) -> list[dict]:
    """Full OHLC rows for candlesticks. Columns: open, low, high, close, chg, pct, greg, jalali."""
    url = (
        "https://api.tgju.org/v1/market/indicator/summary-table-data/"
        f"{key}?lang=fa&order_dir=asc&start=0&length={length}"
    )
    try:
        payload = json.loads(fetch(url, timeout=60))
    except Exception as exc:  # noqa: BLE001
        print(f"ohlc {key}: {exc}")
        return []
    out: list[dict] = []
    for row in payload.get("data") or []:
        if not isinstance(row, list) or len(row) < 8:
            continue
        o, lo, hi, c = num(row[0]), num(row[1]), num(row[2]), num(row[3])
        if None in (o, lo, hi, c):
            continue
        greg = str(row[6]).replace("-", "/")
        if len(greg) >= 10:
            greg = greg[:10]
        out.append(
            {
                "date": greg,
                "dateJalali": str(row[7]),
                "open": o,
                "high": hi,
                "low": lo,
                "close": c,
            }
        )
    return out


def parse_shakhesban_tbody(tbody: str) -> list[dict]:
    rows: list[dict] = []
    for m in re.finditer(r'<tr\s+data-symbol="([^"]+)">(.*?)</tr>', tbody, re.S):
        symbol = unescape(m.group(1))
        block = m.group(2)
        vals: dict[str, str] = {}
        for td in re.finditer(r'<td[^>]*data-val="([^"]*)"[^>]*data-col="([^"]+)"', block):
            vals[td.group(2)] = unescape(td.group(1))
        for td in re.finditer(r'<td[^>]*data-col="([^"]+)"[^>]*data-val="([^"]*)"', block):
            vals[td.group(1)] = unescape(td.group(2))
        rows.append(
            {
                "symbol": symbol,
                "name": vals.get("info.title") or symbol,
                "marketFa": vals.get("info.market_fa") or "",
                "flow": vals.get("info.flow.title") or "",
                "marketValue": num(vals.get("trades.arzesh_bazar")) or 0.0,
                "tradeValue": num(vals.get("trades.QTotCap")) or 0.0,
                "close": num(vals.get("info.last_price.PClosing")) or 0.0,
                "last": num(vals.get("info.last_trade.PDrCotVal")) or 0.0,
                "changePctClose": num(vals.get("info.last_price.closing_change_percentage")) or 0.0,
                "changePctLast": num(vals.get("info.last_trade.last_change_percentage")) or 0.0,
                "buyIVol": num(vals.get("trades.buy_and_sell.Buy_I_Volume")) or 0.0,
                "sellIVol": num(vals.get("trades.buy_and_sell.Sell_I_Volume")) or 0.0,
            }
        )
    return rows


def scrape_shakhesban_board(max_pages: int = 35) -> list[dict]:
    all_rows: list[dict] = []
    page = 1
    while page <= max_pages:
        qs = urllib.parse.urlencode(
            {
                "limit": 100,
                "page": page,
                "order_col": "trades.QTotCap",
                "order_dir": "desc",
                "_": int(time.time() * 1000),
            }
        )
        url = f"https://www.shakhesban.com/stocks/list-data?{qs}"
        try:
            payload = json.loads(
                fetch(
                    url,
                    timeout=60,
                    headers={
                        "Accept": "application/json, text/javascript, */*; q=0.01",
                        "Referer": "https://www.shakhesban.com/markets/stock",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                ).decode("utf-8", errors="replace")
            )
        except Exception as exc:  # noqa: BLE001
            print(f"shakhesban page {page}: {exc}")
            break
        batch = parse_shakhesban_tbody(payload.get("tbody") or "")
        all_rows.extend(batch)
        print(f"shakhesban page {page}: +{len(batch)} (total {len(all_rows)})")
        if not payload.get("is_more") or not batch:
            break
        page += 1
        time.sleep(0.12)
    return all_rows


def pick_change_pct(row: dict) -> float:
    """Prefer closing %; use last-trade % only inside a normal daily band."""
    close = float(row.get("changePctClose") or 0.0)
    last = float(row.get("changePctLast") or 0.0)
    if close != 0:
        return close
    # خارج از باند روزانه ≈ افزایش سرمایه/بازگشایی — برای تاثیر صفر در نظر بگیر
    if abs(last) <= 7.0:
        return last
    return 0.0


def build_overview_live(stocks_all: list[dict], usd_rial: float | None, tedpix: dict | None) -> dict:
    stocks = [s for s in stocks_all if s.get("marketFa") == "سهام"]
    bourse = [s for s in stocks if "فرابورس" not in (s.get("flow") or "")]
    ifb = [s for s in stocks if "فرابورس" in (s.get("flow") or "")]

    sum_mv = sum(s["marketValue"] for s in stocks)
    sum_trade = sum(s["tradeValue"] for s in stocks)
    retail_buy = sum(s["buyIVol"] * (s["close"] or s["last"] or 0) for s in stocks)
    retail_sell = sum(s["sellIVol"] * (s["close"] or s["last"] or 0) for s in stocks)
    net_retail_bt = (retail_buy - retail_sell) / RIAL_PER_BILLION_TOMAN

    usd_m = None
    if usd_rial and usd_rial > 0:
        usd_m = round(sum_mv / usd_rial / 1e6, 0)

    def impact_rows(universe: list[dict], limit: int = 8) -> tuple[list[dict], list[dict]]:
        scored = []
        for s in universe:
            chg = pick_change_pct(s)
            # پروکسی تاثیر شاخص: تغییر٪ × ارزش بازار (میلیارد تومان)
            score = (chg / 100.0) * (s["marketValue"] / RIAL_PER_BILLION_TOMAN)
            scored.append(
                {
                    "symbol": s["symbol"],
                    "name": s["name"],
                    "impact": round(score, 1),
                    "changePct": round(chg, 2),
                }
            )
        pos = sorted([x for x in scored if x["impact"] > 0], key=lambda r: r["impact"], reverse=True)[:limit]
        neg = sorted([x for x in scored if x["impact"] < 0], key=lambda r: r["impact"])[:limit]
        return (
            [{"symbol": x["symbol"], "impact": x["impact"]} for x in pos],
            [{"symbol": x["symbol"], "impact": x["impact"]} for x in neg],
        )

    b_pos, b_neg = impact_rows(bourse)
    i_pos, i_neg = impact_rows(ifb)

    top_trades = sorted(stocks, key=lambda s: s["tradeValue"], reverse=True)[:15]
    top_trades_out = [
        {
            "name": s["symbol"],
            "valueBr": round(s["tradeValue"] / RIAL_PER_BILLION_TOMAN, 1),
        }
        for s in top_trades
        if s["tradeValue"] > 0
    ]

    return {
        "ok": True,
        "source": "shakhesban+tgju",
        "asOf": datetime.now(timezone.utc).isoformat(),
        "stockCount": len(stocks),
        "bourseCount": len(bourse),
        "ifbCount": len(ifb),
        "totalMarketValueHmt": round(sum_mv / RIAL_PER_HEMAT, 1),
        "totalMarketValueUsdM": usd_m,
        "usdRate": usd_rial,
        "totalTradeValueHmt": round(sum_trade / RIAL_PER_HEMAT, 2),
        "totalTradeValueBillionToman": round(sum_trade / RIAL_PER_BILLION_TOMAN, 1),
        "retailMoneyFlowDailyBillionToman": round(net_retail_bt, 1),
        "tedpix": tedpix,
        "impacts": {
            "boursePos": b_pos,
            "bourseNeg": b_neg,
            "ifbPos": i_pos,
            "ifbNeg": i_neg,
        },
        "topTrades": top_trades_out,
        "notes": [
            "ارزش بازار/معاملات از تجمیع تابلوی شاخص‌بان (سهام بورس+فرابورس).",
            "ارزش دلاری = ارزش بازار ریالی ÷ نرخ دلار آزاد TGJU.",
            "خالص پول حقیقی: برآورد خرید/فروش حقیقی×قیمت (جایگزین پارسی‌تحلیل تا دسترسی عضویت/IP ایران).",
            "تاثیر مثبت/منفی: پروکسی تغییر٪×ارزش بازار — جایگزین دقیق TSETMC با IP ایران.",
        ],
    }


def candles_from_1401(ohlc: list[dict]) -> list[dict]:
    return [c for c in ohlc if (c.get("date") or "") >= TEDPIX_FROM_1401]


def scrape_tsetmc() -> dict:
    endpoints = [
        "https://cdn.tsetmc.com/api/Index/GetIndexB1LastDay/32097828799138957",
        "https://cdn.tsetmc.com/api/ClosingPrice/GetMarketWatch?market=0&industrialGroup=&boardId=0&paperTypes[0]=1",
    ]
    last_err = "empty"
    for url in endpoints:
        try:
            raw = fetch(url, timeout=20)
            if not raw:
                continue
            return {"ok": True, "source": "tsetmc-cdn", "endpoint": url, "data": json.loads(raw)}
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
    return {"ok": False, "source": "tsetmc", "status": "blocked", "error": last_err}


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
        sectors.append(
            {
                "name": name,
                "color": color,
                "count": len(vals),
                "avgChangePct": round(avg_pct, 2),
                "members": keys,
            }
        )
    return sectors


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("TGJU ajax…")
    tgju = scrape_tgju_ajax()
    quotes = tgju.get("quotes") or {}
    usd = (quotes.get("price_dollar_rl") or {}).get("value")
    tedpix = quotes.get("bourse")
    print(f"TEDPIX={tedpix} USD={usd}")

    print("TGJU histories…")
    histories = {k: scrape_tgju_history(k) for k in HIST_KEYS}

    print("TEDPIX OHLC from 1401…")
    ohlc = scrape_tgju_ohlc("bourse", 2800)
    candles = candles_from_1401(ohlc)
    # also extend close history for charts
    if candles:
        histories["bourse"] = [
            {"date": c["date"], "dateJalali": c["dateJalali"], "value": c["close"]} for c in candles
        ]
    print(f"candles1401={len(candles)}")

    print("shakhesban board…")
    board = scrape_shakhesban_board()
    overview_live = build_overview_live(board, usd, tedpix)
    print(
        f"MV={overview_live['totalMarketValueHmt']} همت | "
        f"USD={overview_live['totalMarketValueUsdM']} m$ | "
        f"trade={overview_live['totalTradeValueHmt']} همت | "
        f"retail={overview_live['retailMoneyFlowDailyBillionToman']}"
    )

    tsetmc = scrape_tsetmc()
    ime = scrape_ime()
    sectors = build_sectors(quotes)

    market = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "infra": {
            "tgju": "no special infra — works from Cloudflare/most VPS",
            "shakhesban": "public list-data HTML board — market value / trades / retail proxy",
            "tsetmc": "usually needs Iran IP / office network",
            "ime": "usually needs Iran IP; parser can be extended when reachable",
            "parsistahlil": "latest market status often membership-locked",
            "tradersarena": "/data endpoints need auth",
            "custeel": "paid; interim uses TGJU iron-ore/steel-coil + FRED",
            "fred": "free API key recommended; CSV snapshot via scripts/fetch_fred.py",
        },
        "tgju": tgju,
        "histories": {k: v for k, v in histories.items() if v},
        "candles1401": candles,
        "overviewLive": overview_live,
        "sectors": sectors,
        "tsetmc": tsetmc,
        "ime": ime,
    }

    scraped = {
        "updatedAt": market["updatedAt"],
        "tgjuBourse": tedpix,
        "overviewLive": {
            k: overview_live[k]
            for k in (
                "totalMarketValueHmt",
                "totalMarketValueUsdM",
                "usdRate",
                "totalTradeValueHmt",
                "retailMoneyFlowDailyBillionToman",
                "stockCount",
            )
            if k in overview_live
        },
        "candles1401Count": len(candles),
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
    print(f"tsetmc ok={tsetmc.get('ok')} ime ok={ime.get('ok')} overview ok={overview_live.get('ok')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
