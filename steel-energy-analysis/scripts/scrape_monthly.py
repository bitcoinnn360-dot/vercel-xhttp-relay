"""Scrape Codal monthly activity reports for steel/iron-ore symbols."""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from codal_client import CodalClient
from parse_monthly import extract_period_end, is_revision, parse_monthly_html, to_english_digits

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
RAW.mkdir(parents=True, exist_ok=True)
PROC.mkdir(parents=True, exist_ok=True)

SYMBOLS = [
    {"symbol": "کچاد", "name": "معدنی و صنعتی چادرملو", "group": "iron_ore"},
    {"symbol": "کگل", "name": "معدنی و صنعتی گل‌گهر", "group": "iron_ore"},
    {"symbol": "کگهر", "name": "گهرزمین", "group": "iron_ore"},
    {"symbol": "کنور", "name": "توسعه معدنی و صنعتی صبانور", "group": "iron_ore"},
    {"symbol": "ارفع", "name": "آهن و فولاد ارفع", "group": "steel"},
    {"symbol": "کاوه", "name": "فولاد کاوه جنوب کیش", "group": "steel"},
    {"symbol": "فصبا", "name": "صبا فولاد خلیج فارس", "group": "steel"},
    {"symbol": "فسبزوار", "name": "فولاد سبزوار", "group": "steel"},
]

MIN_YEAR = 1400


def title_years(title: str) -> list[int]:
    t = to_english_digits(title)
    return [int(x) for x in re.findall(r"1[34]\d{2}", t)]


def load_proxies() -> list[str]:
    candidates = [
        Path("/tmp/codal_ok_proxies.txt"),
        ROOT / "data" / "proxies.txt",
    ]
    proxies: list[str] = []
    for path in candidates:
        if path.exists():
            for line in path.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                proxies.append(line)
    # unique preserve order
    return list(dict.fromkeys(proxies))


def collect_monthly_letters(client: CodalClient, symbol: str) -> list[dict]:
    out: list[dict] = []
    seen: set = set()
    reached_before = False
    for page, letters in client.iter_letters(symbol, max_pages=80):
        page_monthly = 0
        for letter in letters:
            title = letter.get("Title") or ""
            if "فعالیت ماهانه" not in title:
                continue
            if not letter.get("HasExcel"):
                continue
            key = letter.get("TracingNo") or letter.get("ExcelUrl")
            if key in seen:
                continue
            years = title_years(title)
            # keep from MIN_YEAR; still collect a bit before then stop
            period = extract_period_end(title)
            period_year = int(period.split("/")[0]) if period else (min(years) if years else None)
            if period_year is not None and period_year < MIN_YEAR:
                reached_before = True
                continue
            seen.add(key)
            out.append(letter)
            page_monthly += 1
        print(f"  [{symbol}] page {page}: +{page_monthly} monthly (total {len(out)})", flush=True)
        if reached_before and page_monthly == 0:
            break
        # if oldest publish suggests we're done
        pubs = [to_english_digits(L.get("PublishDateTime") or "") for L in letters]
        if pubs and all(re.match(r"13(9\d)", p) for p in pubs if p):
            # all on page from 139x
            if reached_before:
                break
        time.sleep(0.2)
    return out


def dedupe_best_letters(letters: list[dict]) -> list[dict]:
    """Keep one letter per period_end: prefer revision (latest publish)."""
    by_period: dict[str, list[dict]] = {}
    for letter in letters:
        period = extract_period_end(letter.get("Title") or "")
        if not period:
            continue
        by_period.setdefault(period, []).append(letter)

    selected = []
    for period, items in sorted(by_period.items()):
        # prefer اصلاحیه with latest publish datetime
        items_sorted = sorted(
            items,
            key=lambda L: (
                1 if is_revision(L.get("Title") or "") else 0,
                to_english_digits(L.get("PublishDateTime") or ""),
            ),
            reverse=True,
        )
        best = items_sorted[0]
        best = dict(best)
        best["_period_end"] = period
        best["_is_revision"] = is_revision(best.get("Title") or "")
        selected.append(best)
    return selected


