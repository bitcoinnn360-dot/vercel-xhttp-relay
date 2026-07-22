#!/usr/bin/env python3
"""
Market data scraper for MIDCO dashboard.

Works from most cloud/VPS hosts:
  - TGJU live quotes + OHLC histories (bourse, FX, metals, …)
  - shakhesban indices (TEDPIX / equal-weight / IFB) + board aggregate
  - parsistahlil.ir public «گزارش وضعیت بازار» (retail trades + daily money flow)

Needs Iran IP:
  - TSETMC «در یک نگاه» (official market value + TSE/IFB trade value + index impacts)
  - IME, tradersarena /data
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


def scrape_shakhesban_indices() -> dict:
    """Live TEDPIX / equal-weight / IFB from shakhesban markets/index (TSETMC mirror)."""
    html = fetch("https://www.shakhesban.com/markets/index", timeout=40).decode("utf-8", errors="replace")
    wanted = {
        "ش-کل-بورس": "tedpix",
        "ش-کل-هم-وزن": "equalWeight",
        "ش-کل-فرابورس": "ifb",
    }
    out: dict[str, dict] = {}
    for m in re.finditer(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        block = m.group(1)
        hm = re.search(r'/markets/index/([^"\']+)".*?<h2[^>]*>(.*?)</h2>', block, re.S)
        if not hm:
            continue
        slug = unescape(hm.group(1))
        title = unescape(re.sub("<.*?>", "", hm.group(2))).strip()
        key = wanted.get(slug)
        if not key:
            continue
        vals: dict[str, str] = {}
        for td in re.finditer(r'<td[^>]*data-val="([^"]*)"[^>]*data-col="([^"]+)"', block):
            vals[td.group(2)] = unescape(td.group(1))
        for td in re.finditer(r'<td[^>]*data-col="([^"]+)"[^>]*data-val="([^"]*)"', block):
            vals[td.group(1)] = unescape(td.group(2))
        value = num(vals.get("value") or vals.get("info.last_trade.PDrCotVal"))
        change = num(vals.get("change") or vals.get("info.last_trade.last_change"))
        pct_raw = num(vals.get("info.last_trade.last_change_percentage") or vals.get("percent"))
        # shakhesban sometimes stores ratio (0.0069) instead of percent (0.69)
        change_pct = None
        if pct_raw is not None:
            change_pct = pct_raw * 100.0 if abs(pct_raw) < 1 else pct_raw
        elif value and change is not None and value != change:
            prev = value - change
            if prev:
                change_pct = (change / prev) * 100.0
        out[key] = {
            "name": title,
            "value": value,
            "change": change,
            "changePct": round(change_pct, 2) if change_pct is not None else None,
            "source": "shakhesban",
            "slug": slug,
        }
    return out


def scrape_parsistahlil_market_status() -> dict:
    """Latest retail trades + real-money flow from parsistahlil.ir public report pages."""
    try:
        home = fetch("https://parsistahlil.ir/", timeout=40).decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}

    links = sorted(
        set(
            re.findall(
                r"/contents/(\d+)-%DA%AF%D8%B2%D8%A7%D8%B1%D8%B4-%D9%88%D8%B6%D8%B9%DB%8C%D8%AA-%D8%A8%D8%A7%D8%B2%D8%A7%D8%B1-[^\"'\\s]+",
                home,
            )
        ),
        key=lambda x: int(x),
        reverse=True,
    )
    if not links:
        # fallback: any market-status content id
        links = sorted(set(re.findall(r"/contents/(\d+)-[^\"'\\s]*خرد[^\"'\\s]*", home.replace("\\/", "/"))), key=lambda x: int(x), reverse=True)

    slug = urllib.parse.quote("گزارش-وضعیت-بازار-ارزش-معاملات-خرد-و-ورود-و-خروج-پول-حقیقی")
    last_err = "no report link"
    for cid in links[:6]:
        url = f"https://parsistahlil.ir/contents/{cid}-{slug}"
        try:
            html = fetch(url, timeout=40).decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            continue
        text = re.sub(r"<script[\s\S]*?</script>", " ", html)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text)

        retail = None
        m = re.search(
            r"معاملات\s*#?خرد.*?مبلغ\s*([\d,]+)\s*میلیارد",
            text,
        ) or re.search(r"مبلغ\s*([\d,]+)\s*میلیارد تومان بود", text)
        if m:
            retail = num(m.group(1))

        total_trades = None
        m = re.search(r"ارزش کل معاملات امروز بازار\s*([\d,]+)\s*میلیارد", text)
        if m:
            total_trades = num(m.group(1))

        flow = None
        m = re.search(r"مبلغ\s*([\d,]+)\s*میلیارد تومان\s*(ورود|خروج)\s*حقیقی", text)
        if m:
            flow = num(m.group(1))
            if m.group(2) == "خروج" and flow is not None:
                flow = -abs(flow)
            elif flow is not None:
                flow = abs(flow)
        else:
            m = re.search(r"(ورود|خروج)\s*حقیقی از بازار داشته ایم.*?مبلغ\s*([\d,]+)", text)
            # reverse order variants already covered

        date_j = None
        m = re.search(r"مورخ\s*(\d{1,2}\s*تیر\s*\d{4}|\d{4}/\d{2}/\d{2})", text)
        if m:
            date_j = m.group(1).strip()

        if retail is not None or flow is not None:
            return {
                "ok": True,
                "source": "parsistahlil.ir",
                "contentId": cid,
                "url": url,
                "dateJalali": date_j,
                "retailTradeValueBillionToman": retail,
                "totalTradeValueBillionToman": total_trades,
                "retailMoneyFlowDailyBillionToman": flow,
            }
        last_err = f"content {cid} parsed but no numbers"
    return {"ok": False, "error": last_err}


def build_overview_live(
    stocks_all: list[dict],
    usd_rial: float | None,
    indices: dict,
    tgju_tedpix: dict | None,
    pars: dict,
    tsetmc_ok: bool,
) -> dict:
    stocks = [s for s in stocks_all if s.get("marketFa") == "سهام"]
    bourse = [s for s in stocks if "فرابورس" not in (s.get("flow") or "")]
    ifb = [s for s in stocks if "فرابورس" in (s.get("flow") or "")]

    sum_mv = sum(s["marketValue"] for s in stocks)
    sum_trade = sum(s["tradeValue"] for s in stocks)

    usd_m = None
    if usd_rial and usd_rial > 0 and sum_mv > 0:
        usd_m = round(sum_mv / usd_rial / 1e6, 0)

    # Top trades by value (تابلو) — not the same as TSETMC impact list
    top_trades = sorted(stocks, key=lambda s: s["tradeValue"], reverse=True)[:15]
    top_trades_out = [
        {"name": s["symbol"], "valueBr": round(s["tradeValue"] / RIAL_PER_BILLION_TOMAN, 1)}
        for s in top_trades
        if s["tradeValue"] > 0
    ]

    ted = indices.get("tedpix") or {}
    eq = indices.get("equalWeight") or {}
    ifb_idx = indices.get("ifb") or {}
    if not ted and tgju_tedpix:
        ted = {
            "name": "شاخص کل بورس",
            "value": tgju_tedpix.get("value"),
            "change": tgju_tedpix.get("change"),
            "changePct": tgju_tedpix.get("changePct"),
            "source": "tgju",
        }

    board_mv = round(sum_mv / RIAL_PER_HEMAT, 1)
    board_trade = round(sum_trade / RIAL_PER_HEMAT, 2)

    # Prefer parsistahlil retail flow/trades when available
    retail_flow = pars.get("retailMoneyFlowDailyBillionToman") if pars.get("ok") else None
    retail_trades_bt = pars.get("retailTradeValueBillionToman") if pars.get("ok") else None
    # کل معاملات رسمی باید از TSETMC باشد؛ پارسیس «کل بازار» شامل اوراق و غیره است
    total_trade_hmt = None
    total_trade_source = None
    if tsetmc_ok:
        total_trade_source = "tsetmc"
    else:
        total_trade_hmt = board_trade
        total_trade_source = "shakhesban-board-interim"

    notes = []
    blocked = []
    if not tsetmc_ok:
        blocked.append("tsetmc")
        notes.append(
            "TSETMC از این سرور قطع است (Connection reset) — ارزش بازار/معاملات/تاثیر رسمی «در یک نگاه» و سورت تاثیر نیاز به IP ایران دارد."
        )
    notes.append(
        f"ارزش بازار فعلی ({board_mv} همت) تجمیع تابلوی شاخص‌بان (سهام بورس+فرابورس) است؛ با عدد رسمی TSETMC ممکن است فرق کند."
    )
    if usd_m is not None:
        notes.append("ارزش دلاری = همین ارزش بازار ÷ دلار آزاد TGJU.")
    if indices:
        notes.append("شاخص کل / هم‌وزن / فرابورس از شاخص‌بان (آینه بازار، نه PDF).")
    if pars.get("ok"):
        notes.append(
            f"پارسیس‌تحلیل: معاملات خرد={retail_trades_bt} و خالص پول حقیقی روزانه={retail_flow} میلیارد تومان"
            + (f" ({pars.get('dateJalali')})" if pars.get("dateJalali") else "")
            + "."
        )
    else:
        blocked.append("parsistahlil")
        notes.append(f"پارسیس‌تحلیل خوانده نشد: {pars.get('error')}")
    notes.append("خالص ورود/خروج از ابتدای ۱۴۰۴ از گزارش PDF نگه داشته شده.")
    notes.append("تاثیر مثبت/منفی تا دسترسی TSETMC از seed گزارش می‌ماند (سورت پروکسی حذف شد).")

    return {
        "ok": True,
        "asOf": datetime.now(timezone.utc).isoformat(),
        "indices": {
            "tedpix": ted or None,
            "equalWeight": eq or None,
            "ifb": ifb_idx or None,
        },
        "stockCount": len(stocks),
        "bourseCount": len(bourse),
        "ifbCount": len(ifb),
        # Official TSETMC glance fields — null until Iran IP
        "tsetmcMarketValueHmt": None,
        "tsetmcTradeValueHmt": None,
        "impactsFromTsetmc": False,
        # Interim board aggregate
        "totalMarketValueHmt": board_mv,
        "totalMarketValueUsdM": usd_m,
        "marketValueSource": "shakhesban-board-interim",
        "usdRate": usd_rial,
        "totalTradeValueHmt": total_trade_hmt,
        "totalTradeValueSource": total_trade_source,
        "totalTradeValueBillionToman": round((total_trade_hmt or 0) * 1000, 1) if total_trade_hmt is not None else None,
        "retailTradeValueBillionToman": retail_trades_bt,
        "retailTradeValueHmt": round(retail_trades_bt / 1000.0, 2) if retail_trades_bt else None,
        "retailMoneyFlowDailyBillionToman": retail_flow,
        "retailMoneyFlowYtdFromPdf": True,
        "impacts": None,  # do not overwrite seed with fake proxy
        "topTrades": top_trades_out,
        "topTradesSource": "shakhesban-board",
        "parsistahlil": pars,
        "blocked": blocked,
        "notes": notes,
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

    print("shakhesban indices (equal-weight / IFB)…")
    indices = scrape_shakhesban_indices()
    print("indices", {k: v.get("value") for k, v in indices.items()})

    print("TGJU histories…")
    histories = {k: scrape_tgju_history(k) for k in HIST_KEYS}

    print("TEDPIX OHLC from 1401…")
    ohlc = scrape_tgju_ohlc("bourse", 2800)
    candles = candles_from_1401(ohlc)
    if candles:
        histories["bourse"] = [
            {"date": c["date"], "dateJalali": c["dateJalali"], "value": c["close"]} for c in candles
        ]
    print(f"candles1401={len(candles)}")

    print("parsistahlil market status…")
    pars = scrape_parsistahlil_market_status()
    print("pars", {k: pars.get(k) for k in ("ok", "retailTradeValueBillionToman", "retailMoneyFlowDailyBillionToman", "totalTradeValueBillionToman", "dateJalali", "error")})

    print("shakhesban board…")
    board = scrape_shakhesban_board()

    tsetmc = scrape_tsetmc()
    overview_live = build_overview_live(board, usd, indices, tedpix, pars, bool(tsetmc.get("ok")))
    print(
        f"MV={overview_live['totalMarketValueHmt']} همت | "
        f"USD={overview_live['totalMarketValueUsdM']} m$ | "
        f"trade={overview_live['totalTradeValueHmt']} همت ({overview_live['totalTradeValueSource']}) | "
        f"retailFlow={overview_live['retailMoneyFlowDailyBillionToman']}"
    )

    ime = scrape_ime()
    sectors = build_sectors(quotes)

    market = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "infra": {
            "tgju": "TEDPIX + USD live",
            "shakhesban": "equal-weight + IFB indices + board aggregate (interim MV/trades)",
            "parsistahlil": "retail trades + daily real-money flow from public report pages (.ir)",
            "tsetmc": "BLOCKED from this host — needs Iran IP for در یک نگاه + index impacts",
            "ime": "usually needs Iran IP",
            "tradersarena": "/data endpoints need auth",
            "custeel": "paid; interim uses TGJU iron-ore/steel-coil + FRED",
            "fred": "scripts/fetch_fred.py",
        },
        "tgju": tgju,
        "histories": {k: v for k, v in histories.items() if v},
        "candles1401": candles,
        "overviewLive": overview_live,
        "sectors": sectors,
        "tsetmc": tsetmc,
        "ime": ime,
        "parsistahlil": pars,
    }

    scraped = {
        "updatedAt": market["updatedAt"],
        "indices": overview_live.get("indices"),
        "overviewLive": {
            k: overview_live.get(k)
            for k in (
                "totalMarketValueHmt",
                "totalMarketValueUsdM",
                "usdRate",
                "totalTradeValueHmt",
                "totalTradeValueSource",
                "retailTradeValueBillionToman",
                "retailMoneyFlowDailyBillionToman",
                "marketValueSource",
                "impactsFromTsetmc",
                "blocked",
                "stockCount",
            )
        },
        "candles1401Count": len(candles),
        "tsetmc": tsetmc,
        "ime": ime,
        "parsistahlil": pars,
    }

    (OUT_DIR / "market.json").write_text(json.dumps(market, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "scraped.json").write_text(json.dumps(scraped, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT_DIR / 'market.json'}")
    print(f"tgju quotes={tgju.get('quoteCount')} histories={len(market['histories'])}")
    print(f"tsetmc ok={tsetmc.get('ok')} ime ok={ime.get('ok')} overview ok={overview_live.get('ok')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
