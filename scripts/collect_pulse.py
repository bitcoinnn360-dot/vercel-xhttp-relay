#!/usr/bin/env python3
"""Lightweight TradersArena pulse collector for cron / GitHub Actions.

Appends one sample into public/data/market_pulse.json and archives the day
under public/data/pulse-days/<jalali>.json so charts can start from session open
even if nobody has the dashboard open.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "market_pulse.json"
DAYS_DIR = ROOT / "public" / "data" / "pulse-days"
TA_MARKET = "https://tradersarena.ir/data/market"
TA_INDUSTRIES = "https://tradersarena.ir/data/industries"
UA = "Mozilla/5.0 (compatible; midco-pulse-collector/1.0)"
RIAL_PER_BT = 1e10
PULSE_START = "08:45"
PULSE_CASH_END = "12:30"
# Gold commodity ETFs (صندوق طلا) trade into the afternoon (~18:00).
PULSE_END = "18:00"
MAX_DAYS = 45
MAX_POINTS = 720
TEHRAN = ZoneInfo("Asia/Tehran")
# TSE + commodity fund week: Sat–Wed
MARKET_WEEKDAYS = {5, 6, 0, 1, 2}  # Sat..Wed (Mon=0)


def fetch_json(url: str):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://tradersarena.ir/",
        },
    )
    with urllib.request.urlopen(req, timeout=25) as res:
        return json.load(res)


def jalali_today(now: datetime) -> str:
    parts = {}
    for p in __import__("locale") and []:
        pass
    # Use Intl-like via python's available calendar — prefer jdatetime if present,
    # else approximate with system Persian formatter through subprocess node/date.
    try:
        import jdatetime  # type: ignore

        j = jdatetime.datetime.fromgregorian(datetime=now)
        return f"{j.year:04d}/{j.month:02d}/{j.day:02d}"
    except Exception:
        pass
    # Fallback: ask Node (available in CI) for Persian calendar
    try:
        import subprocess

        script = (
            "const p=new Intl.DateTimeFormat('en-u-ca-persian-nu-latn',"
            "{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());"
            "const g=t=>p.find(x=>x.type===t)?.value;"
            "console.log(`${g('year')}/${g('month')}/${g('day')}`)"
        )
        out = subprocess.check_output(["node", "-e", script], text=True).strip()
        out = re.sub(r"[^\d/]", "", out)
        if re.match(r"\d{4}/\d{2}/\d{2}", out):
            return out
    except Exception:
        pass
    return now.strftime("%Y/%m/%d")


def bt(rial) -> float | None:
    if rial is None:
        return None
    try:
        return round(float(rial) / RIAL_PER_BT, 1)
    except Exception:
        return None


def seg_flow(arr) -> float | None:
    if not isinstance(arr, list) or len(arr) < 6:
        return None
    return bt(arr[5])


def clamp_time(hhmm: str) -> str | None:
    t = str(hhmm or "")
    if not re.match(r"^\d{2}:\d{2}$", t):
        return None
    if t < PULSE_START:
        return None
    if t > PULSE_END:
        return PULSE_END
    return t


def parse_industries(rows) -> dict:
    out = {
        "flowBasicMetalsBillionToman": None,
        "flowMetalOresBillionToman": None,
        "flowGoldFundsBillionToman": None,
    }
    if not isinstance(rows, list):
        return out
    by_id = {str(r.get("a")): r for r in rows if r and r.get("a") is not None}
    for key, iid in (("flowBasicMetalsBillionToman", "27"), ("flowMetalOresBillionToman", "13"), ("flowGoldFundsBillionToman", "gold-funds")):
        row = by_id.get(iid)
        if row:
            out[key] = bt(row.get("t"))
    return out


def parse_pulse(market: dict, industries) -> dict:
    now = datetime.now(TEHRAN)
    o = market.get("o") or []
    m = market.get("m") or []
    st = market.get("st") or []
    sf = market.get("sf") or []
    nsf = market.get("nsf") or []
    pp = market.get("pp")
    pm = market.get("pm")
    if isinstance(pp, list):
        pp = pp[0] if pp else 0
    if isinstance(pm, list):
        pm = pm[0] if pm else 0
    xyz = market.get("xyz") or []
    flat = max(0, int(xyz[1]) if isinstance(xyz, list) and len(xyz) > 1 and xyz[1] is not None else 0)
    ind = parse_industries(industries)
    positive = int(pp or 0)
    negative = int(pm or 0)
    return {
        "asOf": datetime.now(timezone.utc).isoformat(),
        "time": now.strftime("%H:%M"),
        "dateJalali": market.get("j") or jalali_today(now),
        "source": "tradersarena",
        "breadth": {
            "positive": positive,
            "negative": negative,
            "flat": flat,
            "total": positive + negative + flat,
        },
        "orderBuyBillionToman": bt(o[1] if len(o) > 1 else None),
        "orderSellBillionToman": bt(o[0] if len(o) > 0 else None),
        "retailMoneyFlowBillionToman": bt(m[5] if len(m) > 5 else None),
        "flowStocksBillionToman": seg_flow(st),
        "flowEquityFundsBillionToman": seg_flow(sf),
        "flowFixedIncomeBillionToman": seg_flow(nsf),
        "flowBasicMetalsBillionToman": ind["flowBasicMetalsBillionToman"],
        "flowMetalOresBillionToman": ind["flowMetalOresBillionToman"],
        "flowGoldFundsBillionToman": ind["flowGoldFundsBillionToman"],
        "perCapitaBuyMillionToman": round(float(m[2]) / 1e7, 2) if len(m) > 2 and m[2] is not None else None,
        "perCapitaSellMillionToman": round(float(m[3]) / 1e7, 2) if len(m) > 3 and m[3] is not None else None,
        "note": "داده زنده TradersArena · ورود پول بازار + صنایع",
    }


def point_from_pulse(pulse: dict) -> dict | None:
    t = clamp_time(str(pulse.get("time") or ""))
    if not t:
        return None
    b = pulse.get("breadth") or {}
    return {
        "time": t,
        "positive": b.get("positive"),
        "negative": b.get("negative"),
        "flat": b.get("flat"),
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


def load_store() -> dict:
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"dateJalali": None, "history": [], "days": {}, "current": None}


def merge(store: dict, pulse: dict) -> dict:
    today = pulse.get("dateJalali")
    days = dict(store.get("days") or {})
    if store.get("dateJalali") == today:
        hist = list(store.get("history") or [])
    else:
        # roll previous day into archive
        if store.get("dateJalali") and store.get("history"):
            days[store["dateJalali"]] = store["history"]
        hist = list(days.get(today) or [])

    pt = point_from_pulse(pulse)
    if pt:
        hist = [h for h in hist if h.get("time") != pt["time"]]
        hist.append(pt)
        hist = sorted(
            [h for h in hist if PULSE_START <= str(h.get("time") or "") <= PULSE_END],
            key=lambda h: str(h.get("time") or ""),
        )[-MAX_POINTS:]

    days[today] = hist
    # prune old days
    keys = sorted(days.keys())
    if len(keys) > MAX_DAYS:
        for k in keys[:-MAX_DAYS]:
            days.pop(k, None)

    return {
        "dateJalali": today,
        "history": hist,
        "days": days,
        "current": pulse,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def in_session(now: datetime) -> bool:
    if now.weekday() not in MARKET_WEEKDAYS:
        return False
    t = now.time()
    # Cash board ~08:45–12:30; gold ETFs continue until ~18:00
    return time(8, 40) <= t <= time(18, 10)


def main() -> int:
    force = "--force" in sys.argv
    now = datetime.now(TEHRAN)
    if not force and not in_session(now):
        print(f"skip: outside cash session ({now.isoformat()})")
        return 0

    market = fetch_json(TA_MARKET)
    try:
        industries = fetch_json(TA_INDUSTRIES)
    except Exception:
        industries = None
    pulse = parse_pulse(market, industries)
    store = merge(load_store(), pulse)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(store, ensure_ascii=False, indent=2)
    OUT.write_text(payload, encoding="utf-8")
    (ROOT / "market_pulse.json").write_text(payload, encoding="utf-8")

    DAYS_DIR.mkdir(parents=True, exist_ok=True)
    day_path = DAYS_DIR / f"{str(store['dateJalali']).replace('/', '-')}.json"
    day_path.write_text(
        json.dumps(
            {
                "dateJalali": store["dateJalali"],
                "history": store["history"],
                "current": store.get("current"),
                "updatedAt": store.get("updatedAt"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "ok": True,
                "dateJalali": store["dateJalali"],
                "time": pulse.get("time"),
                "points": len(store["history"]),
                "days": len(store.get("days") or {}),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
