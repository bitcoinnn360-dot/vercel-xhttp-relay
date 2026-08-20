"""Scrape Codal interim/annual financial statements for net income / EPS."""

from __future__ import annotations

import io
import json
import re
import sys
import time
from pathlib import Path

import pandas as pd

from codal_client import CodalClient
from parse_monthly import parse_number, to_english_digits
from scrape_monthly import SYMBOLS, load_proxies

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
RAW.mkdir(parents=True, exist_ok=True)
PROC.mkdir(parents=True, exist_ok=True)

MIN_YEAR = 1400

FIN_TITLE_HINTS = (
    "صورت‌های مالی",
    "صورت های مالی",
    "اطلاعات و صورت‌های مالی",
    "اطلاعات و صورت های مالی",
)


def title_ok(title: str) -> bool:
    t = title or ""
    if not any(h in t for h in FIN_TITLE_HINTS):
        return False
    # skip pure activity / projections
    if "فعالیت ماهانه" in t:
        return False
    return True


def extract_period(title: str) -> dict:
    t = to_english_digits(title)
    end = None
    m = re.search(r"منتهی به\s*(1[34]\d{2}/\d{2}/\d{2})", t)
    if m:
        end = m.group(1)
    months = None
    mm = re.search(r"دوره\s*(\d+)\s*ماهه", t)
    if mm:
        months = int(mm.group(1))
    elif "سال مالی" in title or "سال مالي" in title:
        months = 12
    audited = "حسابرسی شده" in title or "حسابرسي شده" in title
    consolidated = "تلفیقی" in title or "تلفيقي" in title
    revision = "اصلاحیه" in title
    return {
        "period_end": end,
        "months": months,
        "audited": audited,
        "consolidated": consolidated,
        "revision": revision,
    }


def collect_fin_letters(client: CodalClient, symbol: str) -> list[dict]:
    out = []
    seen = set()
    for page, letters in client.iter_letters(symbol, max_pages=80):
        added = 0
        oldest_year = None
        for L in letters:
            title = L.get("Title") or ""
            if not title_ok(title):
                continue
            if not L.get("HasExcel"):
                continue
            meta = extract_period(title)
            if not meta["period_end"]:
                continue
            year = int(meta["period_end"].split("/")[0])
            oldest_year = year if oldest_year is None else min(oldest_year, year)
            if year < MIN_YEAR:
                continue
            key = L.get("TracingNo") or L.get("ExcelUrl")
            if key in seen:
                continue
            seen.add(key)
            item = dict(L)
            item.update({f"_{k}": v for k, v in meta.items()})
            out.append(item)
            added += 1
        print(f"  [{symbol}] fin page {page}: +{added} (total {len(out)})", flush=True)
        if oldest_year is not None and oldest_year < MIN_YEAR and added == 0:
            break
        time.sleep(0.2)
    return out


def select_best(letters: list[dict]) -> list[dict]:
    """Prefer annual 12-month separate statements; keep one per period_end."""
    # First pass: annual non-consolidated
    annual = [L for L in letters if L.get("_months") == 12 and not L.get("_consolidated")]
    if not annual:
        annual = [L for L in letters if L.get("_months") == 12]
    # Fallback: 6-month if almost no annual
    pool = annual if len(annual) >= 3 else [L for L in letters if L.get("_months") in {6, 12}]

    groups: dict[tuple, list[dict]] = {}
    for L in pool:
        # collapse cons/sep by preferring separate later via sort
        key = (L.get("_period_end"), L.get("_months"))
        groups.setdefault(key, []).append(L)
    selected = []
    for key, items in groups.items():
        items_sorted = sorted(
            items,
            key=lambda x: (
                0 if x.get("_consolidated") else 1,
                1 if x.get("_audited") else 0,
                1 if x.get("_revision") else 0,
                to_english_digits(x.get("PublishDateTime") or ""),
            ),
            reverse=True,
        )
        selected.append(items_sorted[0])
    selected.sort(key=lambda x: (x.get("_period_end") or "", x.get("_months") or 0))
    return selected


INCOME_KEYS = [
    "سود (زیان) خالص",
    "سود خالص",
    "زيان خالص",
    "سود(زیان) خالص",
    "سود (زيان) خالص",
]