def scrape_symbol(client: CodalClient, symbol_info: dict) -> dict:
    symbol = symbol_info["symbol"]
    sym_dir = RAW / symbol
    sym_dir.mkdir(parents=True, exist_ok=True)
    letters_path = sym_dir / "monthly_letters.json"

    if letters_path.exists():
        letters = json.loads(letters_path.read_text(encoding="utf-8"))
        print(f"[{symbol}] loaded {len(letters)} cached letters", flush=True)
    else:
        print(f"[{symbol}] collecting monthly letter index...", flush=True)
        letters = collect_monthly_letters(client, symbol)
        letters_path.write_text(json.dumps(letters, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[{symbol}] saved {len(letters)} letters", flush=True)

    selected = dedupe_best_letters(letters)
    (sym_dir / "monthly_letters_selected.json").write_text(
        json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[{symbol}] selected {len(selected)} unique periods", flush=True)

    rows_energy = []
    rows_products = []
    errors = []

    for i, letter in enumerate(selected, 1):
        period = letter["_period_end"]
        excel_path = sym_dir / f"monthly_{period.replace('/', '-')}.html"
        meta = {
            "symbol": symbol,
            "company": symbol_info["name"],
            "group": symbol_info["group"],
            "period_end": period,
            "title": letter.get("Title"),
            "publish_dt": letter.get("PublishDateTime"),
            "tracing_no": letter.get("TracingNo"),
            "is_revision": letter.get("_is_revision"),
            "excel_url": letter.get("ExcelUrl"),
        }
        try:
            if excel_path.exists() and excel_path.stat().st_size > 1000:
                content = excel_path.read_bytes()
            else:
                content = client.download_excel(letter)
                excel_path.write_bytes(content)
                time.sleep(0.25)
            parsed = parse_monthly_html(content, period_end=period)
            for e in parsed["energy"]:
                rows_energy.append({**meta, **e})
            for p in parsed["products"]:
                rows_products.append({**meta, **p})
            print(
                f"  [{symbol}] {i}/{len(selected)} {period}: "
                f"energy={len(parsed['energy'])} products={len(parsed['products'])}",
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001
            err = {**meta, "error": str(exc)}
            errors.append(err)
            print(f"  [{symbol}] {i}/{len(selected)} {period}: ERROR {exc}", flush=True)

    return {
        "symbol": symbol,
        "energy": rows_energy,
        "products": rows_products,
        "errors": errors,
        "n_periods": len(selected),
    }


def main(symbols: list[str] | None = None) -> None:
    proxies = load_proxies()
    if not proxies:
        print("No proxies found in /tmp/codal_ok_proxies.txt", file=sys.stderr)
        sys.exit(1)
    print(f"Using {len(proxies)} proxies", flush=True)
    client = CodalClient(proxies)

    wanted = set(symbols) if symbols else None
    all_energy = []
    all_products = []
    all_errors = []
    summary = []

    for info in SYMBOLS:
        if wanted and info["symbol"] not in wanted:
            continue
        result = scrape_symbol(client, info)
        all_energy.extend(result["energy"])
        all_products.extend(result["products"])
        all_errors.extend(result["errors"])
        summary.append(
            {
                "symbol": info["symbol"],
                "n_periods": result["n_periods"],
                "n_energy_rows": len(result["energy"]),
                "n_product_rows": len(result["products"]),
                "n_errors": len(result["errors"]),
            }
        )
        # checkpoint after each symbol
        (PROC / "energy_monthly.json").write_text(
            json.dumps(all_energy, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (PROC / "products_monthly.json").write_text(
            json.dumps(all_products, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (PROC / "scrape_errors.json").write_text(
            json.dumps(all_errors, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (PROC / "scrape_summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    print("DONE", json.dumps(summary, ensure_ascii=False, indent=2))
    print("client stats", client.stats)


if __name__ == "__main__":
    only = sys.argv[1:] or None
    main(only)
