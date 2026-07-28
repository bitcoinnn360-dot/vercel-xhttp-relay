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
    "https://www.custeel.net/sec/dgserverlet"
    "?classname=login.LoginCtrl&method=loginInUiHomeByXmlHttp&ENG=yes"
)
CUSTEEL_HOME = "https://www.custeel.net/en/"
CUSTEEL_INDICATORS = "https://www.custeel.com/reform/title/indexup_en.html"
IME_URL = "https://www.ime.co.ir/subsystems/ime/services/home/imedata.asmx/GetAmareMoamelatList"

# Seaborne FOB from country list pages (home → Iron Ore → country → latest date).
# Do NOT use price-center 外盘 — those track CFR-ish, not FOB.
CUSTEEL_FOB = {
    "pb61": {
        "country": "Australia",
        "desc": ("pb fines",),
        "grade": "61.5",
        "name": "Australian PB fines 61.5% FOB",
        "nameFa": "نرمه استرالیا PB ۶۱.۵٪ FOB",
        "unit": "دلار/تن FOB",
        "region": "global",
    },
    "brbf": {
        "country": "Brazil",
        "desc": ("brbf",),
        "grade": "62.5",
        "name": "Brazilian BRBF fines 62.5% FOB",
        "nameFa": "نرمه BRBF برزیل ۶۲.۵٪ FOB",
        "unit": "دلار/تن FOB",
        "region": "global",
    },
    "br_pellet": {
        "country": "Brazil",
        "desc": ("brazilian pellets", "pellets"),
        "grade": "65",
        "name": "Brazilian pellets 65% FOB",
        "nameFa": "گندله برزیل ۶۵٪ FOB",
        "unit": "دلار/تن FOB",
        "region": "global",
    },
    "iran_conc": {
        "country": "Iran",
        "desc": ("iranian concentrates", "concentrates"),
        "grade": "67",
        "name": "Iranian concentrates 67% FOB",
        "nameFa": "کنسانتره ایران ۶۷٪ FOB",
        "unit": "دلار/تن FOB",
        "region": "iran",
    },
    "iran_hem": {
        "country": "Iran",
        "desc": ("iranian hematite", "hematite"),
        "grade": "62",
        "name": "Iranian hematite fines 62% FOB",
        "nameFa": "هماتیت ایران ۶۲٪ FOB",
        "unit": "دلار/تن FOB",
        "region": "iran",
    },
    "chile_conc": {
        "country": "Chile",
        "desc": ("chilean concentrates", "concentrates"),
        "grade": "67",
        "name": "Chilean concentrates 67% FOB",
        "nameFa": "کنسانتره شیلی ۶۷٪ FOB",
        "unit": "دلار/تن FOB",
        "region": "global",
    },
}

