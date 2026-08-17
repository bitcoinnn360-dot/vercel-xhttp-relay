#!/usr/bin/env python3
"""Fetch BTCUSDT 5m (~1y) and iterate ICT mitigation configs.

TP priority (ICT): opposing BSL/SSL with min RR -> untouched FVG -> RR fallback.
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
        print(f"Loading cache {DATA}", flush=True)
        df = pd.read_csv(DATA, parse_dates=["open_time"], index_col="open_time")
        return df
    print("Downloading BTCUSDT 5m (~1 year) from Binance...", flush=True)
    end = pd.Timestamp.now("UTC")
    start = end - pd.Timedelta(days=365)
    df = fetch_klines(
        "BTCUSDT",
        "5m",
        int(start.timestamp() * 1000),
        int(end.timestamp() * 1000),
    )
    DATA.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(DATA)
    print(f"Saved {len(df)} bars -> {DATA}", flush=True)
    return df


def trades_to_df(trades: list[Trade], index: pd.DatetimeIndex) -> pd.DataFrame:
    rows = []
    for t in trades:
        risk = abs(t.entry - t.sl)
        reward = abs(t.tp - t.entry)
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
                "planned_rr": (reward / risk) if risk > 0 else None,
            }
        )
    return pd.DataFrame(rows)


def score(s: dict) -> float:
    if s.get("trades", 0) < 15:
        return -1e18
    val = s["profit_factor"] * 20 + s["net_R"] + s["winrate"] * 0.1
    if s.get("max_dd_R", 0) > 30:
        val -= (s["max_dd_R"] - 30) * 0.5
    return val


def variants() -> list[tuple[str, Params]]:
    # Baseline after diagnosing micro-RR BSL/SSL problem
    base = Params(
        pivot_len=5,
        max_failed_swing_gap=40,
        ob_engulf_lookback=30,
        require_fractal_leave=False,
        require_rejection=True,
        rej_wick_pct=60.0,
        require_mss=True,
        prefer_liq_tp=True,
        prefer_fvg_tp=True,
        min_tp_rr=1.5,
        rr_fallback=2.0,
        max_hold_bars=288,
        fee_bps=4.0,
        cooldown_bars=10,
    )
    out: list[tuple[str, Params]] = []
    out.append(("A_minRR15_wick60", base))
    out.append(("B_minRR20", replace(base, min_tp_rr=2.0, rr_fallback=2.0)))
    out.append(("C_minRR25", replace(base, min_tp_rr=2.5, rr_fallback=2.5)))
    out.append(("D_minRR15_full", replace(base, require_fractal_leave=True)))
    out.append(("E_minRR20_full", replace(base, min_tp_rr=2.0, require_fractal_leave=True)))
    out.append(("F_minRR20_wick50", replace(base, min_tp_rr=2.0, rej_wick_pct=50.0)))
    out.append(
        (
            "G_minRR20_ema",
            replace(base, min_tp_rr=2.0, use_ema_filter=True, ema_len=200),
        )
    )
    out.append(
        (
            "H_minRR20_session_LN",
            replace(base, min_tp_rr=2.0, session_start_hour=7, session_end_hour=16),
        )
    )
    out.append(
        (
            "I_minRR20_ema_sess",
            replace(
                base,
                min_tp_rr=2.0,
                use_ema_filter=True,
                ema_len=200,
                session_start_hour=7,
                session_end_hour=16,
            ),
        )
    )
    out.append(
        (
            "J_minRR20_fvg_first",
            replace(base, min_tp_rr=2.0, prefer_liq_tp=False, prefer_fvg_tp=True),
        )
    )
    out.append(
        (
            "K_minRR20_liq_only",
            replace(base, min_tp_rr=2.0, prefer_liq_tp=True, prefer_fvg_tp=False),
        )
    )
    out.append(
        (
            "L_minRR20_hold12h",
            replace(base, min_tp_rr=2.0, max_hold_bars=144),
        )
    )
    out.append(
        (
            "M_minRR20_pivot2",
            replace(base, min_tp_rr=2.0, pivot_len=2, max_failed_swing_gap=20),
        )
    )
    out.append(
        (
            "N_minRR20_no_rej",
            replace(base, min_tp_rr=2.0, require_rejection=False),
        )
    )
    out.append(
        (
            "O_minRR30_ema_sess",
            replace(
                base,
                min_tp_rr=3.0,
                rr_fallback=3.0,
                use_ema_filter=True,
                session_start_hour=7,
                session_end_hour=16,
            ),
        )
    )
    out.append(
        (
            "P_minRR20_wick70_full",
            replace(
                base,
                min_tp_rr=2.0,
                rej_wick_pct=70.0,
                require_fractal_leave=True,
            ),
        )
    )
    return out


def main() -> None:
    df = get_df()
    print(f"Bars: {len(df)} | {df.index[0]} -> {df.index[-1]}", flush=True)

    rows = []
    best_name = None
    best_params = None
    best_metrics = None
    best_sc = -1e18

    for name, params in variants():
        print(f"\n=== {name} ===", flush=True)
        trades, s = run_backtest(df, params)
        s["name"] = name
        rows.append(s)
        print(
            f"trades={s['trades']} winrate={s.get('winrate', 0)}% PF={s.get('profit_factor', 0)} "
            f"netR={s.get('net_R', 0)} avgR={s.get('avg_R', 0)} maxDD={s.get('max_dd_R', 0)} "
            f"TP[bsl/ssl/fvg/rr]={s.get('tp_bsl', 0)}/{s.get('tp_ssl', 0)}/{s.get('tp_fvg', 0)}/{s.get('tp_rr', 0)}",
            flush=True,
        )
        sc = score(s)
        if sc > best_sc:
            best_sc = sc
            best_name, best_params, best_metrics = name, params, s
        if trades:
            trades_to_df(trades, df.index).to_csv(OUT / f"trades_{name}.csv", index=False)

    summary = pd.DataFrame(rows).sort_values(["profit_factor", "net_R"], ascending=False)
    summary.to_csv(OUT / "summary.csv", index=False)
    print("\n===== RANKED =====", flush=True)
    print(summary.to_string(index=False), flush=True)

    if best_params is None:
        print("No viable config", flush=True)
        return

    print(f"\nBEST: {best_name}", flush=True)
    print(json.dumps(best_metrics, indent=2), flush=True)
    (OUT / "best.json").write_text(
        json.dumps(
            {"name": best_name, "metrics": best_metrics, "params": asdict(best_params)},
            indent=2,
        )
    )

    print("\n===== REFINE around best =====", flush=True)
    refine_rows = []
    tweaks = [
        ("minRR15", {"min_tp_rr": 1.5}),
        ("minRR20", {"min_tp_rr": 2.0}),
        ("minRR25", {"min_tp_rr": 2.5}),
        ("minRR30", {"min_tp_rr": 3.0, "rr_fallback": 3.0}),
        ("wick50", {"rej_wick_pct": 50.0}),
        ("wick60", {"rej_wick_pct": 60.0}),
        ("wick70", {"rej_wick_pct": 70.0}),
        ("hold8h", {"max_hold_bars": 96}),
        ("hold12h", {"max_hold_bars": 144}),
        ("hold24h", {"max_hold_bars": 288}),
        ("hold48h", {"max_hold_bars": 576}),
        ("ema_on", {"use_ema_filter": True, "ema_len": 200}),
        ("ema_off", {"use_ema_filter": False}),
        ("sess_ln", {"session_start_hour": 7, "session_end_hour": 16}),
        ("sess_ny", {"session_start_hour": 13, "session_end_hour": 20}),
        ("sess_off", {"session_start_hour": -1, "session_end_hour": -1}),
        ("fractal_on", {"require_fractal_leave": True}),
        ("fractal_off", {"require_fractal_leave": False}),
        ("gap30", {"max_failed_swing_gap": 30}),
        ("gap50", {"max_failed_swing_gap": 50}),
    ]
    for tname, tw in tweaks:
        p2 = replace(best_params, **tw)
        full = f"{best_name}+{tname}"
        trades2, s2 = run_backtest(df, p2)
        s2["name"] = full
        refine_rows.append(s2)
        print(
            f"{full}: n={s2['trades']} WR={s2.get('winrate')} PF={s2.get('profit_factor')} "
            f"netR={s2.get('net_R')} DD={s2.get('max_dd_R')}",
            flush=True,
        )
        if trades2:
            trades_to_df(trades2, df.index).to_csv(OUT / f"trades_{full}.csv", index=False)

    ref = pd.DataFrame(refine_rows).sort_values(["profit_factor", "net_R"], ascending=False)
    ref.to_csv(OUT / "refine.csv", index=False)
    print("\n===== REFINE RANKED (top 10) =====", flush=True)
    print(ref.head(10).to_string(index=False), flush=True)

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
        print("\nBEST REFINED:", flush=True)
        print(json.dumps(refined_best, indent=2, default=str), flush=True)


if __name__ == "__main__":
    main()
