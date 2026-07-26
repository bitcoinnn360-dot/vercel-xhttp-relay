#!/usr/bin/env python3
"""Sweep tight-SL + combo filters from sibling ICT strategies on BTCUSDT 5m."""

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
        return pd.read_csv(DATA, parse_dates=["open_time"], index_col="open_time")
    print("Downloading BTCUSDT 5m (~1y)...", flush=True)
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
    return df


def trades_to_df(trades: list[Trade], index: pd.DatetimeIndex) -> pd.DataFrame:
    rows = []
    for t in trades:
        risk = abs(t.entry - t.sl)
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
                "sl_source": t.sl_source,
                "risk_pct": (risk / t.entry * 100) if t.entry else None,
                "planned_rr": (abs(t.tp - t.entry) / risk) if risk else None,
            }
        )
    return pd.DataFrame(rows)


def score(s: dict) -> float:
    if s.get("trades", 0) < 15:
        return -1e18
    val = s["profit_factor"] * 25 + s["net_R"] + s["winrate"] * 0.15
    if s.get("max_dd_R", 0) > 20:
        val -= (s["max_dd_R"] - 20) * 0.8
    return val


def variants() -> list[tuple[str, Params]]:
    # Previous champion-ish base, but with tight SL
    base = Params(
        pivot_len=5,
        max_failed_swing_gap=40,
        ob_engulf_lookback=30,
        require_fractal_leave=False,
        require_rejection=True,
        rej_wick_pct=70.0,
        require_mss=True,
        sl_mode="tight_best",
        sl_buffer_pct=0.0002,
        min_risk_pct=0.0003,
        max_risk_pct=0.012,
        min_tp_rr=3.0,
        rr_fallback=3.0,
        prefer_liq_tp=True,
        prefer_fvg_tp=True,
        max_hold_bars=96,
        fee_bps=4.0,
        use_ema_filter=True,
        ema_len=200,
        require_ny_session=True,
    )
    out: list[tuple[str, Params]] = []

    # SL modes
    out.append(("SL_tight_best", base))
    out.append(("SL_nearest_swing", replace(base, sl_mode="nearest_swing")))
    out.append(("SL_reject", replace(base, sl_mode="reject")))
    out.append(("SL_ob", replace(base, sl_mode="ob")))
    out.append(("SL_failed_liq", replace(base, sl_mode="failed_liq")))

    # Combos on tight_best
    out.append(("C_ny_orb", replace(base, require_ny_orb_bias=True)))
    out.append(("C_eqh_eql", replace(base, require_eq_liquidity=True)))
    out.append(("C_pdh_pdl", replace(base, require_pd_affinity=True)))
    out.append(("C_killzone", replace(base, require_killzone=True, require_ny_session=False)))
    out.append(
        (
            "C_orb_eq",
            replace(base, require_ny_orb_bias=True, require_eq_liquidity=True),
        )
    )
    out.append(
        (
            "C_orb_kz",
            replace(
                base,
                require_ny_orb_bias=True,
                require_killzone=True,
                require_ny_session=False,
            ),
        )
    )
    out.append(
        (
            "C_full_stack",
            replace(
                base,
                require_ny_orb_bias=True,
                require_eq_liquidity=True,
                require_killzone=True,
                require_ny_session=False,
            ),
        )
    )
    out.append(
        (
            "C_orb_pd_ema",
            replace(base, require_ny_orb_bias=True, require_pd_affinity=True),
        )
    )
    out.append(
        (
            "C_swing_orb_kz",
            replace(
                base,
                sl_mode="nearest_swing",
                require_ny_orb_bias=True,
                require_killzone=True,
                require_ny_session=False,
            ),
        )
    )
    out.append(
        (
            "C_reject_orb",
            replace(base, sl_mode="reject", require_ny_orb_bias=True),
        )
    )
    # looser wick / RR for more samples under combo
    out.append(
        (
            "C_orb_wick60_rr25",
            replace(
                base,
                require_ny_orb_bias=True,
                rej_wick_pct=60.0,
                min_tp_rr=2.5,
                rr_fallback=2.5,
            ),
        )
    )
    out.append(
        (
            "C_kz_wick60",
            replace(
                base,
                require_killzone=True,
                require_ny_session=False,
                rej_wick_pct=60.0,
            ),
        )
    )
    out.append(
        (
            "C_orb_no_ema",
            replace(base, require_ny_orb_bias=True, use_ema_filter=False),
        )
    )
    out.append(
        (
            "C_orb_eq_wick60",
            replace(
                base,
                require_ny_orb_bias=True,
                require_eq_liquidity=True,
                rej_wick_pct=60.0,
                min_tp_rr=2.5,
                rr_fallback=2.5,
            ),
        )
    )
    return out


