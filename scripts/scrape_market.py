#!/usr/bin/env python3
"""
Market data scraper for MIDCO dashboard.

Works from most cloud/VPS hosts:
  - TGJU live quotes + OHLC histories (bourse, FX, metals, …)
  - shakhesban indices (TEDPIX / equal-weight / IFB) + board aggregate
  - parsistahlil.ir public «گزارش وضعیت بازار» (retail trades + daily money flow)
  - SourceArena (اکوسیستم Traders Arena) «در یک نگاه» بورس + فرابورس → ارزش بازار رسمی

Needs Iran IP / login:
  - IME
Live without login:
  - tradersarena.ir/data/market (order book depth + per-capita pulse)
"""
from __future__ import annotations

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "data"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )
}

# 1 همت = 10^13 ریال | 1 میلیارد تومان = 10^10 ریال | 1 همت = 10_000 میلیارد ریال
RIAL_PER_HEMAT = 1e13
RIAL_PER_BILLION_TOMAN = 1e10
RIAL_PER_MILLION_TOMAN = 1e7
BILLION_RIAL_PER_HEMAT = 10_000.0
TEDPIX_FROM_1401 = "2022/03/21"

# Demo/public token used in SourceArena docs — override with SOURCEARENA_TOKEN
SOURCEARENA_TOKEN = os.environ.get("SOURCEARENA_TOKEN", "bba6d330a87bac533f18cc245d3baeaa")
SOURCEARENA_API = "https://apis.sourcearena.ir/api/"
RAHAVARD_API = "https://rahavard365.com/api/v2"
BOARD_CACHE_PATH = OUT_DIR / "sourcearena_all.json"
PULSE_PATH = OUT_DIR / "market_pulse.json"
IMPACTS_CACHE_PATH = OUT_DIR / "impacts_cache.json"
SSL_INSECURE = ssl._create_unverified_context()

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


def fetch(url: str, timeout: int = 45, headers: dict | None = None, insecure: bool = False) -> bytes:
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    ctx = SSL_INSECURE if insecure else None
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return resp.read()


def fetch_json_retry(
    url: str,
    *,
    timeout: int = 25,
    attempts: int = 4,
    headers: dict | None = None,
    insecure: bool = False,
) -> object:
    last: Exception | None = None
    for i in range(attempts):
        try:
            raw = fetch(url, timeout=timeout, headers=headers, insecure=insecure)
            return json.loads(raw.decode("utf-8", errors="replace"))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.8 * (i + 1))
    raise last or RuntimeError(f"fetch failed: {url}")


def tehran_now() -> datetime:
    return datetime.now(ZoneInfo("Asia/Tehran"))


