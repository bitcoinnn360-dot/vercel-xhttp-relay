#!/usr/bin/env python3
"""Fetch BTCUSDT 5m (~1y) and iterate ICT mitigation configs.

TP priority (ICT): opposing BSL/SSL -> untouched FVG -> RR fallback.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backtest.fetch_binance import fetch_klines
from backtest.ict_mitigation import Params, Trade, run_backtest

DATA = Path(__file__).resolve().parent / "data" / "BTCUSDT_5m_365d.csv"
OUT = Path(__file__).resolve().parent / "results"
OUT.mkdir(parents=True, exist_ok=True)


def get_df() -> pd.DataFrame:
    if DATA.exists():
        print(f"Loading cache {DATA}")
        df = pd.read_csv(DATA, parse_dates=["open_time"], index_col="open_time")
        return df
    print("Downloading BTCUSDT 5m (~1 year) from Binance...")
    end = pd.Timestamp.utcnow()
    start = end - pd.Timedelta(days=365)
    df = fetch_klines(
        "BTCUSDT",
        "5m",
        int(start.timestamp() * 1000),
        int(end.timestamp() * 1000),
    )
    DATA.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(DATA)
    print(f"Saved {len(df)} bars -> {DATA}")
    return df


def trades_to_df(trades: list[Trade], index: pd.DatetimeIndex) -> pd.DataFrame:
    rows = []
    for t in trades:
        rows.append(
            {
                "side": t.side,
                "entry_time": index[t.entry_bar],
                "exit_time": index[t.exit_bar] if t.exit_bar is not None else None,
                "entry": t.entry,
                "sl": t.sl,
                "tp": t.tp,
                "exit": t.exit,
                "reason": t.reason,
                "tp_source": t.tp_source,
            }
        )
    return pd.DataFrame(rows)


def score(s: dict) -> float:
    if s.get("trades", 0) < 20:
        return -1e18
    val = s["profit_factor"] * 10 + s["net_R"] + s["winrate"] * 0.05
    if s.get("max_dd_R", 0) > 40:
        val -= 20
    return val


def variants() -> list[tuple[str, Params]]:
    base = Params(
        pivot_len=2,
        max_failed_swing_gap=20,
        ob_engulf_lookback=30,
        require_fractal_leave=True,
        require_rejection=True,
        rej_wick_pct=50.0,
        require_mss=True,
        prefer_liq_tp=True,
        prefer_fvg_tp=True,
        rr_fallback=2.0,
        max_hold_bars=288,  # 24h on 5m
        fee_bps=4.0,
        cooldown_bars=10,
    )
    out: list[tuple[str, Params]] = []
    out.append(("A_full_ict", base))
    out.append(("B_reject_only", replace(base, require_fractal_leave=False)))
    out.append(("C_fractal_only", replace(base, require_rejection=False)))
    out.append(
        (
            "D_immediate_pb",
            replace(base, require_rejection=False, require_fractal_leave=False),
        )
    )
    out.append(("E_wick60", replace(base, rej_wick_pct=60.0)))
    out.append(
        ("F_reject_rr15", replace(base, require_fractal_leave=False, rr_fallback=1.5))
    )
    # Liquidity/FVG only — if no target, still need RR to have a TP; keep RR as last resort
    # but prefer shorter RR when forced
    out.append(
        ("G_reject_rr10", replace(base, require_fractal_leave=False, rr_fallback=1.0))
    )
    out.append(
        (
            "H_reject_tight_sl",
            replace(base, require_fractal_leave=False, sl_buffer_pct=0.0002),
        )
    )
    out.append(
        (
            "I_reject_cluster30",
            replace(base, require_fractal_leave=False, max_failed_swing_gap=30),
        )
    )
    out.append(
        ("J_reject_hold8h", replace(base, require_fractal_leave=False, max_hold_bars=96))
    )
    out.append(
        (
            "K_reject_wick55_hold12h",
            replace(
                base,
                require_fractal_leave=False,
                rej_wick_pct=55.0,
                max_hold_bars=144,
            ),
        )
    )
    out.append(
        ("L_reject_rr3", replace(base, require_fractal_leave=False, rr_fallback=3.0))
    )
    out.append(
        (
            "M_reject_no_mss",
            replace(base, require_fractal_leave=False, require_mss=False),
        )
    )
    out.append(
        (
            "N_reject_liq_fvg_only_pref",
            replace(
                base,
                require_fractal_leave=False,
                prefer_liq_tp=True,
                prefer_fvg_tp=True,
                rr_fallback=2.0,
            ),
        )
    )
    # pivot 5 like classic
    out.append(
        (
            "O_reject_pivot5",
            replace(base, require_fractal_leave=False, pivot_len=5, max_failed_swing_gap=40),
        )
    )
    return out


def main() -> None:
    df = get_df()
    print(f"Bars: {len(df)} | {df.index[0]} -> {df.index[-1]}")

    rows = []
    best_name = None
    best_params = None
    best_metrics = None
    best_trades = None
    best_sc = -1e18

    for name, params in variants():
        print(f"\n=== {name} ===")
        trades, s = run_backtest(df, params)
        s["name"] = name
        rows.append(s)
        print(
            f"trades={s['trades']} winrate={s.get('winrate', 0)}% PF={s.get('profit_factor', 0)} "
            f"netR={s.get('net_R', 0)} avgR={s.get('avg_R', 0)} maxDD={s.get('max_dd_R', 0)} "
            f"TP[bsl/ssl/fvg/rr]={s.get('tp_bsl', 0)}/{s.get('tp_ssl', 0)}/{s.get('tp_fvg', 0)}/{s.get('tp_rr', 0)}"
        )
        sc = score(s)
        if sc > best_sc:
            best_sc = sc
            best_name, best_params, best_metrics, best_trades = name, params, s, trades
        if trades:
            trades_to_df(trades, df.index).to_csv(OUT / f"trades_{name}.csv", index=False)

    summary = pd.DataFrame(rows).sort_values(["profit_factor", "net_R"], ascending=False)
    summary.to_csv(OUT / "summary.csv", index=False)
    print("\n===== RANKED =====")
    print(summary.to_string(index=False))

    if best_params is None:
        print("No viable config")
        return

    print(f"\nBEST: {best_name}")
    print(json.dumps(best_metrics, indent=2))
    (OUT / "best.json").write_text(
        json.dumps(
            {"name": best_name, "metrics": best_metrics, "params": asdict(best_params)},
            indent=2,
        )
    )

    print("\n===== REFINE around best =====")
    refine_rows = []
    tweaks = [
        ("wick45", {"rej_wick_pct": 45.0}),
        ("wick50", {"rej_wick_pct": 50.0}),
        ("wick55", {"rej_wick_pct": 55.0}),
        ("wick60", {"rej_wick_pct": 60.0}),
        ("rr15", {"rr_fallback": 1.5}),
        ("rr20", {"rr_fallback": 2.0}),
        ("rr25", {"rr_fallback": 2.5}),
        ("hold6h", {"max_hold_bars": 72}),
        ("hold12h", {"max_hold_bars": 144}),
        ("hold24h", {"max_hold_bars": 288}),
        ("gap15", {"max_failed_swing_gap": 15}),
        ("gap20", {"max_failed_swing_gap": 20}),
        ("gap30", {"max_failed_swing_gap": 30}),
        ("cd5", {"cooldown_bars": 5}),
        ("cd15", {"cooldown_bars": 15}),
        ("nomss", {"require_mss": False}),
        ("sl02", {"sl_buffer_pct": 0.0002}),
        ("sl10", {"sl_buffer_pct": 0.001}),
    ]
    for tname, tw in tweaks:
        p2 = replace(best_params, **tw)
        full = f"{best_name}+{tname}"
        trades2, s2 = run_backtest(df, p2)
        s2["name"] = full
        refine_rows.append(s2)
        print(
            f"{full}: n={s2['trades']} WR={s2.get('winrate')} PF={s2.get('profit_factor')} "
            f"netR={s2.get('net_R')} DD={s2.get('max_dd_R')}"
        )
        if trades2:
            trades_to_df(trades2, df.index).to_csv(OUT / f"trades_{full}.csv", index=False)

    ref = pd.DataFrame(refine_rows).sort_values(["profit_factor", "net_R"], ascending=False)
    ref.to_csv(OUT / "refine.csv", index=False)
    print("\n===== REFINE RANKED (top 10) =====")
    print(ref.head(10).to_string(index=False))

    # pick refined best by score
    refined_best = None
    refined_sc = -1e18
    for _, row in ref.iterrows():
        d = row.to_dict()
        sc = score(d)
        if sc > refined_sc:
            refined_sc = sc
            refined_best = d
    if refined_best:
        (OUT / "best_refined.json").write_text(
            json.dumps(refined_best, indent=2, default=str)
        )
        print("\nBEST REFINED:")
        print(json.dumps(refined_best, indent=2, default=str))


if __name__ == "__main__":
    main()
