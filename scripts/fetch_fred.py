#!/usr/bin/env python3
"""Fetch FRED CSV series into public/data/fred for static dashboard use."""
from __future__ import annotations

import csv
import io
import json
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "data" / "fred"
SERIES = [
    "DCOILBRENTEU",
    "PIORECRUSDM",
    "PCOPPUSDM",
    "DTWEXBGS",
    "DGS10",
]
UA = "MIDCO-MarketDashboard/1.0"


def fetch_series(series_id: str, limit: int = 180) -> dict:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read().decode("utf-8", errors="replace")
    rows = list(csv.DictReader(io.StringIO(text)))
    points = []
    for row in rows:
        date = row.get("observation_date") or row.get("DATE") or ""
        raw = row.get(series_id) or row.get("value") or list(row.values())[-1]
        if raw in (".", "", None):
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        points.append({"date": date, "value": value})
    sliced = points[-limit:]
    last = sliced[-1] if sliced else None
    prev = sliced[-2] if len(sliced) > 1 else None
    change = (last["value"] - prev["value"]) if last and prev else 0.0
    change_pct = (change / prev["value"] * 100) if last and prev and prev["value"] else 0.0
    return {
        "ok": True,
        "id": series_id,
        "last": last["value"] if last else None,
        "change": change,
        "changePct": change_pct,
        "history": sliced,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for sid in SERIES:
        try:
            payload = fetch_series(sid)
            path = OUT / f"{sid}.json"
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            print(f"ok {sid} last={payload['last']}")
        except Exception as exc:  # noqa: BLE001
            print(f"fail {sid}: {exc}")


if __name__ == "__main__":
    main()