def jalali_today() -> dict:
    """Live Jalali date in Asia/Tehran (numeric YYYY/MM/DD)."""
    now = tehran_now()
    # Intl-style via algorithm: use datetime + jdatetime if available, else approximate via format
    try:
        import jdatetime  # type: ignore

        j = jdatetime.datetime.fromgregorian(datetime=now)
        return {
            "dateJalali": f"{j.year:04d}/{j.month:02d}/{j.day:02d}",
            "dateGregorian": now.date().isoformat(),
            "time": now.strftime("%H:%M"),
        }
    except Exception:
        # Fallback: Persian calendar via glibc when available
        try:
            fa = now.strftime("%Y/%m/%d")  # may still be Gregorian
        except Exception:
            fa = now.date().isoformat()
        # Manual Gregorian→Jalali
        gy, gm, gd = now.year, now.month, now.day
        g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
        gy2 = gy + 1 if gm > 2 else gy
        days = 355666 + (365 * gy) + ((gy2 + 3) // 4) - ((gy2 + 99) // 100) + ((gy2 + 399) // 400) + gd + g_d_m[gm - 1]
        jy = -1595 + (33 * (days // 12053))
        days %= 12053
        jy += 4 * (days // 1461)
        days %= 1461
        if days > 365:
            jy += (days - 1) // 365
            days = (days - 1) % 365
        if days < 186:
            jm = 1 + days // 31
            jd = 1 + (days % 31)
        else:
            jm = 7 + (days - 186) // 30
            jd = 1 + ((days - 186) % 30)
        return {
            "dateJalali": f"{jy:04d}/{jm:02d}/{jd:02d}",
            "dateGregorian": now.date().isoformat(),
            "time": now.strftime("%H:%M"),
        }


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
        yesterday = num(vals.get("info.PriceYesterday")) or 0.0
        close = num(vals.get("info.last_price.PClosing")) or 0.0
        last = num(vals.get("info.last_trade.PDrCotVal")) or 0.0
        close_chg = num(vals.get("info.last_price.closing_change"))
        last_chg = num(vals.get("info.last_trade.last_change"))
        if close_chg is None and close and yesterday:
            close_chg = close - yesterday
        if last_chg is None and last and yesterday:
            last_chg = last - yesterday
        # Prefer قیمت پایانی (final) for impact; fall back to last trade.
        final_chg = close_chg if close_chg not in (None, 0) else last_chg
        rows.append(
            {
                "symbol": symbol,
                "name": vals.get("info.title") or symbol,
                "marketFa": vals.get("info.market_fa") or "",
                "flow": vals.get("info.flow.title") or "",
                "marketValue": num(vals.get("trades.arzesh_bazar")) or 0.0,
                "tradeValue": num(vals.get("trades.QTotCap")) or 0.0,
                "close": close,
                "last": last,
                "yesterday": yesterday,
                "closeChg": close_chg,
                "lastChg": last_chg,
                "finalChg": final_chg,
                "changePctClose": num(vals.get("info.last_price.closing_change_percentage")) or 0.0,
                "changePctLast": num(vals.get("info.last_trade.last_change_percentage")) or 0.0,
                "buyIVol": num(vals.get("trades.buy_and_sell.Buy_I_Volume")) or 0.0,
                "sellIVol": num(vals.get("trades.buy_and_sell.Sell_I_Volume")) or 0.0,
                "buyNVol": num(vals.get("trades.buy_and_sell.Buy_N_Volume")) or 0.0,
                "sellNVol": num(vals.get("trades.buy_and_sell.Sell_N_Volume")) or 0.0,
                "orderBuyVol": num(vals.get("demands.1_0")) or 0.0,
                "orderBuyCnt": num(vals.get("demands.1_1")) or 0.0,
                "orderBuyPx": num(vals.get("demands.1_2")) or 0.0,
                "orderSellPx": num(vals.get("demands.1_3")) or 0.0,
                "orderSellCnt": num(vals.get("demands.1_4")) or 0.0,
                "orderSellVol": num(vals.get("demands.1_5")) or 0.0,
                "tradeCount": num(vals.get("trades.ZTotTran")) or 0.0,
            }
        )
    return rows


def _normalize_symbol_key(s: str) -> str:
    return re.sub(r"[\s\u200c\u200d\xa0]+", "", str(s or "")).strip()


def fetch_equity_fund_symbol_set() -> set[str]:
    """TradersArena heatmap «صندوق های سهامی» (اهرم/بخشی/شاخصی/کلاسیک)."""
    out: set[str] = set()
    try:
        raw = fetch(
            "https://tradersarena.ir/data/heatmap/stock-funds",
            timeout=30,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://tradersarena.ir/",
            },
        )
        rows = json.loads(raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else raw)
        if isinstance(rows, list):
            for row in rows:
                key = _normalize_symbol_key((row or {}).get("name") or "")
                if key:
                    out.add(key)
    except Exception as exc:  # noqa: BLE001
        print(f"equity fund heatmap: {exc}")
    out.add(_normalize_symbol_key("دارایکم"))
    out.add(_normalize_symbol_key("دارا یکم"))
    return out


def is_equity_fund_row(row: dict, fund_set: set[str]) -> bool:
    if (row.get("marketFa") or "") != "صندوق":
        return False
    key = _normalize_symbol_key(row.get("symbol") or "")
    if fund_set and key in fund_set:
        return True
    flow = row.get("flow") or ""
    title = row.get("name") or row.get("title") or ""
    if "بورس کالا" in flow:
        return False
    if re.search(r"(طلا|سکه|نقره|زعفران|درآمد\s*ثابت|\-ثابت|املاک|مستغلات)", title):
        return False
    if re.search(r"(سهامی|در سهام|اهرم|بخشی|شاخصی|مختلط)", title):
        return True
    return False


def build_top_trades(rows: list[dict], fund_set: set[str], limit: int = 12) -> list[dict]:
    cand = []
    for s in rows or []:
        tv = float(s.get("tradeValue") or 0)
        if tv <= 0:
            continue
        market_fa = s.get("marketFa") or ""
        if not market_fa or market_fa == "سهام" or is_equity_fund_row(s, fund_set):
            cand.append(s)
    cand.sort(key=lambda s: float(s.get("tradeValue") or 0), reverse=True)
    return [
        {"name": s["symbol"], "valueBr": round(float(s["tradeValue"]) / RIAL_PER_BILLION_TOMAN, 1)}
        for s in cand[:limit]
    ]


def scrape_shakhesban_market_pages(market: str, max_pages: int = 3, order_col: str = "trades.QTotCap") -> list[dict]:
    all_rows: list[dict] = []
    for page in range(1, max_pages + 1):
        qs = urllib.parse.urlencode(
            {
                "limit": 100,
                "page": page,
                "order_col": order_col,
                "order_dir": "desc",
                "market": market,
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
                        "Referer": "https://www.shakhesban.com/",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                ).decode("utf-8", errors="replace")
            )
        except Exception as exc:  # noqa: BLE001
            print(f"shakhesban {market} page {page}: {exc}")
            break
        batch = parse_shakhesban_tbody(payload.get("tbody") or "")
        all_rows.extend(batch)
        if not batch:
            break
        time.sleep(0.05)
    return all_rows


def scrape_top_trade_candidates() -> list[dict]:
    stocks = scrape_shakhesban_market_pages("stock", max_pages=3)
    funds = scrape_shakhesban_market_pages("fund", max_pages=3)
    by_sym: dict[str, dict] = {}
    for row in [*stocks, *funds]:
        sym = row.get("symbol")
        if not sym:
            continue
        prev = by_sym.get(sym)
        if not prev or float(row.get("tradeValue") or 0) > float(prev.get("tradeValue") or 0):
            by_sym[sym] = row
    return list(by_sym.values())


def scrape_shakhesban_board(max_pages: int = 15) -> list[dict]:
    """Full board via shakhesban list-data (سهام+صندوق+اوراق; no market=stock)."""
    all_rows: list[dict] = []
    page = 1
    while page <= max_pages:
        qs = urllib.parse.urlencode(
            {
                "limit": 100,
                "page": page,
                "order_col": "trades.arzesh_bazar",
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
                        "Referer": "https://www.shakhesban.com/",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                ).decode("utf-8", errors="replace")
            )
        except Exception as exc:  # noqa: BLE001
            print(f"shakhesban page {page}: {exc}")
            break
        batch = parse_shakhesban_tbody(payload.get("tbody") or "")
        batch = [r for r in batch if r.get("marketFa") != "آتی"]
        all_rows.extend(batch)
        print(f"shakhesban page {page}: +{len(batch)} (total {len(all_rows)})")
        if not payload.get("is_more") or not batch:
            break
        page += 1
        time.sleep(0.1)
    return all_rows


def scrape_rahavard_tedpix_impacts() -> dict:
    """Official TEDPIX influencers from Rahavard365 public home APIs."""
    hdrs = {
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://rahavard365.com/",
        "Origin": "https://rahavard365.com",
    }

    def load(kind: str) -> tuple[list[dict], str | None]:
        url = f"{RAHAVARD_API}/home/{kind}-instrument-effect-d"
        payload = fetch_json_retry(url, headers=hdrs, insecure=True, attempts=5)
        data = payload.get("data") if isinstance(payload, dict) else None
        rows = (data or {}).get("list") if isinstance(data, dict) else []
        as_of = (data or {}).get("date_time") if isinstance(data, dict) else None
        out: list[dict] = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("trade_symbol") or row.get("short_name") or "").strip()
            effect = num(row.get("instrument_effect_value"))
            if not symbol or effect is None:
                continue
            out.append({"symbol": symbol, "impact": round(float(effect), 1)})
        return out[:5], as_of

    try:
        pos, as_of_pos = load("positive")
        neg, as_of_neg = load("negative")
        neg = sorted(neg, key=lambda r: r["impact"])[:5]
        pos = sorted(pos, key=lambda r: -r["impact"])[:5]
        return {
            "ok": bool(pos or neg),
            "source": "rahavard365",
            "boursePos": pos,
            "bourseNeg": neg,
            "asOf": as_of_neg or as_of_pos,
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "source": "rahavard365", "error": str(exc), "boursePos": [], "bourseNeg": []}


def compute_impacts_from_board(stocks: list[dict], indices: dict, max_move: float = 0.22) -> dict:
    """Index impact ≈ index × (mv/total) × (final_change/yesterday)."""
    equities = [s for s in stocks if s.get("marketFa") == "سهام"]
    bourse = [s for s in equities if "فرابورس" not in (s.get("flow") or "")]
    ifb = [s for s in equities if "فرابورس" in (s.get("flow") or "")]
    index_b = num((indices.get("tedpix") or {}).get("value")) or 0.0
    index_f = num((indices.get("ifb") or {}).get("value")) or 0.0
    total_b = sum(s.get("marketValue") or 0 for s in bourse) or 0.0
    total_f = sum(s.get("marketValue") or 0 for s in ifb) or 0.0

    def build(rows: list[dict], index: float, total: float) -> tuple[list[dict], list[dict]]:
        items: list[dict] = []
        if not index or not total:
            return [], []
        for s in rows:
            mv = float(s.get("marketValue") or 0)
            yest = float(s.get("yesterday") or 0)
            chg = s.get("finalChg")
            if chg is None:
                chg = s.get("closeChg")
            if chg in (None, 0):
                chg = s.get("lastChg")
            if not mv or not yest or chg is None:
                continue
            move = float(chg) / yest
            if abs(move) > max_move:
                continue
            impact = index * (mv / total) * move
            items.append({"symbol": s["symbol"], "impact": round(impact, 1)})
        pos = sorted([x for x in items if x["impact"] > 0], key=lambda x: -x["impact"])[:5]
        neg = sorted([x for x in items if x["impact"] < 0], key=lambda x: x["impact"])[:5]
        return pos, neg

    b_pos, b_neg = build(bourse, index_b, total_b)
    f_pos, f_neg = build(ifb, index_f, total_f)
    return {
        "boursePos": b_pos,
        "bourseNeg": b_neg,
        "ifbPos": f_pos,
        "ifbNeg": f_neg,
        "source": "shakhesban-board",
    }


def scrape_tradersarena_pulse() -> dict | None:
    """Live pulse from TradersArena /data/market + /data/industries."""
    try:
        raw = fetch(
            "https://tradersarena.ir/data/market",
            timeout=30,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://tradersarena.ir/",
            },
        )
        data = json.loads(raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else raw)
    except Exception as exc:  # noqa: BLE001
        print(f"tradersarena pulse: {exc}")
        return None
    if not isinstance(data, dict):
        return None

    industry_flows = {
        "flowBasicMetalsBillionToman": None,
        "flowMetalOresBillionToman": None,
        "flowGoldFundsBillionToman": None,
    }
    try:
        ind_raw = fetch(
            "https://tradersarena.ir/data/industries",
            timeout=30,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://tradersarena.ir/",
            },
        )
        industries = json.loads(
            ind_raw.decode("utf-8", errors="replace") if isinstance(ind_raw, (bytes, bytearray)) else ind_raw
        )
        by_id = {str(r.get("a")): r for r in industries if isinstance(r, dict) and r.get("a") is not None}

        def ind_bt(key: str) -> float | None:
            row = by_id.get(key)
            if not row or row.get("t") is None:
                return None
            try:
                return round(float(row["t"]) / RIAL_PER_BILLION_TOMAN, 1)
            except (TypeError, ValueError):
                return None

        industry_flows = {
            "flowBasicMetalsBillionToman": ind_bt("27"),
            "flowMetalOresBillionToman": ind_bt("13"),
            "flowGoldFundsBillionToman": ind_bt("gold-funds"),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"tradersarena industries: {exc}")

    o = data.get("o") or []
    m = data.get("m") or []
    pp = data.get("pp")
    pm = data.get("pm")
    positive = int((pp[0] if isinstance(pp, list) else pp) or 0)
    negative = int((pm[0] if isinstance(pm, list) else pm) or 0)
    xyz = data.get("xyz") or []
    flat = max(0, int(xyz[1]) if len(xyz) > 1 else 0)
    now = tehran_now()

    def bt(rial: float | int | None) -> float | None:
        if rial is None:
            return None
        try:
            return round(float(rial) / RIAL_PER_BILLION_TOMAN, 1)
        except (TypeError, ValueError):
            return None

    def mt(rial: float | int | None) -> float | None:
        if rial is None:
            return None
        try:
            return round(float(rial) / RIAL_PER_MILLION_TOMAN, 2)
        except (TypeError, ValueError):
            return None

    return {
        "asOf": now.isoformat(),
        "time": now.strftime("%H:%M"),
        "dateJalali": data.get("j") or jalali_today()["dateJalali"],
        "source": "tradersarena",
        "breadth": {"positive": positive, "negative": negative, "flat": flat, "total": positive + negative + flat},
        # o ≈ [فروش ۵خط, خرید ۵خط, فروش صف, خرید صف]
        "orderBuyBillionToman": bt(o[1] if len(o) > 1 else None),
        "orderSellBillionToman": bt(o[0] if len(o) > 0 else None),
        "orderBuyQueueBillionToman": bt(o[3] if len(o) > 3 else None),
        "orderSellQueueBillionToman": bt(o[2] if len(o) > 2 else None),
        "retailMoneyFlowBillionToman": bt(m[5] if len(m) > 5 else None),
        # st/sf/nsf[5] = ورود پول سهام+حق‌تقدم / ص.سهامی / ص.درآمدثابت
        "flowStocksBillionToman": bt((data.get("st") or [None] * 6)[5]),
        "flowEquityFundsBillionToman": bt((data.get("sf") or [None] * 6)[5]),
        "flowFixedIncomeBillionToman": bt((data.get("nsf") or [None] * 6)[5]),
        **industry_flows,
        "totalTradeValueHmt": round(float(m[1]) / RIAL_PER_HEMAT, 2) if len(m) > 1 and m[1] is not None else None,
        "totalTradeValueBillionToman": bt(m[1] if len(m) > 1 else None),
        "retailBuyBillionToman": bt(m[7] if len(m) > 7 else None),
        "retailSellBillionToman": bt(m[10] if len(m) > 10 else None),
        "perCapitaBuyMillionToman": mt(m[2] if len(m) > 2 else None),
        "perCapitaSellMillionToman": mt(m[3] if len(m) > 3 else None),
        "buyPower": float(m[4]) if len(m) > 4 and m[4] is not None else None,
        "note": "داده زنده TradersArena · ورود پول بازار + صنایع",
    }


