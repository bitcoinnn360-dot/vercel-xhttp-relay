#!/usr/bin/env python3
"""
Market data scraper for MIDCO dashboard.

Works from most cloud/VPS hosts:
  - TGJU live quotes + OHLC histories (bourse, FX, metals, …)
  - shakhesban indices (TEDPIX / equal-weight / IFB) + board aggregate
  - parsistahlil.ir public «گزارش وضعیت بازار» (retail trades + daily money flow)
  - SourceArena (اکوسیستم Traders Arena) «در یک نگاه» بورس + فرابورس → ارزش بازار رسمی

Needs Iran IP / login:
  - IME, tradersarena /data (بدون لاگین 404)
"""
from __future__ import annotations

import json
import os
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

# 1 همت = 10^13 ریال | 1 میلیارد تومان = 10^10 ریال | 1 همت = 10_000 میلیارد ریال
RIAL_PER_HEMAT = 1e13
RIAL_PER_BILLION_TOMAN = 1e10
BILLION_RIAL_PER_HEMAT = 10_000.0
TEDPIX_FROM_1401 = "2022/03/21"

# Demo/public token used in SourceArena docs — override with SOURCEARENA_TOKEN
SOURCEARENA_TOKEN = os.environ.get("SOURCEARENA_TOKEN", "bba6d330a87bac533f18cc245d3baeaa")
SOURCEARENA_API = "https://apis.sourcearena.ir/api/"

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

    def load_impacts(market_key: str) -> list[dict]:
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
            # UI expects { symbol, impact }
            rows_out.append({"symbol": name, "impact": effect})
        return rows_out

    bourse_impacts = load_impacts("ind_namad_bourse")
    ifb_impacts = load_impacts("ind_namad_farabourse")

    def split_pos_neg(rows: list[dict]) -> tuple[list[dict], list[dict]]:
        pos = sorted([x for x in rows if x["impact"] > 0], key=lambda x: -x["impact"])[:7]
        neg = sorted([x for x in rows if x["impact"] < 0], key=lambda x: x["impact"])[:7]
        return pos, neg

    b_pos, b_neg = split_pos_neg(bourse_impacts)
    f_pos, f_neg = split_pos_neg(ifb_impacts)
    impacts_ui = {
        "boursePos": b_pos,
        "bourseNeg": b_neg,
        "ifbPos": f_pos,
        "ifbNeg": f_neg,
    }
    has_impacts = any(impacts_ui[k] for k in impacts_ui)

    total_mv = round(b_mv + f_mv, 1)
    # ارزش معاملات فرابورس «در یک نگاه» اغلب اوراق را هم دارد؛ اگر غیرعادی بزرگ بود فقط بورس را بگیر
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
    }


def build_overview_live(
    stocks_all: list[dict],
    usd_rial: float | None,
    indices: dict,
    tgju_tedpix: dict | None,
    pars: dict,
    glance: dict | None,
    money_flow: dict | None = None,
) -> dict:
    stocks = [s for s in stocks_all if s.get("marketFa") == "سهام"]
    bourse = [s for s in stocks if "فرابورس" not in (s.get("flow") or "")]
    ifb = [s for s in stocks if "فرابورس" in (s.get("flow") or "")]

    sum_mv = sum(s["marketValue"] for s in stocks)
    sum_trade = sum(s["tradeValue"] for s in stocks)

    # Top trades by value (تابلو)
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
    if glance.get("ok") and glance.get("totalTradeValueHmt") is not None:
        total_trade_hmt = glance["totalTradeValueHmt"]
        total_trade_source = glance.get("totalTradeValueSource") or "sourcearena"
        # اگر فرابورس رسمی اوراق را قاطی کرده، معاملات سهام فرابورس را از تابلو جمع بزن
        if total_trade_source == "sourcearena-bourse-only" and ifb_board_trade > 0:
            b_tr = (glance.get("bourse") or {}).get("tradeValueHmt") or total_trade_hmt
            total_trade_hmt = round(float(b_tr) + ifb_board_trade, 2)
            total_trade_source = "sourcearena-bourse+shakhesban-ifb"
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

    impacts = glance.get("impacts") if glance.get("impactsFromSourceArena") else None
    if impacts:
        notes.append("تاثیر در شاخص از SourceArena (ind_namad_bourse / farabourse).")
    else:
        notes.append("تاثیر مثبت/منفی در صورت نبود SourceArena از seed گزارش می‌ماند.")

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
        "impactsFromSourceArena": bool(impacts),
        "topTrades": top_trades_out,
        "topTradesSource": "shakhesban-board",
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

    tsetmc = scrape_tsetmc()  # optional probe only
    overview_live = build_overview_live(board, usd, indices, tedpix, pars, glance, money_flow)
    overview_live["intraday"] = {
        "source": "tgju-today-table",
        "note": "مسیر روزانه TGJU (رزولوشن چنددقیقه‌ای).",
        "points": intraday,
    }
    print(
        f"MV={overview_live['totalMarketValueHmt']} همت ({overview_live['marketValueSource']}) | "
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
            "shakhesban": "equal-weight + IFB indices + board (top trades)",
            "parsistahlil": "retail trades + daily flow; YTD cumulative in money_flow_ytd.json",
            "sourcearena": "بازار بورس+فرابورس در یک نگاه → مجموع ارزش بازار",
            "tradersarena": "UI؛ دادهٔ در یک نگاه از API سورس‌آرنا",
            "tsetmc": "از این مسیر استفاده نمی‌شود (جایگزین: SourceArena)",
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