def main() -> None:
    df = get_df()
    print(f"Bars: {len(df)} | {df.index[0]} -> {df.index[-1]}", flush=True)

    rows = []
    best = None
    best_sc = -1e18

    for name, params in variants():
        print(f"\n=== {name} ===", flush=True)
        trades, s = run_backtest(df, params)
        s["name"] = name
        rows.append(s)
        print(
            f"n={s['trades']} WR={s.get('winrate')} PF={s.get('profit_factor')} "
            f"netR={s.get('net_R')} DD={s.get('max_dd_R')} risk%={s.get('avg_risk_pct')} "
            f"SL={s.get('sl_sources')} TP[bsl/ssl/fvg/rr]="
            f"{s.get('tp_bsl')}/{s.get('tp_ssl')}/{s.get('tp_fvg')}/{s.get('tp_rr')}",
            flush=True,
        )
        sc = score(s)
        if sc > best_sc:
            best_sc = sc
            best = (name, params, s, trades)
        if trades:
            trades_to_df(trades, df.index).to_csv(OUT / f"trades_{name}.csv", index=False)

    summary = pd.DataFrame(rows).sort_values(["profit_factor", "net_R"], ascending=False)
    # sl_sources dict breaks csv nicely — stringify
    if "sl_sources" in summary.columns:
        summary["sl_sources"] = summary["sl_sources"].apply(lambda x: json.dumps(x) if isinstance(x, dict) else x)
    summary.to_csv(OUT / "combo_summary.csv", index=False)
    print("\n===== RANKED =====", flush=True)
    cols = [c for c in summary.columns if c != "sl_sources"]
    print(summary[cols].to_string(index=False), flush=True)

    if not best:
        return
    name, params, s, trades = best
    print(f"\nBEST: {name}", flush=True)
    print(json.dumps(s, indent=2, default=str), flush=True)

    # refine around best
    print("\n===== REFINE =====", flush=True)
    refine_rows = []
    tweaks = [
        ("minRR20", {"min_tp_rr": 2.0, "rr_fallback": 2.0}),
        ("minRR25", {"min_tp_rr": 2.5, "rr_fallback": 2.5}),
        ("minRR30", {"min_tp_rr": 3.0, "rr_fallback": 3.0}),
        ("wick60", {"rej_wick_pct": 60.0}),
        ("wick70", {"rej_wick_pct": 70.0}),
        ("hold6h", {"max_hold_bars": 72}),
        ("hold8h", {"max_hold_bars": 96}),
        ("hold12h", {"max_hold_bars": 144}),
        ("sl_swing", {"sl_mode": "nearest_swing"}),
        ("sl_reject", {"sl_mode": "reject"}),
        ("sl_tight", {"sl_mode": "tight_best"}),
        ("buf01", {"sl_buffer_pct": 0.0001}),
        ("buf02", {"sl_buffer_pct": 0.0002}),
        ("buf05", {"sl_buffer_pct": 0.0005}),
        ("ema_on", {"use_ema_filter": True}),
        ("ema_off", {"use_ema_filter": False}),
        ("orb_on", {"require_ny_orb_bias": True}),
        ("orb_off", {"require_ny_orb_bias": False}),
        ("eq_on", {"require_eq_liquidity": True}),
        ("eq_off", {"require_eq_liquidity": False}),
        ("kz_on", {"require_killzone": True, "require_ny_session": False}),
        ("ny_sess", {"require_ny_session": True, "require_killzone": False}),
    ]
    for tname, tw in tweaks:
        p2 = replace(params, **tw)
        full = f"{name}+{tname}"
        trades2, s2 = run_backtest(df, p2)
        s2["name"] = full
        refine_rows.append(s2)
        print(
            f"{full}: n={s2['trades']} WR={s2.get('winrate')} PF={s2.get('profit_factor')} "
            f"netR={s2.get('net_R')} DD={s2.get('max_dd_R')} risk%={s2.get('avg_risk_pct')}",
            flush=True,
        )
        if trades2:
            trades_to_df(trades2, df.index).to_csv(OUT / f"trades_{full}.csv", index=False)

    ref = pd.DataFrame(refine_rows).sort_values(["profit_factor", "net_R"], ascending=False)
    if "sl_sources" in ref.columns:
        ref["sl_sources"] = ref["sl_sources"].apply(lambda x: json.dumps(x) if isinstance(x, dict) else x)
    ref.to_csv(OUT / "combo_refine.csv", index=False)
    print("\n===== REFINE TOP 10 =====", flush=True)
    print(ref.head(10)[[c for c in ref.columns if c != "sl_sources"]].to_string(index=False), flush=True)

    refined_best = None
    refined_sc = -1e18
    for _, row in ref.iterrows():
        d = row.to_dict()
        sc = score(d)
        if sc > refined_sc:
            refined_sc = sc
            refined_best = d

    out = {
        "best_base": {"name": name, "metrics": s, "params": asdict(params)},
        "best_refined": refined_best,
        "notes": {
            "symbol": "BTCUSDT",
            "timeframe": "5m",
            "tp": "BSL/SSL minRR -> FVG -> RR",
            "sl": "tight behind nearest swing/reject/OB (not far failed BSL/SSL)",
            "combos": "NY ORB bias, EQH/EQL, PDH/PDL, killzones from sibling strategies",
        },
    }
    (OUT / "combo_best.json").write_text(json.dumps(out, indent=2, default=str))
    print("\nSaved combo_best.json", flush=True)
    if refined_best:
        print(json.dumps(refined_best, indent=2, default=str), flush=True)


if __name__ == "__main__":
    main()