# Domestic CNY market prices from Steel tab articles (not price-center codes).
CUSTEEL_DOMESTIC = {
    "rebar_beijing": {
        "name": "Beijing Rebar 16mm HRB400E",
        "nameFa": "میلگرد پکن ۱۶ میل",
        "unit": "دلار/تن",
        "region": "china",
    },
    "hr_shanghai": {
        "name": "Shanghai HRC 3.0×1500 Q235B",
        "nameFa": "ورق گرم شانگهای",
        "unit": "دلار/تن",
        "region": "china",
    },
    "tangshan_billet": {
        "name": "Tangshan Billet 150×150",
        "nameFa": "بیلت تانگشان",
        "unit": "دلار/تن",
        "region": "china",
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
    # Warm the session — bare login POSTs are often reset by Custeel.
    try:
        client.request(CUSTEEL_HOME, timeout=30)
    except Exception as exc:  # noqa: BLE001
        print(f"  custeel home warm: {exc}")
    q = urllib.parse.urlencode({"username": user, "password": passwd})
    body = client.request(f"{CUSTEEL_LOGIN}&{q}", data=b"", timeout=30)
    ok = body.strip() == b"0"
    print(f"  custeel login={'ok' if ok else body[:80]!r}")
    return ok


def _table_rows(html: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.I | re.S):
        cells = [
            " ".join(re.sub(r"<[^>]+>", " ", unescape(td)).split())
            for td in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.I | re.S)
        ]
        cells = [c for c in cells if c]
        if cells:
            rows.append(cells)
    return rows


def _article_title(html: str) -> str:
    m = re.search(r'formatTitle\("([^"]+)"', html)
    if m:
        return unescape(m.group(1)).strip()
    m = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
    return re.sub(r"\s+", " ", unescape(m.group(1))).strip() if m else ""


def _date_from_title(title: str) -> str | None:
    return _parse_english_date(title)


def _abs_custeel(href: str) -> str:
    if href.startswith("http"):
        return href
    return f"https://www.custeel.net/en/{href.lstrip('/')}"


def _country_list_url(country: str) -> str:
    q = urllib.parse.urlencode(
        {
            "menuCode": "1006004",
            "typeCode": "1009001002",
            "title": country,
            "urlName": f"Seaborne Iron Ore Price > {country}",
        }
    )
    return f"https://www.custeel.net/en/listMore.do?{q}"


def _list_article_links(html: str, *, flag: int | None = None, limit: int = 60) -> list[tuple[str, str]]:
    pat = r'href="(viewDetail\.do\?flag=(\d+)&id=[^"]+)"[^>]*>([^<]+)'
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for m in re.finditer(pat, html, re.I):
        href, fl, title = m.group(1), int(m.group(2)), " ".join(unescape(m.group(3)).split())
        if flag is not None and fl != flag:
            continue
        if href in seen:
            continue
        seen.add(href)
        out.append((href, title))
        if len(out) >= limit:
            break
    return out


def _grade_matches(cell: str, want: str) -> bool:
    g = re.sub(r"[^\d.]", "", cell or "")
    w = re.sub(r"[^\d.]", "", want or "")
    if not g or not w:
        return False
    try:
        return abs(float(g) - float(w)) < 0.05
    except ValueError:
        return g.startswith(w) or w.startswith(g)


def _desc_matches(cell: str, needles: tuple[str, ...]) -> bool:
    low = (cell or "").lower()
    return any(n.lower() in low for n in needles)


def _fob_from_rows(rows: list[list[str]], *, desc: tuple[str, ...], grade: str) -> tuple[float, float | None] | None:
    """Return (FOB, change) from a seaborne country price table."""
    fob_i = chg_i = desc_i = grade_i = None
    for row in rows:
        low = [c.lower() for c in row]
        if "fob" in low and ("description" in low or "grade" in low):
            for i, c in enumerate(low):
                if c == "fob":
                    fob_i = i
                elif c == "change":
                    chg_i = i
                elif c == "description":
                    desc_i = i
                elif c == "grade":
                    grade_i = i
            continue
        if fob_i is None or desc_i is None:
            continue
        if not _desc_matches(row[desc_i] if desc_i < len(row) else "", desc):
            continue
        if grade_i is not None and grade_i < len(row) and not _grade_matches(row[grade_i], grade):
            continue
        fob = num(row[fob_i]) if fob_i < len(row) else None
        if fob is None:
            continue
        chg = num(row[chg_i]) if chg_i is not None and chg_i < len(row) else None
        return fob, chg
    return None


def _is_exact_size_16(size: str) -> bool:
    return bool(re.fullmatch(r"[^\d]*16(?:\s*mm)?", (size or "").strip(), flags=re.I))


def _pick_beijing_rebar(rows: list[list[str]]) -> tuple[float, float | None, str] | None:
    """Beijing Rebar Φ16 HRB400E — prefer Hebei Steel."""
    candidates: list[tuple[int, float, float | None, str]] = []
    for row in rows:
        if len(row) < 5:
            continue
        city, product, size, grade = row[0], row[1], row[2], row[3]
        if city.lower() != "beijing" or product.lower() != "rebar":
            continue
        if not _is_exact_size_16(size):
            continue
        if "hrb400" not in grade.lower():
            continue
        price = num(row[4])
        if price is None:
            continue
        mill = row[5] if len(row) > 5 else ""
        chg = num(row[6]) if len(row) > 6 else None
        rank = 0 if "hebei" in mill.lower() else 1
        candidates.append((rank, price, chg, mill))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    _, price, chg, mill = candidates[0]
    return price, chg, mill


def _pick_shanghai_hrc(rows: list[list[str]]) -> tuple[float, float | None, str] | None:
    """Shanghai HRC 3.0×1500 Q235B (common spot benchmark)."""
    candidates: list[tuple[int, float, float | None, str]] = []
    for row in rows:
        if len(row) < 5:
            continue
        if row[0].lower() != "shanghai" or row[1].upper() != "HRC":
            continue
        spec = row[2].replace(" ", "").upper()
        grade = row[3].upper()
        price = num(row[4])
        if price is None:
            continue
        mill = row[5] if len(row) > 5 else ""
        chg = num(row[6]) if len(row) > 6 else None
        rank = 99
        if "3.0*1500" in spec and "Q235" in grade:
            rank = 0
        elif "5.5*1500" in spec:
            rank = 1
        elif "3.0*" in spec and "Q235" in grade:
            rank = 2
        else:
            continue
        candidates.append((rank, price, chg, f"{spec} {grade} {mill}".strip()))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    _, price, chg, label = candidates[0]
    return price, chg, label


def _pick_tangshan_billet(rows: list[list[str]]) -> tuple[float, float | None, str] | None:
    """Tangshan common carbon square billet 150×150, VAT included."""

    def pure_num(cell: str) -> float | None:
        s = (cell or "").strip().replace(",", "")
        if not re.fullmatch(r"-?\d+(?:\.\d+)?", s):
            return None
        return num(s)

    for row in rows:
        joined = " ".join(row).lower()
        if "tangshan" not in joined:
            continue
        if "billet" not in joined:
            continue
        if "vat excluded" in joined or re.search(r"\bexcluded\b", joined):
            continue
        spec = " ".join(row).replace("×", "*").replace("x", "*").lower()
        if "150*150" not in spec:
            continue
        price = None
        chg = None
        for i, cell in enumerate(row):
            v = pure_num(cell)
            if v is not None and 1000 <= v <= 20000:
                price = v
                if i + 1 < len(row):
                    chg = pure_num(row[i + 1])
                break
        if price is not None:
            return price, chg, "Common Carbon Square Billet(150*150)"
    return None


def _fetch_html(client: HttpClient, url: str, *, attempts: int = 6) -> str:
    last: Exception | None = None
    for i in range(attempts):
        try:
            return client.request(url, timeout=60, attempts=2).decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.2 * (i + 1))
    raise last or RuntimeError(url)


