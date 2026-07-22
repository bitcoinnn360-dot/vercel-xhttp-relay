"""Re-download tiny/empty monthly HTML files using letter indexes."""

from __future__ import annotations

import json
import time
from pathlib import Path

from codal_client import CodalClient
from scrape_monthly import SYMBOLS, load_proxies

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
MIN_SIZE = 5000


def main() -> None:
    client = CodalClient(load_proxies())
    targets = []
    for info in SYMBOLS:
        symbol = info["symbol"]
        sym_dir = RAW / symbol
        selected = json.loads((sym_dir / "monthly_letters_selected.json").read_text(encoding="utf-8"))
        by_period = {L["_period_end"]: L for L in selected}
        for path in sorted(sym_dir.glob("monthly_*.html")):
            if path.stat().st_size >= MIN_SIZE:
                continue
            period = path.stem.replace("monthly_", "").replace("-", "/")
            letter = by_period.get(period)
            if not letter:
                print(f"no letter for {symbol} {period}")
                continue
            targets.append((symbol, period, letter, path))

    print(f"redownload targets: {len(targets)}")
    for i, (symbol, period, letter, path) in enumerate(targets, 1):
        try:
            content = client.download_excel(letter)
            path.write_bytes(content)
            print(f"[{i}/{len(targets)}] {symbol} {period} -> {len(content)} bytes", flush=True)
            time.sleep(0.3)
        except Exception as exc:  # noqa: BLE001
            print(f"[{i}/{len(targets)}] {symbol} {period} FAIL {exc}", flush=True)
    print("client stats", client.stats)


if __name__ == "__main__":
    main()
