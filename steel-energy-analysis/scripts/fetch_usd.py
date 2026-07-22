"""Fetch free-market USD/IRR daily history from TGJU for dollarization."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)

# TGJU free-market dollar (price_dollar_rl) historical table endpoint
URL = "https://api.tgju.org/v1/market/indicator/summary-table-data/price_dollar_rl"


def fetch_dollar_history() -> pd.DataFrame:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": "https://www.tgju.org/",
    }
    # DataTables-style params used by TGJU charts
    params = {
        "draw": 1,
        "start": 0,
        "length": 5000,
        "order[0][column]": 0,
        "order[0][dir]": "desc",
    }
    r = requests.get(URL, params=params, headers=headers, timeout=60)
    r.raise_for_status()
    payload = r.json()
    rows = payload.get("data") or []
    # each row typically: [date_jalali, open, low, high, close, ...] or similar
    records = []
    for row in rows:
        if not row:
            continue
        # TGJU returns HTML-ish / string cells
        cells = [str(c).replace(",", "").replace("٬", "").strip() for c in row]
        # Find jalali date like 1403/01/15 or gregorian
        date_j = None
        nums = []
        for c in cells:
            if "/" in c and any(ch.isdigit() for ch in c):
                # prefer first date-like
                if date_j is None and c.count("/") == 2:
                    date_j = c
                    continue
            try:
                nums.append(float(c))
            except ValueError:
                continue
        if not date_j or not nums:
            continue
        # close usually last meaningful price
        close = nums[-1] if nums else None
        records.append({"date_jalali": date_j, "usd_irr": close, "raw": cells})
    df = pd.DataFrame(records)
    if df.empty:
        # fallback: try alternate endpoint used by some scrapers
        alt = requests.get(
            "https://api.tgju.org/v1/market/indicator/summary-table-data/price_dollar_rl",
            headers=headers,
            timeout=60,
        )
        alt.raise_for_status()
        print("empty parse; keys=", alt.json().keys())
        print("sample", (alt.json().get("data") or [])[:2])
    return df


def main() -> None:
    df = fetch_dollar_history()
    path_json = OUT / "usd_irr_daily.json"
    path_csv = OUT / "usd_irr_daily.csv"
    df.drop(columns=[c for c in df.columns if c == "raw"], errors="ignore").to_csv(
        path_csv, index=False
    )
    records = json.loads(
        df.drop(columns=[c for c in df.columns if c == "raw"], errors="ignore").to_json(
            orient="records", force_ascii=False
        )
    )
    path_json.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved {len(df)} rows -> {path_csv}")
    if len(df):
        print(df.head(3))
        print(df.tail(3))


if __name__ == "__main__":
    main()
