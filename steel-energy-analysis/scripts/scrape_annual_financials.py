"""Download only year-end 12-month financial statement Excels for target symbols."""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from codal_client import CodalClient
from parse_monthly import to_english_digits
from scrape_monthly import SYMBOLS, load_proxies

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"


def is_annual_year_end(title: str) -> bool:
    t = title or ""
    if "فعالیت ماهانه" in t:
        return False
    if not any(x in t for x in ("صورت‌های مالی", "صورت های مالی", "اطلاعات و صورت")):
        return False
    if "سال مالی منتهی" not in t and "سال مالي منتهي" not in t:
        return False
    te = to_english_digits(t)
    m = re.search(r"1[34]\d{2}/(12)/\d{2}", te)
    return bool(m)


def extract_period(title: str) -> str | None:
    te = to_english_digits(title)
    m = re.search(r"(1[34]\d{2}/\d{2}/\d{2})", te)
    return m.group(1) if m else None


def scrape_symbol(client: CodalClient, info: dict) -> None:
    symbol = info["symbol"]
    out_dir = RAW / symbol / "financials"
    out_dir.mkdir(parents=True, exist_ok=True)
    letters = []
    for page, batch in client.iter_letters(symbol, max_pages=40):
        added = 0
        for L in batch:
            title = L.get("Title") or ""
            if not is_annual_year_end(title):
                continue
            if not L.get("HasExcel"):
                continue
            period = extract_period(title)
            if not period or int(period.split("/")[0]) < 1400:
                continue
            L = dict(L)
            L["_period_end"] = period
            L["_consolidated"] = "تلفیقی" in title
            L["_audited"] = "حسابرسی شده" in title
            letters.append(L)
            added += 1
        print(f"[{symbol}] page {page} +{added} annual (total {len(letters)})", flush=True)
        # stop once we are deep into 1399 publishes
        pubs = [to_english_digits(x.get("PublishDateTime") or "") for x in batch]
        if pubs and all(p.startswith("139") for p in pubs if p) and page > 5:
            break
        time.sleep(0.2)

    # one per period_end: prefer audited consolidated with latest publish
    by_period: dict[str, list] = {}
    for L in letters:
        by_period.setdefault(L["_period_end"], []).append(L)
    selected = []
    for period, items in sorted(by_period.items()):
        items = sorted(
            items,
            key=lambda x: (
                1 if x.get("_audited") else 0,
                1 if x.get("_consolidated") else 0,
                to_english_digits(x.get("PublishDateTime") or ""),
            ),
            reverse=True,
        )
        selected.append(items[0])

    (out_dir / "annual_letters.json").write_text(
        json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[{symbol}] selected {len(selected)} annuals", flush=True)

    for i, L in enumerate(selected, 1):
        period = L["_period_end"]
        tag = "cons" if L.get("_consolidated") else "sep"
        path = out_dir / f"fin_{period.replace('/', '-')}_12m_{tag}.html"
        if path.exists() and path.stat().st_size > 5000:
            print(f"  skip existing {path.name}", flush=True)
            continue
        try:
            content = client.download_excel(L)
            path.write_bytes(content)
            print(f"  [{i}/{len(selected)}] {period} -> {len(content)}", flush=True)
            time.sleep(0.3)
        except Exception as exc:  # noqa: BLE001
            print(f"  [{i}/{len(selected)}] {period} FAIL {exc}", flush=True)


def main(only: list[str] | None = None) -> None:
    client = CodalClient(load_proxies())
    for info in SYMBOLS:
        if only and info["symbol"] not in only:
            continue
        scrape_symbol(client, info)
    print("DONE annual financials", client.stats)


if __name__ == "__main__":
    main(sys.argv[1:] or None)