def _quote_row(
    *,
    sid: str,
    name: str,
    name_fa: str,
    unit: str,
    region: str,
    basis: str,
    value_usd: float,
    prev_usd: float | None,
    native: float,
    native_unit: str,
    as_of: str | None,
    source: str,
    note: str | None = None,
) -> dict[str, Any]:
    prev = prev_usd if prev_usd is not None else value_usd
    chg = round(value_usd - prev, 3)
    chg_pct = round((chg / prev) * 100, 2) if prev else 0.0
    row: dict[str, Any] = {
        "id": sid,
        "name": name,
        "nameFa": name_fa,
        "value": round(value_usd, 2),
        "unit": unit,
        "change": chg,
        "changePct": chg_pct,
        "region": region,
        "basis": basis,
        "nativeValue": native,
        "nativeUnit": native_unit,
        "asOf": as_of,
        "source": source,
    }
    if note:
        row["note"] = note
    return row


def scrape_custeel_fob(client: HttpClient) -> dict[str, Any]:
    """FOB USD from latest seaborne country articles (flag=5)."""
    steel: list[dict] = []
    histories: dict[str, list[dict]] = {}
    ok = 0
    # Group products by country to reuse list+article fetches
    by_country: dict[str, list[tuple[str, dict]]] = {}
    for sid, meta in CUSTEEL_FOB.items():
        by_country.setdefault(meta["country"], []).append((sid, meta))

    for country, items in by_country.items():
        try:
            list_html = client.request(_country_list_url(country), timeout=45).decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            print(f"  fob list {country} fail: {exc}")
            continue
        links = _list_article_links(list_html, flag=5, limit=20)
        if not links:
            print(f"  fob list {country}: no articles")
            continue
        # Parse enough articles for history (newest first)
        per_sid: dict[str, list[tuple[str, float]]] = {sid: [] for sid, _ in items}
        for idx, (href, title) in enumerate(links):
            url = _abs_custeel(href)
            try:
                html = _fetch_html(client, url, attempts=8 if idx < 3 else 4)
            except Exception as exc:  # noqa: BLE001
                print(f"  fob article fail {href}: {exc}")
                continue
            art_title = _article_title(html) or title
            as_of = _date_from_title(art_title) or _date_from_title(title)
            if not as_of:
                continue
            rows = _table_rows(html)
            for sid, meta in items:
                hit = _fob_from_rows(rows, desc=meta["desc"], grade=meta["grade"])
                if not hit:
                    continue
                fob, _chg = hit
                pts = per_sid[sid]
                if pts and pts[-1][0] == as_of:
                    continue
                pts.append((as_of, fob))
            time.sleep(0.45)

        for sid, meta in items:
            pts = list(reversed(per_sid[sid]))  # chronological
            if not pts:
                print(f"  fob {sid}: no rows")
                continue
            last_d, last_v = pts[-1]
            prev_v = pts[-2][1] if len(pts) > 1 else None
            steel.append(
                _quote_row(
                    sid=sid,
                    name=meta["name"],
                    name_fa=meta["nameFa"],
                    unit=meta["unit"],
                    region=meta["region"],
                    basis="FOB",
                    value_usd=last_v,
                    prev_usd=prev_v,
                    native=last_v,
                    native_unit=meta["unit"],
                    as_of=last_d,
                    source="custeel-seaborne-fob",
                    note=f"{country} seaborne FOB",
                )
            )
            histories[sid] = [{"date": d, "value": round(v, 3)} for d, v in pts[-180:]]
            ok += 1
            print(f"  fob {sid}: {last_v} ({last_d}) n={len(pts)}")
    return {"steel": steel, "histories": histories, "ok": ok}