def build_market_pulse(stocks: list[dict]) -> dict:
    """Fallback pulse from board best-level (when TradersArena is unreachable)."""
    universe = [s for s in stocks if s.get("marketFa") != "آتی"]
    pos = neg = flat = 0
    order_buy = order_sell = 0.0
    retail_buy = retail_sell = 0.0
    buy_cnt = sell_cnt = 0.0
    for s in universe:
        pct = s.get("changePctLast")
        if pct is None:
            pct = s.get("changePctClose")
        p = float(pct or 0)
        # shakhesban sometimes stores ratio
        if abs(p) < 1:
            p *= 100.0
        if p > 0.05:
            pos += 1
        elif p < -0.05:
            neg += 1
        else:
            flat += 1
        order_buy += float(s.get("orderBuyVol") or 0) * float(s.get("orderBuyPx") or 0)
        order_sell += float(s.get("orderSellVol") or 0) * float(s.get("orderSellPx") or 0)
        px = float(s.get("last") or s.get("close") or 0)
        retail_buy += float(s.get("buyIVol") or 0) * px
        retail_sell += float(s.get("sellIVol") or 0) * px
        buy_cnt += float(s.get("orderBuyCnt") or 0)
        sell_cnt += float(s.get("orderSellCnt") or 0)

    now = tehran_now()
    flow_bt = (retail_buy - retail_sell) / RIAL_PER_BILLION_TOMAN
    per_buy = (retail_buy / buy_cnt / RIAL_PER_BILLION_TOMAN) if buy_cnt > 0 else None
    per_sell = (retail_sell / sell_cnt / RIAL_PER_BILLION_TOMAN) if sell_cnt > 0 else None
    per_buy_m = (per_buy * 1000) if per_buy is not None else None
    per_sell_m = (per_sell * 1000) if per_sell is not None else None

    return {
        "asOf": now.isoformat(),
        "time": now.strftime("%H:%M"),
        "dateJalali": jalali_today()["dateJalali"],
        "source": "shakhesban-board-fallback",
        "breadth": {"positive": pos, "negative": neg, "flat": flat, "total": pos + neg + flat},
        "orderBuyBillionToman": round(order_buy / RIAL_PER_BILLION_TOMAN, 1),
        "orderSellBillionToman": round(order_sell / RIAL_PER_BILLION_TOMAN, 1),
        "retailMoneyFlowBillionToman": round(flow_bt, 1),
        "retailBuyBillionToman": round(retail_buy / RIAL_PER_BILLION_TOMAN, 1),
        "retailSellBillionToman": round(retail_sell / RIAL_PER_BILLION_TOMAN, 1),
        "perCapitaBuyMillionToman": round(per_buy_m, 2) if per_buy_m is not None else None,
        "perCapitaSellMillionToman": round(per_sell_m, 2) if per_sell_m is not None else None,
        "note": "پشتیبان · بهترین سطح تابلو (بدون عمق ۵ خط)",
    }


