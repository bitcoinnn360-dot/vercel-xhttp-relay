#!/usr/bin/env python3
"""Download Binance USDT-M/spot klines into a local parquet/csv cache."""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import pandas as pd
import requests

BASE = "https://api.binance.com/api/v3/klines"


def fetch_klines(symbol: str, interval: str, start_ms: int, end_ms: int) -> pd.DataFrame:
    rows: list[list] = []
    cursor = start_ms
    while cursor < end_ms:
        params = {
            "symbol": symbol,
            "interval": interval,
            "startTime": cursor,
            "endTime": end_ms,
            "limit": 1000,
        }
        for attempt in range(5):
            r = requests.get(BASE, params=params, timeout=30)
            if r.status_code == 200:
                break
            time.sleep(0.5 * (attempt + 1))
        else:
            r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        rows.extend(batch)
        cursor = batch[-1][0] + 1
        time.sleep(0.05)
        if len(batch) < 1000:
            break

    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    df = pd.DataFrame(
        rows,
        columns=[
            "open_time",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "close_time",
            "quote_volume",
            "trades",
            "taker_buy_base",
            "taker_buy_quote",
            "ignore",
        ],
    )
    df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = df[c].astype(float)
    df = df.drop_duplicates("open_time").sort_values("open_time").reset_index(drop=True)
    df = df.set_index("open_time")[["open", "high", "low", "close", "volume"]]
    return df


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="BTCUSDT")
    ap.add_argument("--interval", default="5m")
    ap.add_argument("--days", type=int, default=365)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    end = pd.Timestamp.utcnow()
    start = end - pd.Timedelta(days=args.days)
    out = Path(args.out or f"backtest/data/{args.symbol}_{args.interval}_{args.days}d.csv")
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"Fetching {args.symbol} {args.interval} from {start} to {end} ...")
    df = fetch_klines(args.symbol, args.interval, int(start.timestamp() * 1000), int(end.timestamp() * 1000))
    df.to_csv(out)
    print(f"Saved {len(df)} bars -> {out}")


if __name__ == "__main__":
    main()
