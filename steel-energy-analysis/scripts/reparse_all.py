"""Re-parse all downloaded monthly HTML files with the latest parser."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from parse_monthly import extract_period_end, is_revision, parse_monthly_html
from scrape_monthly import SYMBOLS

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"


def reparse() -> None:
    all_energy = []
    all_products = []
    summary = []
    for info in SYMBOLS:
        symbol = info["symbol"]
        sym_dir = RAW / symbol
        letters_path = sym_dir / "monthly_letters_selected.json"
        if not letters_path.exists():
            # fallback: parse whatever html exists
            html_files = sorted(sym_dir.glob("monthly_*.html")) if sym_dir.exists() else []
            letters = []
            for hf in html_files:
                period = hf.stem.replace("monthly_", "").replace("-", "/")
                letters.append({"_period_end": period, "Title": period, "PublishDateTime": None})
        else:
            letters = json.loads(letters_path.read_text(encoding="utf-8"))

        n_e = n_p = n_miss = 0
        for letter in letters:
            period = letter.get("_period_end") or extract_period_end(letter.get("Title") or "")
            if not period:
                continue
            path = sym_dir / f"monthly_{period.replace('/', '-')}.html"
            if not path.exists() or path.stat().st_size < 500:
                n_miss += 1
                continue
            parsed = parse_monthly_html(path.read_bytes(), period_end=period)
            meta = {
                "symbol": symbol,
                "company": info["name"],
                "group": info["group"],
                "period_end": period,
                "title": letter.get("Title"),
                "publish_dt": letter.get("PublishDateTime"),
                "tracing_no": letter.get("TracingNo"),
                "is_revision": letter.get("_is_revision", is_revision(letter.get("Title") or "")),
                "excel_url": letter.get("ExcelUrl"),
            }
            for e in parsed["energy"]:
                all_energy.append({**meta, **e})
            for p in parsed["products"]:
                all_products.append({**meta, **p})
            n_e += len(parsed["energy"])
            n_p += len(parsed["products"])
        summary.append(
            {
                "symbol": symbol,
                "n_letters": len(letters),
                "n_energy_rows": n_e,
                "n_product_rows": n_p,
                "n_missing_files": n_miss,
            }
        )
        print(summary[-1], flush=True)

    PROC.mkdir(parents=True, exist_ok=True)
    (PROC / "energy_monthly.json").write_text(
        json.dumps(all_energy, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (PROC / "products_monthly.json").write_text(
        json.dumps(all_products, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (PROC / "reparse_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"energy rows={len(all_energy)} product rows={len(all_products)}")


if __name__ == "__main__":
    reparse()