def load_pulse_store() -> dict:
    if PULSE_PATH.exists():
        try:
            return json.loads(PULSE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"dateJalali": None, "history": []}


def save_pulse_store(store: dict) -> None:
    PULSE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PULSE_PATH.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


def append_pulse_history(pulse: dict) -> dict:
    store = load_pulse_store()
    today = pulse.get("dateJalali")
    if store.get("dateJalali") != today:
        store = {"dateJalali": today, "history": []}
    hist = list(store.get("history") or [])
    point = {
        "time": pulse.get("time"),
        "positive": (pulse.get("breadth") or {}).get("positive"),
        "negative": (pulse.get("breadth") or {}).get("negative"),
        "flat": (pulse.get("breadth") or {}).get("flat"),
        "orderBuy": pulse.get("orderBuyBillionToman"),
        "orderSell": pulse.get("orderSellBillionToman"),
        "retailFlow": pulse.get("retailMoneyFlowBillionToman"),
        "flowStocks": pulse.get("flowStocksBillionToman"),
        "flowEquityFunds": pulse.get("flowEquityFundsBillionToman"),
        "flowFixedIncome": pulse.get("flowFixedIncomeBillionToman"),
        "flowBasicMetals": pulse.get("flowBasicMetalsBillionToman"),
        "flowMetalOres": pulse.get("flowMetalOresBillionToman"),
        "flowGoldFunds": pulse.get("flowGoldFundsBillionToman"),
        "perCapitaBuy": pulse.get("perCapitaBuyMillionToman"),
        "perCapitaSell": pulse.get("perCapitaSellMillionToman"),
    }
    # replace same minute if exists
    hist = [h for h in hist if h.get("time") != point["time"]]
    hist.append(point)
    hist = [h for h in hist if str(h.get("time") or "") >= "08:45" and str(h.get("time") or "") <= "15:00"]
    hist = hist[-480:]
    store = {"dateJalali": today, "history": hist, "current": pulse, "updatedAt": datetime.now(timezone.utc).isoformat()}
    save_pulse_store(store)
    return store