def scrape_custeel_domestic(client: HttpClient, cny_usd: float) -> dict[str, Any]:
    """Beijing rebar 16 / Shanghai HRC / Tangshan billet from Steel market articles."""
    steel: list[dict] = []
    histories: dict[str, list[dict]] = {}
    ok = 0

    specs = [
        {
            "id": "rebar_beijing",
            "page": "https://www.custeel.net/en/steelpz.do?id=011004",
            "title_need": ("beijing", "rebar"),
            "pick": _pick_beijing_rebar,
            "meta": CUSTEEL_DOMESTIC["rebar_beijing"],
        },
        {
            "id": "hr_shanghai",
            "page": "https://www.custeel.net/en/steelpz.do?id=011001",
            "title_need": ("shanghai", "hr coil"),
            "pick": _pick_shanghai_hrc,
            "meta": CUSTEEL_DOMESTIC["hr_shanghai"],
        },
        {
            "id": "tangshan_billet",
            "page": "https://www.custeel.net/en/steelpz.do?id=011008",
            "title_need": ("summarization of billet",),
            "pick": _pick_tangshan_billet,
            "meta": CUSTEEL_DOMESTIC["tangshan_billet"],
        },
    ]

    for spec in specs:
        sid = spec["id"]
        meta = spec["meta"]
        try:
            page = client.request(spec["page"], timeout=45).decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            print(f"  domestic list {sid} fail: {exc}")
            continue
        links = []
        for href, title in _list_article_links(page, flag=3, limit=80):
            low = title.lower()
            if all(n in low for n in spec["title_need"]):
                links.append((href, title))
            if len(links) >= 35:
                break
        if not links:
            print(f"  domestic {sid}: no article links")
            continue
        pts: list[tuple[str, float, float | None, str]] = []
        for idx, (href, title) in enumerate(links[:20]):
            url = _abs_custeel(href)
            try:
                html = _fetch_html(client, url, attempts=8 if idx < 3 else 4)
            except Exception as exc:  # noqa: BLE001
                print(f"  domestic article fail {href}: {exc}")
                continue
            art_title = _article_title(html) or title
            as_of = _date_from_title(art_title) or _date_from_title(title)
            if not as_of:
                continue
            picked = spec["pick"](_table_rows(html))
            if not picked:
                continue
            price, chg, note = picked
            if pts and pts[-1][0] == as_of:
                continue
            pts.append((as_of, price, chg, note))
            time.sleep(0.35)
        chrono = list(reversed(pts))
        if not chrono:
            print(f"  domestic {sid}: unparsed")
            continue
        last_d, last_v, last_chg, note = chrono[-1]
        last_usd = round(last_v * cny_usd, 2)
        if len(chrono) > 1:
            prev_usd = round(chrono[-2][1] * cny_usd, 2)
        elif last_chg is not None:
            prev_usd = round((last_v - last_chg) * cny_usd, 2)
        else:
            prev_usd = None
        steel.append(
            _quote_row(
                sid=sid,
                name=meta["name"],
                name_fa=meta["nameFa"],
                unit=meta["unit"],
                region=meta["region"],
                basis="market",
                value_usd=last_usd,
                prev_usd=prev_usd,
                native=last_v,
                native_unit="یوان/تن",
                as_of=last_d,
                source="custeel-steel-market",
                note=note,
            )
        )
        histories[sid] = [
            {"date": d, "value": round(v * cny_usd, 3)} for d, v, _c, _n in chrono[-180:]
        ]
        ok += 1
        print(f"  domestic {sid}: {last_v} CNY / {last_usd} USD ({last_d}) {note}")
    return {"steel": steel, "histories": histories, "ok": ok}


def scrape_custeel_series(client: HttpClient, cny_usd: float) -> dict[str, Any]:
    fob = scrape_custeel_fob(client)
    domestic = scrape_custeel_domestic(client, cny_usd)
    steel = (fob.get("steel") or []) + (domestic.get("steel") or [])
    histories = {**(fob.get("histories") or {}), **(domestic.get("histories") or {})}
    return {"steel": steel, "histories": histories, "ok": int(fob.get("ok") or 0) + int(domestic.get("ok") or 0)}


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
        url = href if href.startswith("http") else f"https://www.custeel.net/en/{href}"
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
    url = href if href.startswith("http") else f"https://www.custeel.net/en/{href}"
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
        "chile_conc",
        "iran_conc",
        "iran_hem",
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