def parse_income_from_html(content: bytes) -> dict:
    try:
        tables = pd.read_html(io.BytesIO(content))
    except ValueError:
        return {}

    result = {
        "net_income_mrial": None,
        "eps_rial": None,
        "revenue_mrial": None,
        "operating_profit_mrial": None,
    }

    for df in tables:
        flat_cols = " ".join(map(str, df.columns))
        # scan rows for labels
        for _, row in df.iterrows():
            cells = [to_english_digits(v).strip() for v in row.values]
            label = next((c for c in cells if c and c.lower() != "nan" and parse_number(c) is None), "")
            nums = [parse_number(c) for c in cells]
            nums = [n for n in nums if n is not None]
            if not label or not nums:
                continue
            # current period often first numeric after label
            val = nums[0]
            if any(k in label for k in INCOME_KEYS) and "هر سهم" not in label and "عملیاتی" not in label:
                if result["net_income_mrial"] is None:
                    result["net_income_mrial"] = val
            if "درآمدهای عملیاتی" in label or label == "درآمدهاي عملياتي" or "درآمد عملیاتی" in label:
                if result["revenue_mrial"] is None:
                    result["revenue_mrial"] = val
            if "سود (زیان) عملیاتی" in label or "سود عملياتي" in label or "سود عملیاتی" in label:
                if result["operating_profit_mrial"] is None:
                    result["operating_profit_mrial"] = val
            if "سود پایه هر سهم" in label or "سود هر سهم" in label or "سود (زیان) پایه هر سهم" in label:
                if result["eps_rial"] is None:
                    result["eps_rial"] = val
    return result


def scrape_symbol(client: CodalClient, info: dict) -> list[dict]:
    symbol = info["symbol"]
    sym_dir = RAW / symbol / "financials"
    sym_dir.mkdir(parents=True, exist_ok=True)
    idx_path = sym_dir / "letters.json"
    if idx_path.exists():
        letters = json.loads(idx_path.read_text(encoding="utf-8"))
    else:
        letters = collect_fin_letters(client, symbol)
        idx_path.write_text(json.dumps(letters, ensure_ascii=False, indent=2), encoding="utf-8")

    selected = select_best(letters)
    (sym_dir / "letters_selected.json").write_text(
        json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[{symbol}] financial selected {len(selected)}", flush=True)

    rows = []
    for i, L in enumerate(selected, 1):
        period = L.get("_period_end")
        months = L.get("_months")
        fname = f"fin_{period.replace('/', '-')}_{months}m_{'cons' if L.get('_consolidated') else 'sep'}.html"
        path = sym_dir / fname
        try:
            if path.exists() and path.stat().st_size > 1000:
                content = path.read_bytes()
            else:
                content = client.download_excel(L)
                path.write_bytes(content)
                time.sleep(0.25)
            parsed = parse_income_from_html(content)
            rows.append(
                {
                    "symbol": symbol,
                    "company": info["name"],
                    "group": info["group"],
                    "period_end": period,
                    "months": months,
                    "audited": L.get("_audited"),
                    "consolidated": L.get("_consolidated"),
                    "revision": L.get("_revision"),
                    "title": L.get("Title"),
                    "publish_dt": L.get("PublishDateTime"),
                    **parsed,
                }
            )
            print(
                f"  [{symbol}] {i}/{len(selected)} {period} {months}m "
                f"NI={parsed.get('net_income_mrial')} EPS={parsed.get('eps_rial')}",
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  [{symbol}] {i}/{len(selected)} ERROR {exc}", flush=True)
            rows.append(
                {
                    "symbol": symbol,
                    "period_end": period,
                    "months": months,
                    "error": str(exc),
                    "title": L.get("Title"),
                }
            )
    return rows


def main(only: list[str] | None = None) -> None:
    proxies = load_proxies()
    client = CodalClient(proxies)
    all_rows = []
    for info in SYMBOLS:
        if only and info["symbol"] not in only:
            continue
        rows = scrape_symbol(client, info)
        all_rows.extend(rows)
        (PROC / "financials.json").write_text(
            json.dumps(all_rows, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print("DONE financials", len(all_rows))


if __name__ == "__main__":
    main(sys.argv[1:] or None)