def merge_impacts(
    rahavard: dict | None,
    board: dict | None,
    arena: dict | None,
) -> tuple[dict | None, str | None]:
    """TSE from Rahavard; IFB from board/SourceArena (final-price based)."""
    out = {"boursePos": [], "bourseNeg": [], "ifbPos": [], "ifbNeg": []}
    sources: list[str] = []

    if rahavard and rahavard.get("ok"):
        out["boursePos"] = list(rahavard.get("boursePos") or [])
        out["bourseNeg"] = list(rahavard.get("bourseNeg") or [])
        sources.append("rahavard365")

    arena_imp = (arena or {}).get("impacts") if (arena or {}).get("ok") else None
    if arena_imp:
        if not out["boursePos"]:
            out["boursePos"] = list(arena_imp.get("boursePos") or [])
        if not out["bourseNeg"]:
            out["bourseNeg"] = list(arena_imp.get("bourseNeg") or [])
        out["ifbPos"] = list(arena_imp.get("ifbPos") or [])
        out["ifbNeg"] = list(arena_imp.get("ifbNeg") or [])
        sources.append("sourcearena")

    if board:
        if not out["boursePos"]:
            out["boursePos"] = list(board.get("boursePos") or [])
        if not out["bourseNeg"]:
            out["bourseNeg"] = list(board.get("bourseNeg") or [])
        if not out["ifbPos"]:
            out["ifbPos"] = list(board.get("ifbPos") or [])
        if not out["ifbNeg"]:
            out["ifbNeg"] = list(board.get("ifbNeg") or [])
        sources.append("shakhesban-board")

    # Prefer cache for empty IFB buckets
    if IMPACTS_CACHE_PATH.exists() and (not out["ifbPos"] or not out["ifbNeg"] or not out["bourseNeg"]):
        try:
            cached = json.loads(IMPACTS_CACHE_PATH.read_text(encoding="utf-8"))
            for k in out:
                if not out[k] and cached.get(k):
                    out[k] = cached[k]
            sources.append("cache")
        except Exception:
            pass

    has = any(out[k] for k in out)
    if has:
        try:
            IMPACTS_CACHE_PATH.write_text(
                json.dumps({**out, "updatedAt": datetime.now(timezone.utc).isoformat(), "sources": sources}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass
    return (out if has else None), ("+".join(sources) if sources else None)


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


JALALI_MONTHS = {
    "فروردین": 1,
    "اردیبهشت": 2,
    "خرداد": 3,
    "تیر": 4,
    "مرداد": 5,
    "شهریور": 6,
    "مهر": 7,
    "آبان": 8,
    "آذر": 9,
    "دی": 10,
    "بهمن": 11,
    "اسفند": 12,
}

MONEY_FLOW_PATH = OUT_DIR / "money_flow_ytd.json"


def parse_jalali_date(raw: str | None) -> dict | None:
    """Parse '4 مرداد 1405' or '1405/05/04' → keys for store/chart."""
    if not raw:
        return None
    s = str(raw).strip()
    m = re.match(r"^(\d{4})/(\d{1,2})/(\d{1,2})$", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return {
            "dateJalali": f"{y:04d}/{mo:02d}/{d:02d}",
            "date": f"{mo:02d}/{d:02d}",
            "year": y,
            "month": mo,
            "day": d,
        }
    m = re.match(
        r"^(\d{1,2})\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*(\d{4})$",
        s,
    )
    if not m:
        return None
    d = int(m.group(1))
    mo = JALALI_MONTHS[m.group(2)]
    y = int(m.group(3))
    return {
        "dateJalali": f"{y:04d}/{mo:02d}/{d:02d}",
        "date": f"{mo:02d}/{d:02d}",
        "year": y,
        "month": mo,
        "day": d,
    }


def _parse_parsistahlil_html(html: str, cid: str, url: str) -> dict | None:
    text = re.sub(r"<script[\s\S]*?</script>", " ", html)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)

    retail = None
    m = re.search(r"معاملات\s*#?خرد.*?مبلغ\s*([\d,]+)\s*میلیارد", text) or re.search(
        r"مبلغ\s*([\d,]+)\s*میلیارد تومان بود", text
    )
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
        if flow is not None:
            flow = -abs(flow) if m.group(2) == "خروج" else abs(flow)

    date_j = None
    m = re.search(
        r"مورخ\s*(\d{1,2}\s*(?:فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*\d{4}|\d{4}/\d{2}/\d{2})",
        text,
    )
    if m:
        date_j = m.group(1).strip()
    parsed = parse_jalali_date(date_j)

    if retail is None and flow is None:
        return None
    return {
        "ok": True,
        "source": "parsistahlil.ir",
        "contentId": str(cid),
        "url": url,
        "dateJalaliRaw": date_j,
        "dateJalali": (parsed or {}).get("dateJalali"),
        "date": (parsed or {}).get("date"),
        "retailTradeValueBillionToman": retail,
        "totalTradeValueBillionToman": total_trades,
        "retailMoneyFlowDailyBillionToman": flow,
    }


def scrape_parsistahlil_recent(limit: int = 10) -> dict:
    """Fetch several recent market-status reports (newest first)."""
    try:
        home = fetch("https://parsistahlil.ir/", timeout=40).decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "days": []}

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
    # Homepage often lists only the newest report — also walk nearby content ids.
    seed_ids = [int(x) for x in links] if links else [1180]
    probe: set[int] = set(seed_ids)
    newest = max(seed_ids)
    for i in range(newest, max(newest - max(limit, 8), 0), -1):
        probe.add(i)
    ordered_ids = sorted(probe, reverse=True)[: max(limit, 8)]

    slug = urllib.parse.quote("گزارش-وضعیت-بازار-ارزش-معاملات-خرد-و-ورود-و-خروج-پول-حقیقی")
    days: list[dict] = []
    last_err = "no report link"
    for cid_i in ordered_ids:
        cid = str(cid_i)
        url = f"https://parsistahlil.ir/contents/{cid}-{slug}"
        try:
            html = fetch(url, timeout=40).decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            continue
        row = _parse_parsistahlil_html(html, cid, url)
        if row:
            days.append(row)
        else:
            last_err = f"content {cid} parsed but no numbers"

    if not days:
        return {"ok": False, "error": last_err, "days": []}

    # newest-first for "latest" fields
    days.sort(key=lambda d: (str(d.get("dateJalali") or ""), int(d.get("contentId") or 0)), reverse=True)
    latest = days[0]
    return {
        "ok": True,
        "source": "parsistahlil.ir",
        "contentId": latest.get("contentId"),
        "url": latest.get("url"),
        "dateJalali": latest.get("dateJalaliRaw") or latest.get("dateJalali"),
        "retailTradeValueBillionToman": latest.get("retailTradeValueBillionToman"),
        "totalTradeValueBillionToman": latest.get("totalTradeValueBillionToman"),
        "retailMoneyFlowDailyBillionToman": latest.get("retailMoneyFlowDailyBillionToman"),
        "days": days,
    }


def scrape_parsistahlil_market_status() -> dict:
    return scrape_parsistahlil_recent(limit=10)


def load_money_flow_store() -> dict:
    if MONEY_FLOW_PATH.exists():
        try:
            return json.loads(MONEY_FLOW_PATH.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return {
        "baselineYtdBillionToman": -25271,
        "baselineThroughJalali": "1405/04/29",
        "ytdBillionToman": -25271,
        "asOfJalali": "1405/04/29",
        "series": [],
    }


def recompute_money_flow_ytd(store: dict) -> dict:
    baseline = float(store.get("baselineYtdBillionToman") or -25271)
    through = str(store.get("baselineThroughJalali") or "1405/04/29")
    series = list(store.get("series") or [])
    extra = 0.0
    as_of = through
    as_label = through[5:] if len(through) >= 8 else through
    for row in series:
        dj = str(row.get("dateJalali") or "")
        if not dj or dj <= through:
            continue
        try:
            extra += float(row.get("value") or 0)
        except (TypeError, ValueError):
            continue
        as_of = dj
        as_label = str(row.get("date") or dj[5:])
    store["ytdBillionToman"] = int(round(baseline + extra))
    store["asOfJalali"] = as_of
    store["asOfLabel"] = as_label
    store["updatedAt"] = datetime.now(timezone.utc).isoformat()
    store["source"] = "parsistahlil.ir"
    return store


def apply_parsistahlil_days_to_store(store: dict, days: list[dict]) -> tuple[dict, list[str]]:
    """Append new post-baseline daily flows from parsistahlil; recompute YTD."""
    through = str(store.get("baselineThroughJalali") or "1405/04/29")
    series = list(store.get("series") or [])
    by_date = {str(r.get("dateJalali")): r for r in series if r.get("dateJalali")}
    added: list[str] = []

    # oldest → newest so chart order stays chronological when appending
    ordered = sorted(
        [d for d in days if d.get("dateJalali") and d.get("retailMoneyFlowDailyBillionToman") is not None],
        key=lambda d: str(d.get("dateJalali")),
    )
    for day in ordered:
        dj = str(day["dateJalali"])
        if dj <= through:
            continue
        flow = day.get("retailMoneyFlowDailyBillionToman")
        try:
            flow_n = float(flow)
        except (TypeError, ValueError):
            continue
        point = {
            "date": day.get("date") or dj[5:],
            "dateJalali": dj,
            "value": int(round(flow_n)),
            "contentId": str(day.get("contentId") or ""),
        }
        if dj in by_date:
            # update value if changed (same day republish)
            prev = by_date[dj]
            if int(prev.get("value") or 0) != point["value"]:
                prev.update(point)
                added.append(f"update:{dj}")
            continue
        series.append(point)
        by_date[dj] = point
        added.append(dj)

    series.sort(key=lambda r: str(r.get("dateJalali") or ""))
    store["series"] = series
    store = recompute_money_flow_ytd(store)
    return store, added


def save_money_flow_store(store: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    MONEY_FLOW_PATH.write_text(json.dumps(store, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_sourcearena_billion_rial(raw) -> float | None:
    """Parse values like '143,915,447.992B' (میلیارد ریال)."""
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "").replace(" ", "")
    s = re.sub(r"[Bb]$", "", s)
    try:
        n = float(s)
    except ValueError:
        return None
    return n if n == n else None  # NaN guard


def billion_rial_to_hmt(billion_rial: float | None) -> float | None:
    if billion_rial is None:
        return None
    return round(billion_rial / BILLION_RIAL_PER_HEMAT, 1)


def fetch_with_retries(url: str, timeout: int = 30, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fetch(
                url,
                timeout=timeout,
                headers={"Accept": "application/json", "Referer": "https://sourcearena.ir/"},
            )
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.6 * (i + 1))
    raise last or RuntimeError("fetch failed")


def scrape_sourcearena_glance(token: str | None = None) -> dict:
    """Official TSE + IFB «در یک نگاه» via SourceArena (Traders Arena API)."""
    tok = (token or SOURCEARENA_TOKEN or "").strip()
    if not tok:
        return {"ok": False, "error": "SOURCEARENA_TOKEN missing"}

    out: dict = {"ok": False, "source": "sourcearena", "tokenHint": tok[:8]}
    try:
        bourse_raw = json.loads(
            fetch_with_retries(
                f"{SOURCEARENA_API}?token={urllib.parse.quote(tok)}&market=market_bourse",
            )
        )
        ifb_raw = json.loads(
            fetch_with_retries(
                f"{SOURCEARENA_API}?token={urllib.parse.quote(tok)}&market=market_farabourse",
            )
        )
    except Exception as exc:  # noqa: BLE001
        return {**out, "error": str(exc)}

    if isinstance(bourse_raw, dict) and bourse_raw.get("Error"):
        return {**out, "error": str(bourse_raw.get("Error"))}
    if isinstance(ifb_raw, dict) and ifb_raw.get("Error"):
        return {**out, "error": str(ifb_raw.get("Error"))}

    bourse = bourse_raw.get("bourse") if isinstance(bourse_raw, dict) else None
    ifb = ifb_raw.get("fara-bourse") if isinstance(ifb_raw, dict) else None
    if not isinstance(bourse, dict) or not isinstance(ifb, dict):
        return {**out, "error": f"unexpected payload keys: {list(bourse_raw) if isinstance(bourse_raw, dict) else type(bourse_raw)}"}

    b_mv = billion_rial_to_hmt(parse_sourcearena_billion_rial(bourse.get("market_value")))
    f_mv = billion_rial_to_hmt(parse_sourcearena_billion_rial(ifb.get("market_value")))
    b_tr = billion_rial_to_hmt(parse_sourcearena_billion_rial(bourse.get("trade_value")))
    f_tr = billion_rial_to_hmt(parse_sourcearena_billion_rial(ifb.get("trade_value")))

    if b_mv is None or f_mv is None:
        return {**out, "error": "missing market_value", "bourse": bourse, "ifb": ifb}

    def load_official_impacts(market_key: str) -> list[dict]:
        rows_out: list[dict] = []
        try:
            ind = json.loads(
                fetch_with_retries(
                    f"{SOURCEARENA_API}?token={urllib.parse.quote(tok)}&market={market_key}",
                    timeout=25,
                    attempts=3,
                )
            )
        except Exception as exc:  # noqa: BLE001
            out[f"impactsError_{market_key}"] = str(exc)
            return rows_out
        if not isinstance(ind, list):
            return rows_out
        for row in ind[:16]:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            effect = parse_sourcearena_billion_rial(row.get("effect"))
            if not name or effect is None:
                continue
            rows_out.append({"symbol": name, "impact": effect})
        return rows_out

    def is_equity(row: dict) -> bool:
        market = str(row.get("market") or "")
        industry = str(row.get("industry") or "")
        name = str(row.get("name") or "")
        full = str(row.get("full_name") or "")
        code = str(row.get("namad_code") or "")
        blob = f"{market} {industry} {name} {full}"
        if "بورس" not in market and "فرابورس" not in market:
            return False
        if any(k in blob for k in ("صندوق", "مرابحه", "اجاره", "اختيار", "اختیار", "تبعی", "حق تقدم", "آتی")):
            return False
        if name.endswith("ح") or code.startswith("IRF") or code.startswith("IRR"):
            return False
        return True

    def compute_from_all() -> tuple[dict, list[dict]]:
        try:
            all_rows = json.loads(
                fetch_with_retries(
                    f"{SOURCEARENA_API}?token={urllib.parse.quote(tok)}&all&type=0",
                    timeout=60,
                    attempts=3,
                )
            )
        except Exception as exc:  # noqa: BLE001
            out["allError"] = str(exc)
            return {
                "boursePos": [],
                "bourseNeg": [],
                "ifbPos": [],
                "ifbNeg": [],
            }, []
        if not isinstance(all_rows, list):
            # try disk cache when rate-limited / unexpected
            if BOARD_CACHE_PATH.exists():
                try:
                    all_rows = json.loads(BOARD_CACHE_PATH.read_text(encoding="utf-8"))
                except Exception:
                    all_rows = None
            if not isinstance(all_rows, list):
                return {
                    "boursePos": [],
                    "bourseNeg": [],
                    "ifbPos": [],
                    "ifbNeg": [],
                }, []
        else:
            try:
                BOARD_CACHE_PATH.write_text(json.dumps(all_rows, ensure_ascii=False), encoding="utf-8")
            except Exception:
                pass

        index_b = parse_sourcearena_billion_rial(bourse.get("index")) or 0.0
        index_f = parse_sourcearena_billion_rial(ifb.get("index")) or 0.0
        total_b = (parse_sourcearena_billion_rial(bourse.get("market_value")) or 0.0) * 1e9
        total_f = (parse_sourcearena_billion_rial(ifb.get("market_value")) or 0.0) * 1e9
        bourse_rows: list[dict] = []
        ifb_rows: list[dict] = []
        trades: list[dict] = []
        for row in all_rows:
            if not isinstance(row, dict) or not is_equity(row):
                continue
            name = str(row.get("name") or "").strip()
            mv = num(row.get("market_value")) or 0.0
            yesterday = num(row.get("yesterday_price")) or 0.0
            # قیمت پایانی (final) — نه آخرین معامله — مبنای تاثیر رسمی
            change = num(row.get("final_price_change"))
            if change is None:
                change = num(row.get("close_price_change"))
            trade_value = num(row.get("trade_value")) or 0.0
            if not name or not mv or not yesterday or change is None:
                continue
            market = str(row.get("market") or "")
            is_ifb = "فرابورس" in market
            total = total_f if is_ifb else total_b
            index = index_f if is_ifb else index_b
            if not total or not index:
                continue
            impact = index * (mv / total) * (change / yesterday)
            item = {"symbol": name, "impact": round(impact, 1)}
            (ifb_rows if is_ifb else bourse_rows).append(item)
            if trade_value > 0:
                trades.append({"name": name, "valueBr": round(trade_value / 1e10, 1)})

        def pick(rows: list[dict], positive: bool) -> list[dict]:
            filtered = [r for r in rows if (r["impact"] > 0 if positive else r["impact"] < 0)]
            filtered.sort(key=lambda r: -r["impact"] if positive else r["impact"])
            return filtered[:5]

        impacts = {
            "boursePos": pick(bourse_rows, True),
            "bourseNeg": pick(bourse_rows, False),
            "ifbPos": pick(ifb_rows, True),
            "ifbNeg": pick(ifb_rows, False),
        }
        trades.sort(key=lambda r: -r["valueBr"])
        return impacts, trades[:13]

    b_off = load_official_impacts("ind_namad_bourse")
    f_off = load_official_impacts("ind_namad_farabourse")
    computed_impacts, top_trades = compute_from_all()

    def split_pos_neg(rows: list[dict]) -> tuple[list[dict], list[dict]]:
        pos = sorted([x for x in rows if x["impact"] > 0], key=lambda x: -x["impact"])[:5]
        neg = sorted([x for x in rows if x["impact"] < 0], key=lambda x: x["impact"])[:5]
        return pos, neg

    b_pos, b_neg = split_pos_neg(b_off)
    f_pos, f_neg = split_pos_neg(f_off)
    # مثبت رسمی؛ منفی همیشه از محاسبه final_price (API رسمی معمولاً فقط مثبت می‌دهد)
    impacts_ui = {
        "boursePos": b_pos or computed_impacts["boursePos"],
        "bourseNeg": computed_impacts["bourseNeg"] or b_neg,
        "ifbPos": f_pos or computed_impacts["ifbPos"],
        "ifbNeg": computed_impacts["ifbNeg"] or f_neg,
    }
    has_impacts = any(impacts_ui[k] for k in impacts_ui)

    total_mv = round(b_mv + f_mv, 1)
    total_tr = None
    trade_source = None
    if b_tr is not None and f_tr is not None and f_tr <= max(b_tr * 4, 80):
        total_tr = round(b_tr + f_tr, 2)
        trade_source = "sourcearena-bourse+ifb"
    elif b_tr is not None:
        total_tr = b_tr
        trade_source = "sourcearena-bourse-only"

    return {
        "ok": True,
        "source": "sourcearena",
        "bourse": {
            "state": bourse.get("state"),
            "index": parse_sourcearena_billion_rial(bourse.get("index")),
            "marketValueHmt": b_mv,
            "tradeValueHmt": b_tr,
            "raw": bourse,
        },
        "ifb": {
            "state": ifb.get("state"),
            "index": parse_sourcearena_billion_rial(ifb.get("index")),
            "marketValueHmt": f_mv,
            "tradeValueHmt": f_tr,
            "raw": ifb,
        },
        "totalMarketValueHmt": total_mv,
        "totalTradeValueHmt": total_tr,
        "totalTradeValueSource": trade_source,
        "impacts": impacts_ui if has_impacts else None,
        "impactsFromSourceArena": has_impacts,
        "topTrades": top_trades,
        "topTradesSource": "sourcearena-all" if top_trades else None,
    }


def build_overview_live(
    stocks_all: list[dict],
    usd_rial: float | None,
    indices: dict,
    tgju_tedpix: dict | None,
    pars: dict,
    glance: dict | None,
    money_flow: dict | None = None,
    impacts_bundle: dict | None = None,
    pulse_store: dict | None = None,
) -> dict:
    stocks = [s for s in stocks_all if s.get("marketFa") == "سهام"]
    bourse = [s for s in stocks if "فرابورس" not in (s.get("flow") or "")]
    ifb = [s for s in stocks if "فرابورس" in (s.get("flow") or "")]

    sum_mv = sum(s["marketValue"] for s in stocks)
    sum_trade = sum(s["tradeValue"] for s in stocks)
    today = jalali_today()

    # Top trades: ۱۲ نماد برتر سهام + صندوق سهامی (نه اوراق/طلا/درآمدثابت)
    fund_set = fetch_equity_fund_symbol_set()
    trade_rows = scrape_top_trade_candidates() or stocks_all
    top_trades_out = build_top_trades(trade_rows, fund_set, limit=12)
    top_trades_source = "shakhesban+ta-equity-funds" if top_trades_out else None
    if glance.get("ok") and glance.get("topTrades") and not top_trades_out:
        top_trades_out = list(glance.get("topTrades") or [])[:12]
        top_trades_source = glance.get("topTradesSource") or "sourcearena-all"

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
    glance = glance or {}

    retail_flow = pars.get("retailMoneyFlowDailyBillionToman") if pars.get("ok") else None
    retail_trades_bt = pars.get("retailTradeValueBillionToman") if pars.get("ok") else None

    notes = []
    blocked = []

    if glance.get("ok") and glance.get("totalMarketValueHmt") is not None:
        total_mv = glance["totalMarketValueHmt"]
        mv_source = "sourcearena-bourse+ifb"
        b_mv = (glance.get("bourse") or {}).get("marketValueHmt")
        f_mv = (glance.get("ifb") or {}).get("marketValueHmt")
        notes.append(
            f"ارزش بازار = بورس ({b_mv} همت) + فرابورس ({f_mv} همت) از SourceArena/TradersArena = {total_mv} همت."
        )
    else:
        total_mv = board_mv
        mv_source = "shakhesban-board-interim"
        blocked.append("sourcearena")
        notes.append(
            f"SourceArena خوانده نشد ({glance.get('error')}) — موقت تجمیع تابلوی شاخص‌بان ({board_mv} همت)."
        )

    usd_m = None
    if usd_rial and usd_rial > 0 and total_mv and total_mv > 0:
        usd_m = round(total_mv * RIAL_PER_HEMAT / usd_rial / 1e6, 0)

    ifb_board_trade = round(sum(s["tradeValue"] for s in ifb) / RIAL_PER_HEMAT, 2)
    ta_trade = None
    if isinstance(pulse_store, dict):
        ta_trade = (pulse_store.get("current") or {}).get("totalTradeValueHmt")
    if glance.get("ok") and glance.get("totalTradeValueHmt") is not None:
        total_trade_hmt = glance["totalTradeValueHmt"]
        total_trade_source = glance.get("totalTradeValueSource") or "sourcearena"
        # اگر فرابورس رسمی اوراق را قاطی کرده، معاملات سهام فرابورس را از تابلو جمع بزن
        if total_trade_source == "sourcearena-bourse-only" and ifb_board_trade > 0:
            b_tr = (glance.get("bourse") or {}).get("tradeValueHmt") or total_trade_hmt
            total_trade_hmt = round(float(b_tr) + ifb_board_trade, 2)
            total_trade_source = "sourcearena-bourse+shakhesban-ifb"
    elif ta_trade is not None:
        total_trade_hmt = ta_trade
        total_trade_source = "tradersarena"
    else:
        total_trade_hmt = board_trade
        total_trade_source = "shakhesban-board-interim"

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
    mf = money_flow or {}
    ytd = mf.get("ytdBillionToman")
    series = [
        {"date": r.get("date"), "dateJalali": r.get("dateJalali"), "value": r.get("value")}
        for r in (mf.get("series") or [])
        if r.get("date") is not None and r.get("value") is not None
    ]
    if ytd is not None:
        notes.append(
            f"خالص پول حقیقی از ابتدای ۱۴۰۴ = {ytd} میلیارد تومان"
            f" (پایه تا {mf.get('baselineThroughJalali')}: {mf.get('baselineYtdBillionToman')}؛"
            f" بعد از آن از پارسیس تا {mf.get('asOfJalali')})."
        )
    else:
        notes.append("خالص پول حقیقی YTD هنوز ذخیره نشده.")

    impacts = (impacts_bundle or {}).get("impacts")
    impacts_source = (impacts_bundle or {}).get("source")
    if impacts:
        notes.append(f"تاثیر در شاخص از {impacts_source or 'live'}.")
    else:
        notes.append("تاثیر مثبت/منفی در صورت نبود منبع زنده از seed گزارش می‌ماند.")

    pulse = (pulse_store or {}).get("current")
    pulse_hist = (pulse_store or {}).get("history") or []

    return {
        "ok": True,
        "asOf": datetime.now(timezone.utc).isoformat(),
        "dateJalali": today["dateJalali"],
        "dateGregorian": today["dateGregorian"],
        "indices": {
            "tedpix": ted or None,
            "equalWeight": eq or None,
            "ifb": ifb_idx or None,
        },
        "stockCount": len(stocks),
        "bourseCount": len(bourse),
        "ifbCount": len(ifb),
        "bourseMarketValueHmt": (glance.get("bourse") or {}).get("marketValueHmt"),
        "ifbMarketValueHmt": (glance.get("ifb") or {}).get("marketValueHmt"),
        "totalMarketValueHmt": total_mv,
        "totalMarketValueUsdM": usd_m,
        "marketValueSource": mv_source,
        "usdRate": usd_rial,
        "totalTradeValueHmt": total_trade_hmt,
        "totalTradeValueSource": total_trade_source,
        "totalTradeValueBillionToman": round((total_trade_hmt or 0) * 1000, 1) if total_trade_hmt is not None else None,
        "retailTradeValueBillionToman": retail_trades_bt,
        "retailTradeValueHmt": round(retail_trades_bt / 1000.0, 2) if retail_trades_bt else None,
        "retailMoneyFlowDailyBillionToman": retail_flow,
        "retailMoneyFlowYtd": ytd,
        "retailMoneyFlowYtdSource": "parsistahlil-cumulative",
        "moneyFlowSeries": series,
        "moneyFlowAsOfJalali": mf.get("asOfJalali"),
        "impacts": impacts,
        "impactsFromTsetmc": False,
        "impactsFromSourceArena": bool(impacts) and "sourcearena" in (impacts_source or ""),
        "impactsFromRahavard": bool(impacts) and "rahavard" in (impacts_source or ""),
        "impactsSource": impacts_source,
        "topTrades": top_trades_out,
        "topTradesSource": top_trades_source,
        "marketPulse": pulse,
        "marketPulseHistory": pulse_hist,
        "sourcearena": {"ok": bool(glance.get("ok")), "error": glance.get("error")},
        "parsistahlil": pars,
        "blocked": blocked,
        "notes": notes,
    }


def candles_from_1401(ohlc: list[dict]) -> list[dict]:
    return [c for c in ohlc if (c.get("date") or "") >= TEDPIX_FROM_1401]


def scrape_tgju_intraday(key: str = "bourse") -> list[dict]:
    """Intraday path from TGJU today-table-data (multi-minute resolution)."""
    url = f"https://api.tgju.org/v1/market/indicator/today-table-data/{key}?lang=fa"
    try:
        payload = json.loads(fetch(url, timeout=40))
    except Exception as exc:  # noqa: BLE001
        print(f"intraday {key}: {exc}")
        return []
    out: list[dict] = []
    for row in payload.get("data") or []:
        if not isinstance(row, list) or len(row) < 2:
            continue
        value = num(row[0])
        time_s = str(row[1] or "").strip()
        if value is None or not time_s:
            continue
        chg_html = str(row[2] or "")
        chg = num(re.sub(r"<[^>]+>", "", chg_html))
        out.append({"time": time_s[:5] if len(time_s) >= 5 else time_s, "value": value, "change": chg})
    out.reverse()
    return out


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
    print(
        "pars",
        {
            k: pars.get(k)
            for k in (
                "ok",
                "retailTradeValueBillionToman",
                "retailMoneyFlowDailyBillionToman",
                "totalTradeValueBillionToman",
                "dateJalali",
                "error",
            )
        },
        "days",
        len(pars.get("days") or []),
    )

    print("money-flow YTD store…")
    money_flow = load_money_flow_store()
    money_flow, added_days = apply_parsistahlil_days_to_store(money_flow, pars.get("days") or [])
    save_money_flow_store(money_flow)
    print(
        "moneyFlow",
        {
            "ytd": money_flow.get("ytdBillionToman"),
            "asOf": money_flow.get("asOfJalali"),
            "added": added_days,
            "seriesLen": len(money_flow.get("series") or []),
        },
    )

    print("TGJU intraday…")
    intraday = scrape_tgju_intraday("bourse")
    print(f"intraday points={len(intraday)}")

    print("shakhesban board…")
    board = scrape_shakhesban_board()

    print("Rahavard365 TEDPIX impacts…")
    rahavard = scrape_rahavard_tedpix_impacts()
    print(
        "rahavard",
        {
            "ok": rahavard.get("ok"),
            "pos": [x["symbol"] for x in (rahavard.get("boursePos") or [])],
            "neg": [x["symbol"] for x in (rahavard.get("bourseNeg") or [])],
            "error": rahavard.get("error"),
        },
    )

    print("board impacts (IFB/TSE fallback)…")
    board_impacts = compute_impacts_from_board(board, indices)
    print(
        "boardImpacts",
        {
            "ifbNeg": [x["symbol"] for x in (board_impacts.get("ifbNeg") or [])],
            "ifbPos": [x["symbol"] for x in (board_impacts.get("ifbPos") or [])],
            "bourseNeg": [x["symbol"] for x in (board_impacts.get("bourseNeg") or [])],
        },
    )

    print("market pulse (TradersArena /data/market)…")
    pulse = scrape_tradersarena_pulse() or build_market_pulse(board)
    pulse_store = append_pulse_history(pulse)
    print(
        "pulse",
        {
            "breadth": pulse.get("breadth"),
            "orderBuy": pulse.get("orderBuyBillionToman"),
            "orderSell": pulse.get("orderSellBillionToman"),
            "flow": pulse.get("retailMoneyFlowBillionToman"),
            "hist": len(pulse_store.get("history") or []),
        },
    )

    print("SourceArena glance (bourse + farabourse)…")
    glance = scrape_sourcearena_glance()
    print(
        "sourcearena",
        {
            "ok": glance.get("ok"),
            "mv": glance.get("totalMarketValueHmt"),
            "bourse": (glance.get("bourse") or {}).get("marketValueHmt"),
            "ifb": (glance.get("ifb") or {}).get("marketValueHmt"),
            "error": glance.get("error"),
        },
    )

    impacts, impacts_source = merge_impacts(rahavard, board_impacts, glance)
    impacts_bundle = {"impacts": impacts, "source": impacts_source}
    print("impactsSource", impacts_source, "bourseNeg", [x["symbol"] for x in ((impacts or {}).get("bourseNeg") or [])])

    tsetmc = scrape_tsetmc()  # optional probe only
    overview_live = build_overview_live(
        board,
        usd,
        indices,
        tedpix,
        pars,
        glance,
        money_flow,
        impacts_bundle=impacts_bundle,
        pulse_store=pulse_store,
    )
    overview_live["intraday"] = {
        "source": "tgju-today-table",
        "note": "مسیر روزانه TGJU (رزولوشن چنددقیقه‌ای).",
        "points": intraday,
    }
    print(
        f"MV={overview_live['totalMarketValueHmt']} همت ({overview_live['marketValueSource']}) | "
        f"USD={overview_live['totalMarketValueUsdM']} m$ | "
        f"trade={overview_live['totalTradeValueHmt']} همت ({overview_live['totalTradeValueSource']}) | "
        f"retailFlow={overview_live['retailMoneyFlowDailyBillionToman']} | "
        f"date={overview_live.get('dateJalali')}"
    )

    ime = scrape_ime()
    sectors = build_sectors(quotes)

    market = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "infra": {
            "tgju": "TEDPIX + USD live",
            "shakhesban": "equal-weight + IFB indices + board (top trades / pulse / IFB impacts)",
            "parsistahlil": "retail trades + daily flow; YTD cumulative in money_flow_ytd.json",
            "sourcearena": "بازار بورس+فرابورس در یک نگاه → مجموع ارزش بازار",
            "rahavard365": "تاثیر مثبت/منفی بورس روی شاخص کل",
            "tradersarena": "الگوی UI پالس بازار؛ داده از تجمیع تابلو",
            "tsetmc": "از این مسیر استفاده نمی‌شود (جایگزین: SourceArena/Rahavard)",
            "ime": "usually needs Iran IP",
            "custeel": "paid; interim uses TGJU iron-ore/steel-coil + FRED",
            "fred": "scripts/fetch_fred.py",
        },
        "tgju": tgju,
        "histories": {k: v for k, v in histories.items() if v},
        "candles1401": candles,
        "intraday": overview_live.get("intraday"),
        "overviewLive": overview_live,
        "sectors": sectors,
        "sourcearena": glance,
        "rahavard": rahavard,
        "marketPulse": pulse_store,
        "tsetmc": tsetmc,
        "ime": ime,
        "parsistahlil": pars,
        "moneyFlowYtd": money_flow,
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
                "retailMoneyFlowYtd",
                "retailMoneyFlowYtdSource",
                "moneyFlowAsOfJalali",
                "marketValueSource",
                "bourseMarketValueHmt",
                "ifbMarketValueHmt",
                "impactsFromSourceArena",
                "blocked",
                "stockCount",
            )
        },
        "candles1401Count": len(candles),
        "sourcearena": {"ok": glance.get("ok"), "totalMarketValueHmt": glance.get("totalMarketValueHmt")},
        "tsetmc": tsetmc,
        "ime": ime,
        "parsistahlil": pars,
        "moneyFlowYtd": {
            "ytdBillionToman": money_flow.get("ytdBillionToman"),
            "asOfJalali": money_flow.get("asOfJalali"),
            "seriesLen": len(money_flow.get("series") or []),
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
