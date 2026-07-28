#!/usr/bin/env python3
"""Scrape Custeel (China) + IME offer-stat (Iran) for the steel-chain dashboard.

Credentials (never commit):
  CUSTEEL_USER / CUSTEEL_PASS   — or CUSTEEL_COOKIE=`JSESSIONID=…`

Outputs:
  public/data/steel_chain.json
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
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "steel_chain.json"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
SSL_CTX = ssl._create_unverified_context()

CUSTEEL_LOGIN = (
    "http://www.custeel.net/sec/dgserverlet"
    "?classname=login.LoginCtrl&method=loginInUiHomeByXmlHttp&ENG=yes"
)
CUSTEEL_HOME = "http://www.custeel.net/en/"
CUSTEEL_PRICE = "http://www.custeel.net/luliao/price_center_image_en.jsp"
CUSTEEL_INDICATORS = "http://www.custeel.com/reform/title/indexup_en.html"
IME_URL = "https://www.ime.co.ir/subsystems/ime/services/home/imedata.asmx/GetAmareMoamelatList"

# Foreign quotes (外盘) = seaborne FOB USD. Domestic steel stays CNY market price.
CUSTEEL_SERIES = {
    "pb61": {
        "code": "001005001001008",
        "nameFa": "نرمه استرالیا PB ۶۱.۵٪ FOB",
        "unit": "دلار/تن FOB",
        "region": "global",
        "currency": "usd",
        "basis": "FOB",
    },
    "brbf": {
        "code": "001005001001005",
        "nameFa": "نرمه کاراجاس برزیل ۶۵٪ FOB",
        "unit": "دلار/تن FOB",
        "region": "global",
        "currency": "usd",
        "basis": "FOB",
    },
    "br_pellet": {
        "code": "001005001001007",
        "nameFa": "گندله برزیل ۶۵٪ FOB",
        "unit": "دلار/تن FOB",
        "region": "global",
        "currency": "usd",
        "basis": "FOB",
    },
    "tangshan_billet": {
        "code": "001002001001001",
        "nameFa": "بیلت تانگشان",
        "unit": "دلار/تن",
        "region": "china",
        "currency": "cny",
        "basis": "market",
    },
    "hr_shanghai": {
        "code": "001001001001005031",
        "nameFa": "ورق گرم شانگهای",
        "unit": "دلار/تن",
        "region": "china",
        "currency": "cny",
        "basis": "market",
    },
    "rebar_beijing": {
        "code": "001001001001002075",
        "nameFa": "میلگرد تانگشان",
        "unit": "دلار/تن",
        "region": "china",
        "currency": "cny",
        "basis": "market",
    },
}

# Map IME GoodsName keywords → chain product + steel quote id
IME_PRODUCTS = [
    {"id": "ime_hr", "product": "ورق گرم (مبارکه)", "keywords": ("ورق گرم", "گرم نورد", "ورق‌گرم"), "prefer": ("مبارکه",)},
    {"id": "ime_rebar", "product": "میلگرد متوسط", "keywords": ("میلگرد",), "prefer": ()},
    {"id": "ime_billet", "product": "بیلت (میانگین شمش)", "keywords": ("شمش", "بیلت"), "prefer": ("بلوم", "شمش بلوم", "شمش فولادی")},
    {"id": "ime_dri", "product": "آهن اسفنجی", "keywords": ("اسفنجی", "آهن اسفنجی"), "prefer": ()},
    {"id": "ime_pellet", "product": "گندله", "keywords": ("گندله",), "prefer": ()},
    {"id": "ime_conc", "product": "کنسانتره", "keywords": ("کنسانتره",), "prefer": ()},
    {"id": "ime_ore", "product": "سنگ آهن دانه‌بندی ۶۰٪", "keywords": ("دانه‌بندی", "دانه بندی", "سنگ آهن"), "prefer": ("دانه‌بندی", "دانه بندی")},
]


def tehran_now() -> datetime:
    return datetime.now(ZoneInfo("Asia/Tehran"))


def num(x: Any) -> float | None:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", "").replace("٬", "").replace("%", "")
    if not s or s in {"-", "—", "null", "None"}:
        return None
    try:
        return float(s)
    except ValueError:
        try:
            return float(re.sub(r"[^\d.-]", "", s) or "nan")
        except ValueError:
            return None


class HttpClient:
    def __init__(self) -> None:
        self.cj = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cj),
            urllib.request.HTTPSHandler(context=SSL_CTX),
        )

    def request(
        self,
        url: str,
        *,
        data: dict | bytes | None = None,
        headers: dict | None = None,
        timeout: int = 45,
        method: str | None = None,
        attempts: int = 4,
    ) -> bytes:
        last: Exception | None = None
        for i in range(attempts):
            try:
                hdrs = {"User-Agent": UA, **(headers or {})}
                body: bytes | None = None
                if isinstance(data, dict):
                    body = urllib.parse.urlencode(data).encode()
                    hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
                elif isinstance(data, (bytes, bytearray)):
                    body = bytes(data)
                req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
                with self.opener.open(req, timeout=timeout) as resp:
                    return resp.read()
            except Exception as exc:  # noqa: BLE001
                last = exc
                time.sleep(0.9 * (i + 1))
        raise last or RuntimeError(f"request failed: {url}")

    def request_json(self, url: str, payload: dict, *, headers: dict | None = None, timeout: int = 60) -> Any:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        hdrs = {
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*; q=0.01",
            "Content-Type": "application/json; charset=utf-8",
            "X-Requested-With": "XMLHttpRequest",
            **(headers or {}),
        }
        raw = self.request(url, data=body, headers=hdrs, timeout=timeout, method="POST")
        return json.loads(raw.decode("utf-8", errors="replace"))


def fetch_cny_usd() -> float:
    urls = [
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json",
        "https://open.er-api.com/v6/latest/CNY",
    ]
    for u in urls:
        try:
            raw = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=20).read()
            data = json.loads(raw.decode("utf-8", errors="replace"))
            if "cny" in data and isinstance(data["cny"], dict):
                v = num(data["cny"].get("usd"))
                if v and v > 0:
                    return v
            rates = data.get("rates") or {}
            v = num(rates.get("USD"))
            if v and v > 0:
                return v
        except Exception as exc:  # noqa: BLE001
            print(f"  fx {u}: {exc}")
    return 0.139  # fallback ~7.2 CNY/USD


def fetch_usd_irr() -> float | None:
    try:
        raw = urllib.request.urlopen(
            urllib.request.Request("https://call2.tgju.org/ajax.json", headers={"User-Agent": UA}),
            timeout=25,
        ).read()
        cur = (json.loads(raw.decode("utf-8", errors="replace")).get("current") or {}).get("price_dollar_rl") or {}
        return num(cur.get("p"))
    except Exception as exc:  # noqa: BLE001
        print(f"  usd irr: {exc}")
        return None


def custeel_login(client: HttpClient) -> bool:
    cookie = (os.environ.get("CUSTEEL_COOKIE") or "").strip()
    if cookie:
        # Inject JSESSIONID manually via Cookie header on subsequent requests by storing on jar is hard;
        # instead stash as default header via monkey patch.
        client._extra_cookie = cookie  # type: ignore[attr-defined]
        orig = client.request

        def wrapped(url, **kw):  # type: ignore[no-untyped-def]
            hdrs = dict(kw.get("headers") or {})
            hdrs["Cookie"] = cookie if "Cookie" not in hdrs else hdrs["Cookie"]
            kw["headers"] = hdrs
            return orig(url, **kw)

        client.request = wrapped  # type: ignore[method-assign]
        return True

    user = (os.environ.get("CUSTEEL_USER") or "").strip()
    passwd = (os.environ.get("CUSTEEL_PASS") or "").strip()
    if not user or not passwd:
        print("  custeel: missing CUSTEEL_USER/PASS (or CUSTEEL_COOKIE)")
        return False
    q = urllib.parse.urlencode({"username": user, "password": passwd})
    body = client.request(f"{CUSTEEL_LOGIN}&{q}", data=b"", timeout=30)
    ok = body.strip() == b"0"
    print(f"  custeel login={'ok' if ok else body[:80]!r}")
    return ok


def parse_custeel_price(raw: bytes) -> tuple[str, list[tuple[str, float]]]:
    text = raw.decode("utf-8", errors="replace")
    parts = text.split("|")
    title = unescape(parts[3]).strip() if len(parts) > 3 else ""
    table = parts[2] if len(parts) > 2 else ""
    pts: list[tuple[str, float]] = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.I | re.S):
        cells = [
            " ".join(re.sub(r"<[^>]+>", " ", unescape(td)).split())
            for td in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.I | re.S)
        ]
        cells = [c for c in cells if c]
        if len(cells) < 2 or cells[0].lower() == "date":
            continue
        d, v = cells[0], num(cells[1])
        if d and v is not None:
            pts.append((d[:10], v))
    # newest first in table → reverse for chronological
    pts.reverse()
    return title, pts


def scrape_custeel_series(client: HttpClient, cny_usd: float) -> dict[str, Any]:
    steel: list[dict] = []
    histories: dict[str, list[dict]] = {}
    ok = 0
    for sid, meta in CUSTEEL_SERIES.items():
        try:
            raw = client.request(
                CUSTEEL_PRICE,
                data={"table": meta["code"], "typeNum": "1", "quanxian": "true"},
                headers={"Referer": "http://www.custeel.net/luliao/price_center_en.jsp", "Origin": "http://www.custeel.net"},
                timeout=60,
            )
            title, pts = parse_custeel_price(raw)
            if len(pts) < 2:
                raise RuntimeError(f"empty series {sid}")
            last_d, last_v = pts[-1]
            prev_v = pts[-2][1]
            if meta["currency"] == "cny":
                last_usd = round(last_v * cny_usd, 2)
                prev_usd = round(prev_v * cny_usd, 2)
                native = last_v
            else:
                last_usd = round(last_v, 2)
                prev_usd = round(prev_v, 2)
                native = last_v
            chg = round(last_usd - prev_usd, 3)
            chg_pct = round((chg / prev_usd) * 100, 2) if prev_usd else 0.0
            steel.append(
                {
                    "id": sid,
                    "name": title or sid,
                    "nameFa": meta["nameFa"],
                    "value": last_usd,
                    "unit": meta["unit"],
                    "change": chg,
                    "changePct": chg_pct,
                    "region": meta["region"],
                    "basis": meta.get("basis"),
                    "nativeValue": native,
                    "nativeUnit": "یوان/تن" if meta["currency"] == "cny" else meta["unit"],
                    "asOf": last_d,
                    "source": "custeel-price-center",
                }
            )
            # keep ~180 points for charts (USD)
            hist_pts = pts[-180:]
            histories[sid] = [
                {
                    "date": d,
                    "value": round(v * cny_usd, 3) if meta["currency"] == "cny" else round(v, 3),
                }
                for d, v in hist_pts
            ]
            ok += 1
            print(f"  series {sid}: {last_usd} {meta.get('basis') or ''} ({last_d})")
            time.sleep(0.35)
        except Exception as exc:  # noqa: BLE001
            print(f"  series {sid} fail: {exc}")
    return {"steel": steel, "histories": histories, "ok": ok}


_MONTHS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def _parse_english_date(text: str) -> str | None:
    """Parse 'Jul 23, 2026' / 'July 23, 2026' → YYYY-MM-DD."""
    m = re.search(r"\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b", text)
    if not m:
        return None
    mon = _MONTHS.get(m.group(1)[:3].lower())
    if not mon:
        return None
    return f"{int(m.group(3)):04d}-{mon:02d}-{int(m.group(2)):02d}"


def _article_plain(html: str) -> str:
    plain = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.I | re.S)
    plain = re.sub(r"<style[^>]*>.*?</style>", " ", plain, flags=re.I | re.S)
    plain = re.sub(r"<[^>]+>", " ", plain)
    return re.sub(r"\s+", " ", unescape(plain))


def scrape_tangshan_bf(client: HttpClient) -> dict[str, Any]:
    """Tangshan BF operating rate from weekly research articles (not the national widget).

    Uses «operating rate by number of blast furnaces» and the *session ending* date
    inside the article body (publish date is often +1 day).
    """
    home = client.request(CUSTEEL_HOME, timeout=45).decode("utf-8", errors="replace")
    links = re.findall(
        r'href="(viewDetail\.do\?flag=3&id=\d+)"[^>]*>\s*([^<]*BF Operating Rate in Tangshan[^<]*)',
        home,
        flags=re.I,
    )
    if not links:
        return {"ok": False, "error": "no BF Tangshan links"}

    history: list[dict] = []
    latest: dict[str, Any] | None = None
    for href, title in links[:8]:
        url = href if href.startswith("http") else f"http://www.custeel.net/en/{href}"
        try:
            html = client.request(url, timeout=45).decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            print(f"  bf article fail {href}: {exc}")
            continue
        text = _article_plain(html)
        sess = re.search(r"session ending\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})", text, re.I)
        as_of = _parse_english_date(sess.group(1)) if sess else None
        pub = re.search(r"(20\d{2}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}", text)
        published = pub.group(1) if pub else None
        # Prefer furnace-count rate (user: 87.95%); also capture capacity-based.
        m_num = re.search(
            r"operating rate by number of blast furnaces was\s*([\d.]+)\s*%"
            r"(?P<tail>.{0,80})",
            text,
            re.I,
        )
        m_cap = re.search(
            r"leading to an operating rate of\s*([\d.]+)\s*%"
            r"(?P<tail>.{0,80})",
            text,
            re.I,
        )
        if not m_num:
            continue
        rate = num(m_num.group(1))
        if rate is None:
            continue
        wow = 0.0
        tail = m_num.group("tail") or ""
        m_wow = re.search(r"(?:falling|down|declining)\s+by\s*([\d.]+)\s*%", tail, re.I)
        if m_wow:
            wow = -abs(float(m_wow.group(1)))
        else:
            m_wow = re.search(r"(?:rising|up|gaining)\s+by\s*([\d.]+)\s*%", tail, re.I)
            if m_wow:
                wow = abs(float(m_wow.group(1)))
            elif re.search(r"keep(?:ing)?\s+stable|unchanged|flat", tail, re.I):
                wow = 0.0
        cap_rate = num(m_cap.group(1)) if m_cap else None
        row = {
            "rate": rate,
            "wowChangePct": wow,
            "capacityRate": cap_rate,
            "asOf": as_of or published,
            "published": published,
            "title": title.strip(),
            "url": url,
            "source": "custeel-tangshan-bf-article",
            "note": "by number of blast furnaces; asOf=session ending",
        }
        history.append({"date": row["asOf"], "value": rate, "wowChangePct": wow})
        if latest is None:
            latest = row
        time.sleep(0.25)

    if not latest:
        return {"ok": False, "error": "BF articles unparsed"}
    latest["history"] = list(reversed(history))
    print(
        f"  BF Tangshan: {latest['rate']}% asOf={latest['asOf']} "
        f"(published {latest['published']}) wow={latest['wowChangePct']}"
    )
    return {"ok": True, **latest}


def scrape_ore_port_stocks(client: HttpClient) -> dict[str, Any]:
    """Major China ports iron-ore stocks from the weekly inventory article (not sidebar widget)."""
    home = client.request(CUSTEEL_HOME, timeout=45).decode("utf-8", errors="replace")
    links = re.findall(
        r'href="(viewDetail\.do\?flag=3&id=\d+)"[^>]*>\s*([^<]*Iron Ore in Stock of Major[^<]*)',
        home,
        flags=re.I,
    )
    if not links:
        return {"ok": False, "error": "no ore stock links"}
    href, title = links[0]
    url = href if href.startswith("http") else f"http://www.custeel.net/en/{href}"
    html = client.request(url, timeout=60).decode("utf-8", errors="replace")
    # Update date in title: (Update: Jul 24, 2026)
    as_of = None
    m_upd = re.search(r"Update:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})", title + " " + html, re.I)
    if m_upd:
        as_of = _parse_english_date(m_upd.group(1))
    total = wow = None
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.I | re.S):
        cells = [
            " ".join(re.sub(r"<[^>]+>", " ", unescape(td)).split())
            for td in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.I | re.S)
        ]
        cells = [c for c in cells if c]
        if cells and cells[0].lower() == "total" and len(cells) >= 3:
            total = num(cells[1])
            wow = num(cells[2]) or 0.0
            break
    if total is None:
        return {"ok": False, "error": "total row missing", "url": url}
    print(f"  ore ports: {total} kt wow={wow} asOf={as_of} ({title.strip()[:48]})")
    return {
        "ok": True,
        "label": "موجودی انبار سنگ‌آهن بنادر چین",
        "value": total,
        "wowChange": wow,
        "unit": "هزار تن",
        "asOf": as_of,
        "title": title.strip(),
        "url": url,
        "source": "custeel-port-stocks-article",
    }


def scrape_custeel_indicators(client: HttpClient) -> dict[str, Any]:
    """Sidebar CSI indices + Tangshan billet stocks widget (BF/ore stocks overridden by articles)."""
    raw = client.request(CUSTEEL_INDICATORS, timeout=30)
    html = raw.decode("utf-8", errors="replace")
    rows: list[list[str]] = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.I | re.S):
        cells = [
            " ".join(re.sub(r"<[^>]+>", " ", unescape(td)).split())
            for td in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.I | re.S)
        ]
        cells = [c for c in cells if c]
        if cells:
            rows.append(cells)

    def find_row(*needles: str) -> list[str] | None:
        for r in rows:
            joined = " ".join(r).lower()
            if all(n.lower() in joined for n in needles):
                return r
        return None

    out: dict[str, Any] = {"ok": False, "rows": []}
    for r in rows[1:]:
        if len(r) >= 2:
            out["rows"].append({"label": r[0], "latest": r[1], "change": r[2] if len(r) > 2 else None})

    steel_extra: list[dict] = []
    sea = find_row("seaborne", "62")
    port = find_row("portside", "62")
    if sea:
        v = num(sea[1])
        ch = num(sea[2]) or 0.0
        if v:
            steel_extra.append(
                {
                    "id": "seaborne62",
                    "name": "CSI Seaborne Index Fe62%",
                    "nameFa": "شاخص سنگ‌آهن دریایی ۶۲٪ (CSI)",
                    "value": v,
                    "unit": "دلار/تن",
                    "change": ch,
                    "changePct": round((ch / (v - ch)) * 100, 2) if (v - ch) else 0.0,
                    "region": "global",
                    "basis": "index",
                    "source": "custeel-indicator",
                }
            )
    if port:
        v = num(port[1])
        ch = num(port[2]) or 0.0
        if v:
            steel_extra.append(
                {
                    "id": "portside62",
                    "name": "CSI Portside Index Fe62%",
                    "nameFa": "شاخص سنگ‌آهن بندری ۶۲٪",
                    "value": v,
                    "unit": "دلار/تن",
                    "change": ch,
                    "changePct": round((ch / (v - ch)) * 100, 2) if (v - ch) else 0.0,
                    "region": "china",
                    "basis": "portside",
                    "source": "custeel-indicator",
                }
            )

    billet_stocks = None
    bil_stk = find_row("tangshan billet stocks")
    if bil_stk:
        v = num(bil_stk[1])
        ch = num(bil_stk[2]) or 0.0
        if v is not None:
            billet_stocks = {
                "label": "موجودی بیلت تانگشان",
                "value": v,
                "wowChange": ch,
                "unit": "هزار تن",
                "source": "custeel-indicator",
            }

    # Article-backed KPIs (preferred over national sidebar BF / stale ore widget)
    bf = scrape_tangshan_bf(client)
    ore = scrape_ore_port_stocks(client)

    inventories = None
    if ore.get("ok"):
        inventories = {
            "label": ore["label"],
            "value": ore["value"],
            "wowChange": ore["wowChange"],
            "unit": ore["unit"],
            "asOf": ore.get("asOf"),
            "source": ore["source"],
        }

    bf_rate = None
    if bf.get("ok"):
        bf_rate = {
            "rate": bf["rate"],
            "wowChangePct": bf["wowChangePct"],
            "capacityRate": bf.get("capacityRate"),
            "asOf": bf.get("asOf"),
            "published": bf.get("published"),
            "source": bf["source"],
            "note": bf.get("note"),
        }

    out.update(
        {
            "ok": True,
            "steelExtra": steel_extra,
            "inventories": inventories,
            "bfRate": bf_rate,
            "billetStocks": billet_stocks,
            "bfHistory": bf.get("history") or [],
        }
    )
    return out


def _jalali_today() -> str:
    try:
        import jdatetime  # type: ignore

        j = jdatetime.date.today()
        return f"{j.year:04d}/{j.month:02d}/{j.day:02d}"
    except Exception:
        # crude fallback via algorithm
        now = tehran_now()
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
        return f"{jy:04d}/{jm:02d}/{jd:02d}"


def _jalali_minus_days(days_back: int) -> str:
    try:
        import jdatetime  # type: ignore

        j = jdatetime.date.today() - jdatetime.timedelta(days=days_back)
        return f"{j.year:04d}/{j.month:02d}/{j.day:02d}"
    except Exception:
        return _jalali_today()


def scrape_ime(client: HttpClient, usd_irr: float | None) -> dict[str, Any]:
    """Pull recent physical trades from offer-stat backend (needs Iran-reachable IP)."""
    end = _jalali_today()
    start = _jalali_minus_days(21)
    payload = {
        "Language": 8,
        "fari": False,
        "GregorianFromDate": start,
        "GregorianToDate": end,
        "MainCat": 0,
        "Cat": 0,
        "SubCat": 0,
        "Producer": 0,
    }
    try:
        data = client.request_json(
            IME_URL,
            payload,
            headers={"Origin": "https://www.ime.co.ir", "Referer": "https://www.ime.co.ir/offer-stat.html"},
            timeout=90,
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "source": "ime-offer-stat"}

    raw = data.get("d", "[]")
    records = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(records, list):
        return {"ok": False, "error": "unexpected shape", "source": "ime-offer-stat"}

    # Normalize loosely — fima expects fixed columns after dropping *1 fields
    normed: list[dict] = []
    for row in records:
        if not isinstance(row, dict):
            continue
        # ASP.NET serializers often camel/lower mixed
        goods = str(row.get("GoodsName") or row.get("bArzehNameKala") or row.get("goodsName") or "")
        symbol = str(row.get("Symbol") or row.get("bArzehRadifNamad") or row.get("symbol") or "")
        close = num(row.get("ClosePrice") or row.get("bArzehRadifGheymat") or row.get("closePrice"))
        date = str(row.get("Date") or row.get("bArzehTarSal") or row.get("date") or "")
        producer = str(row.get("ProducerName") or row.get("producerName") or "")
        if not goods and not symbol:
            # fall back: take first string-ish values
            vals = list(row.values())
            if len(vals) >= 6:
                goods = str(vals[0] or "")
                symbol = str(vals[1] or "")
                close = num(vals[4]) if close is None else close
                date = str(vals[14] if len(vals) > 14 else vals[-1] or "")
        if close is None or close <= 0:
            continue
        normed.append(
            {
                "goods": goods,
                "symbol": symbol,
                "producer": producer,
                "close": close,
                "date": date.replace("-", "/")[:10],
            }
        )

    if not normed:
        # dump keys for debugging once
        sample = records[0] if records else {}
        return {
            "ok": False,
            "error": "no priced rows",
            "sampleKeys": list(sample.keys())[:40] if isinstance(sample, dict) else [],
            "count": len(records),
            "source": "ime-offer-stat",
        }

    def match_rows(spec: dict) -> list[dict]:
        hits = []
        for r in normed:
            blob = f"{r['goods']} {r['symbol']} {r['producer']}"
            if any(k in blob for k in spec["keywords"]):
                hits.append(r)
        if spec.get("prefer"):
            pref = [r for r in hits if any(p in f"{r['goods']} {r['producer']}" for p in spec["prefer"])]
            if pref:
                return pref
        return hits

    chain: list[dict] = []
    steel_ime: list[dict] = []
    for spec in IME_PRODUCTS:
        hits = match_rows(spec)
        if not hits:
            continue
        # latest by date then average that day's closes
        hits.sort(key=lambda r: r["date"], reverse=True)
        latest_date = hits[0]["date"]
        day = [r for r in hits if r["date"] == latest_date]
        avg = sum(r["close"] for r in day) / len(day)
        # IME physical ClosePrice is typically Rial/kg for steel chain
        price_rial_kg = avg
        chain.append(
            {
                "product": spec["product"],
                "priceRialKg": round(price_rial_kg),
                "ratioToBilletPct": 0.0,
                "tradeDate": latest_date,
                "source": "ime-offer-stat",
                "samples": len(day),
            }
        )
        if usd_irr and usd_irr > 0:
            usd_ton = round((price_rial_kg * 1000) / usd_irr, 2)
            steel_ime.append(
                {
                    "id": spec["id"],
                    "name": spec["product"],
                    "nameFa": spec["product"].replace(" (مبارکه)", "").replace(" (میانگین شمش)", ""),
                    "value": usd_ton,
                    "unit": "دلار/تن",
                    "change": 0,
                    "changePct": 0,
                    "region": "iran",
                    "asOf": latest_date,
                    "source": "ime-offer-stat",
                }
            )

    billet = next((c for c in chain if c["product"].startswith("بیلت")), None)
    if billet and billet["priceRialKg"] > 0:
        for c in chain:
            c["ratioToBilletPct"] = round(c["priceRialKg"] / billet["priceRialKg"] * 100, 1)

    # Preferred display order
    order = [p["product"] for p in IME_PRODUCTS]
    chain.sort(key=lambda c: order.index(c["product"]) if c["product"] in order else 99)

    return {
        "ok": True,
        "source": "ime-offer-stat",
        "from": start,
        "to": end,
        "tradeCount": len(normed),
        "imeChain": chain,
        "steel": steel_ime,
    }


def merge_steel(base: list[dict], extra: list[dict]) -> list[dict]:
    by_id = {s["id"]: s for s in base}
    for s in extra:
        by_id[s["id"]] = s
    # stable-ish order for UI
    preferred = [
        "seaborne62",
        "portside62",
        "pb61",
        "brbf",
        "br_pellet",
        "ime_ore",
        "ime_conc",
        "ime_pellet",
        "ime_dri",
        "tangshan_billet",
        "ime_billet",
        "hr_shanghai",
        "ime_hr",
        "rebar_beijing",
        "ime_rebar",
    ]
    out = []
    seen = set()
    for pid in preferred:
        if pid in by_id:
            out.append(by_id[pid])
            seen.add(pid)
    for pid, row in by_id.items():
        if pid not in seen:
            out.append(row)
    return out


def main() -> int:
    print("steel chain scrape…")
    client = HttpClient()
    cny_usd = fetch_cny_usd()
    usd_irr = fetch_usd_irr()
    print(f"  FX CNY/USD={cny_usd}  USD/IRR={usd_irr}")

    custeel_ok = False
    series: dict[str, Any] = {"steel": [], "histories": {}, "ok": 0}
    indicators: dict[str, Any] = {"ok": False}
    if custeel_login(client):
        custeel_ok = True
        indicators = scrape_custeel_indicators(client)
        print(f"  indicators ok={indicators.get('ok')}")
        series = scrape_custeel_series(client, cny_usd)

    print("  IME offer-stat…")
    ime = scrape_ime(client, usd_irr)
    print(f"  ime ok={ime.get('ok')} err={ime.get('error')}")

    steel = merge_steel(series.get("steel") or [], (indicators.get("steelExtra") or []) + (ime.get("steel") or []))

    custeel_ready = bool(custeel_ok and series.get("ok", 0) > 0)
    ime_ready = bool(ime.get("ok"))
    if custeel_ready and ime_ready:
        source = "custeel+ime"
    elif custeel_ready:
        source = "custeel"
    elif ime_ready:
        source = "ime"
    else:
        source = "none"

    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "ok": custeel_ready or ime_ready,
        "custeelOk": custeel_ready,
        "imeOk": ime_ready,
        "cnyUsd": cny_usd,
        "usdIrr": usd_irr,
        "steel": steel,
        "imeChain": ime.get("imeChain") or [],
        "inventories": indicators.get("inventories"),
        "bfRate": indicators.get("bfRate"),
        "billetStocks": indicators.get("billetStocks"),
        "histories": series.get("histories") or {},
        "indicators": indicators.get("rows") or [],
        "imeMeta": {k: ime.get(k) for k in ("from", "to", "tradeCount", "error", "sampleKeys") if k in ime},
        "source": source,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT} steel={len(steel)} imeChain={len(payload['imeChain'])} hist={len(payload['histories'])}")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
