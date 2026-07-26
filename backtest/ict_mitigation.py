#!/usr/bin/env python3
"""
ICT Failed-Swing Mitigation backtester (Python port of the Pine logic).

Entry (long example):
  - prior LL then failed higher low (SSL of prior low untouched)
  - bearish OB of that move breaks -> breaker
  - optional: micro HH + leave SSL above failed low
  - optional: rejection wick >= X% + confirm close
  - SL below failed SSL
  - TP: nearest opposing BSL, else untouched bullish FVG, else RR fallback
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd


@dataclass
class Params:
    pivot_len: int = 5
    max_failed_swing_gap: int = 40
    ob_engulf_lookback: int = 20
    require_fractal_leave: bool = True
    require_rejection: bool = True
    rej_wick_pct: float = 50.0
    rej_close_in_half: bool = True
    require_mss: bool = True
    sl_buffer_pct: float = 0.0005  # 0.05% beyond liquidity
    rr_fallback: float = 2.0
    # Skip BSL/SSL/FVG targets closer than this RR; search farther levels.
    min_tp_rr: float = 1.5
    prefer_liq_tp: bool = True
    prefer_fvg_tp: bool = True
    min_fvg_pct: float = 0.0003
    cooldown_bars: int = 10
    one_trade_at_a_time: bool = True
    fee_bps: float = 4.0  # 0.04% per side approx
    max_hold_bars: int = 500
    # Optional filters
    use_ema_filter: bool = False
    ema_len: int = 200
    # UTC hour window inclusive start, exclusive end (e.g. London+NY 7-16)
    session_start_hour: int = -1  # -1 = off
    session_end_hour: int = -1


@dataclass
class Swing:
    price: float
    bar: int


@dataclass
class OB:
    top: float
    bottom: float
    start: int
    is_bull: bool
    is_breaker: bool = False
    active: bool = True


@dataclass
class Liq:
    price: float
    start: int
    is_high: bool
    swept: bool = False


@dataclass
class FVG:
    top: float
    bottom: float
    start: int
    is_bull: bool
    touched: bool = False


@dataclass
class Trade:
    side: str
    entry_bar: int
    entry: float
    sl: float
    tp: float
    exit_bar: Optional[int] = None
    exit: Optional[float] = None
    reason: str = ""
    tag: str = "MIT"
    tp_source: str = "rr"  # bsl | ssl | fvg | rr


def pivots(high: np.ndarray, low: np.ndarray, left: int) -> tuple[list[Optional[float]], list[Optional[float]]]:
    n = len(high)
    ph = [None] * n
    pl = [None] * n
    for i in range(left, n - left):
        window_h = high[i - left : i + left + 1]
        window_l = low[i - left : i + left + 1]
        if high[i] >= window_h.max() and high[i] > high[i - left : i].max() and high[i] >= high[i + 1 : i + left + 1].max():
            ph[i] = float(high[i])
        if low[i] <= window_l.min() and low[i] < low[i - left : i].min() and low[i] <= low[i + 1 : i + left + 1].min():
            pl[i] = float(low[i])
    return ph, pl


def find_ob_candle(o, h, l, c, i: int, want_bearish_candle: bool, search_depth: int, engulf: int):
    ob_idx = None
    ob_h = ob_l = None
    depth = max(1, min(search_depth, i))
    for j in range(1, depth + 1):
        k = i - j
        match = (c[k] < o[k]) if want_bearish_candle else (c[k] > o[k])
        if match:
            ob_idx, ob_h, ob_l = k, float(h[k]), float(l[k])
            break
    if ob_idx is None:
        return None
    inner = i - ob_idx
    for j in range(inner + 1, min(depth, inner + engulf) + 1):
        k = i - j
        match = (c[k] < o[k]) if want_bearish_candle else (c[k] > o[k])
        if match and h[k] >= ob_h and l[k] <= ob_l:
            ob_idx, ob_h, ob_l = k, float(h[k]), float(l[k])
    return ob_idx, ob_h, ob_l


def is_bull_rej(o, h, l, c, wick_need: float, half: bool) -> bool:
    rng = h - l
    if rng <= 0:
        return False
    lower = min(o, c) - l
    ok = lower >= rng * wick_need
    if half:
        ok = ok and c >= l + rng * 0.5
    return ok


def is_bear_rej(o, h, l, c, wick_need: float, half: bool) -> bool:
    rng = h - l
    if rng <= 0:
        return False
    upper = h - max(o, c)
    ok = upper >= rng * wick_need
    if half:
        ok = ok and c <= h - rng * 0.5
    return ok


def run_backtest(df: pd.DataFrame, p: Params) -> tuple[list[Trade], dict]:
    o = df["open"].to_numpy()
    h = df["high"].to_numpy()
    l = df["low"].to_numpy()
    c = df["close"].to_numpy()
    n = len(df)

    ph_arr, pl_arr = pivots(h, l, p.pivot_len)
    wick_need = p.rej_wick_pct / 100.0

    swings_h: list[Swing] = []
    swings_l: list[Swing] = []
    obs: list[OB] = []
    liqs: list[Liq] = []
    fvgs: list[FVG] = []

    last_ph = last_pl = None
    last_ph_idx = last_pl_idx = None

    trades: list[Trade] = []
    open_trade: Optional[Trade] = None
    last_signal_bar = -10**9

    # pending mitigation
    pend_long = pend_short = False
    arm_bar = -1
    sl = ob_top = ob_bot = fail_px = arm_hi = arm_lo = np.nan
    fractal_ready = left_liq = False
    rej_long = rej_short = False
    rej_hi = rej_lo = np.nan
    rej_bar = -1

    def level_untouched_high(px: float, from_bar: int, i: int) -> bool:
        if from_bar >= i:
            return True
        return float(h[from_bar : i + 1].max()) <= px

    def level_untouched_low(px: float, from_bar: int, i: int) -> bool:
        if from_bar >= i:
            return True
        return float(l[from_bar : i + 1].min()) >= px

    def failed_hh():
        if len(swings_h) < 3:
            return False, None, None, None, None
        sh2, sh1, sh0 = swings_h[-1], swings_h[-2], swings_h[-3]
        gap = sh2.bar - sh1.bar
        if (
            sh1.price > sh0.price
            and 0 < gap <= p.max_failed_swing_gap
            and sh2.price < sh1.price
            and level_untouched_high(sh1.price, sh1.bar, len(c) - 1 if False else sh2.bar)  # checked live below
        ):
            return True, sh1.price, sh1.bar, sh2.price, sh2.bar
        return False, None, None, None, None

    def liq_targets(want_high: bool, below: bool, ref: float) -> list[float]:
        out = []
        for lv in liqs:
            if lv.is_high != want_high or lv.swept:
                continue
            if below and lv.price < ref:
                out.append(lv.price)
            if not below and lv.price > ref:
                out.append(lv.price)
        # nearest first
        out.sort(reverse=below)
        return out

    def fvg_targets(want_bull: bool, below: bool, ref: float) -> list[float]:
        out = []
        for f in fvgs:
            if f.is_bull != want_bull or f.touched:
                continue
            # For long: target into bullish FVG mid/top above; for short: bearish FVG mid/bottom below
            edge = (f.top + f.bottom) / 2.0
            if below and edge < ref:
                out.append(edge)
            if not below and edge > ref:
                out.append(edge)
        out.sort(reverse=below)
        return out

    def pick_tp(is_long: bool, entry: float, stop: float) -> tuple[float, str]:
        # Buy-side = BSL above; sell-side = SSL below.
        # Require min_tp_rr so we don't take micro RR into the nearest wick.
        # Else untouched opposing FVG; else RR fallback.
        risk = abs(entry - stop)
        if risk <= 0:
            return entry, "rr"
        min_dist = risk * p.min_tp_rr

        def ok(px: float) -> bool:
            return (px - entry) >= min_dist if is_long else (entry - px) >= min_dist

        tp = None
        src = "rr"
        if p.prefer_liq_tp:
            cands = liq_targets(True, False, entry) if is_long else liq_targets(False, True, entry)
            for px in cands:
                if ok(px):
                    tp = px
                    src = "bsl" if is_long else "ssl"
                    break
        if tp is None and p.prefer_fvg_tp:
            cands = fvg_targets(True, False, entry) if is_long else fvg_targets(False, True, entry)
            for px in cands:
                if ok(px):
                    tp = px
                    src = "fvg"
                    break
        if tp is None:
            rr = max(p.rr_fallback, p.min_tp_rr)
            tp = entry + risk * rr if is_long else entry - risk * rr
            src = "rr"
        return float(tp), src

    def reset_pend():
        nonlocal pend_long, pend_short, fractal_ready, left_liq, rej_long, rej_short
        nonlocal rej_hi, rej_lo, rej_bar, arm_bar, sl, fail_px, arm_hi, arm_lo
        pend_long = pend_short = False
        fractal_ready = left_liq = False
        rej_long = rej_short = False
        rej_hi = rej_lo = np.nan
        rej_bar = -1
        arm_bar = -1
        sl = fail_px = arm_hi = arm_lo = np.nan

    def open_mit(is_long: bool, i: int, entry: float, stop: float, tp: float, tp_source: str):
        nonlocal open_trade, last_signal_bar, pend_long, pend_short
        if p.one_trade_at_a_time and open_trade is not None:
            return False
        if i - last_signal_bar < p.cooldown_bars:
            return False
        if is_long and not (stop < entry < tp):
            return False
        if not is_long and not (tp < entry < stop):
            return False
        if p.use_ema_filter and ema is not None:
            if is_long and entry < ema[i]:
                return False
            if (not is_long) and entry > ema[i]:
                return False
        if hours is not None:
            h = int(hours[i])
            s0, s1 = p.session_start_hour, p.session_end_hour
            if s0 <= s1:
                in_sess = s0 <= h < s1
            else:
                in_sess = h >= s0 or h < s1
            if not in_sess:
                return False
        open_trade = Trade(
            side="long" if is_long else "short",
            entry_bar=i,
            entry=entry,
            sl=stop,
            tp=tp,
            tag="MIT",
            tp_source=tp_source,
        )
        last_signal_bar = i
        pend_long = pend_short = False
        return True

    # EMA for optional trend filter
    ema = None
    if p.use_ema_filter:
        ema = df["close"].ewm(span=p.ema_len, adjust=False).mean().to_numpy()

    # session hours from index if available
    hours = None
    if p.session_start_hour >= 0 and p.session_end_hour >= 0:
        try:
            hours = df.index.hour.to_numpy()
        except Exception:
            hours = None

    for i in range(n):
        # pivots confirmed with lag
        conf = i - p.pivot_len
        if conf >= 0:
            if ph_arr[conf] is not None:
                last_ph = ph_arr[conf]
                last_ph_idx = conf
                swings_h.append(Swing(last_ph, conf))
                if len(swings_h) > 30:
                    swings_h.pop(0)
                liqs.append(Liq(last_ph, conf, True))
                if len(liqs) > 120:
                    liqs.pop(0)
            if pl_arr[conf] is not None:
                last_pl = pl_arr[conf]
                last_pl_idx = conf
                swings_l.append(Swing(last_pl, conf))
                if len(swings_l) > 30:
                    swings_l.pop(0)
                liqs.append(Liq(last_pl, conf, False))
                if len(liqs) > 120:
                    liqs.pop(0)

        # BOS -> OB
        bull_bos = last_ph is not None and c[i - 1] <= last_ph < c[i] if i > 0 and last_ph is not None else False
        bear_bos = last_pl is not None and c[i - 1] >= last_pl > c[i] if i > 0 and last_pl is not None else False
        # use cross style: close crosses
        if last_ph is not None and i > 0 and c[i - 1] < last_ph <= c[i]:
            bull_bos = True
            found = find_ob_candle(o, h, l, c, i, True, min(100, i - (last_pl_idx or 0)), p.ob_engulf_lookback)
            if found:
                idx, top, bot = found
                obs.append(OB(top, bot, idx, True))
                if len(obs) > 80:
                    obs.pop(0)
            last_ph = None
        if last_pl is not None and i > 0 and c[i - 1] > last_pl >= c[i]:
            bear_bos = True
            found = find_ob_candle(o, h, l, c, i, False, min(100, i - (last_ph_idx or 0)), p.ob_engulf_lookback)
            if found:
                idx, top, bot = found
                obs.append(OB(top, bot, idx, False))
                if len(obs) > 80:
                    obs.pop(0)
            last_pl = None

        # update OBs / breakers
        just_broke = []
        for ob in obs:
            if not ob.active:
                continue
            if ob.is_bull and not ob.is_breaker and c[i] < ob.bottom:
                ob.is_breaker = True
                just_broke.append(ob)
            elif (not ob.is_bull) and not ob.is_breaker and c[i] > ob.top:
                ob.is_breaker = True
                just_broke.append(ob)
            elif ob.is_breaker:
                if ob.is_bull and c[i] > ob.top:
                    ob.active = False
                if (not ob.is_bull) and c[i] < ob.bottom:
                    ob.active = False

        # sweep liq by wick
        for lv in liqs:
            if lv.swept:
                continue
            if lv.is_high and h[i] > lv.price:
                lv.swept = True
            if (not lv.is_high) and l[i] < lv.price:
                lv.swept = True

        # FVGs
        if i >= 2:
            if l[i] > h[i - 2] and (l[i] - h[i - 2]) >= c[i] * p.min_fvg_pct:
                fvgs.append(FVG(l[i], h[i - 2], i - 2, True))
            if h[i] < l[i - 2] and (l[i - 2] - h[i]) >= c[i] * p.min_fvg_pct:
                fvgs.append(FVG(l[i - 2], h[i], i - 2, False))
            if len(fvgs) > 80:
                fvgs.pop(0)
        for f in fvgs:
            if f.touched:
                continue
            if f.is_bull and l[i] <= f.top:
                f.touched = True
            if (not f.is_bull) and h[i] >= f.bottom:
                f.touched = True

        # manage open trade
        if open_trade is not None:
            t = open_trade
            hit_sl = hit_tp = False
            if t.side == "long":
                if l[i] <= t.sl:
                    hit_sl = True
                    t.exit = t.sl
                    t.reason = "sl"
                elif h[i] >= t.tp:
                    hit_tp = True
                    t.exit = t.tp
                    t.reason = "tp"
            else:
                if h[i] >= t.sl:
                    hit_sl = True
                    t.exit = t.sl
                    t.reason = "sl"
                elif l[i] <= t.tp:
                    hit_tp = True
                    t.exit = t.tp
                    t.reason = "tp"
            if not hit_sl and not hit_tp and i - t.entry_bar >= p.max_hold_bars:
                t.exit = c[i]
                t.reason = "time"
                hit_tp = True
            if hit_sl or hit_tp:
                # if both same bar, conservative: SL first
                if t.side == "long" and l[i] <= t.sl and h[i] >= t.tp:
                    t.exit, t.reason = t.sl, "sl"
                if t.side == "short" and h[i] >= t.sl and l[i] <= t.tp:
                    t.exit, t.reason = t.sl, "sl"
                t.exit_bar = i
                trades.append(t)
                open_trade = None

        # invalidate pending
        if pend_short and not np.isnan(sl) and h[i] > sl:
            reset_pend()
        if pend_long and not np.isnan(sl) and l[i] < sl:
            reset_pend()

        # fractal leave via extremes since arm
        if pend_long and arm_bar >= 0 and i > arm_bar:
            hh = float(h[arm_bar : i + 1].max())
            ll = float(l[arm_bar : i + 1].min())
            if hh > arm_hi:
                fractal_ready = True
            if fractal_ready and (not np.isnan(fail_px)) and ll > fail_px and ll < hh:
                left_liq = True
        if pend_short and arm_bar >= 0 and i > arm_bar:
            hh = float(h[arm_bar : i + 1].max())
            ll = float(l[arm_bar : i + 1].min())
            if ll < arm_lo:
                fractal_ready = True
            if fractal_ready and (not np.isnan(fail_px)) and hh < fail_px and hh > ll:
                left_liq = True

        fractal_ok_long = (not p.require_fractal_leave) or (fractal_ready and left_liq)
        fractal_ok_short = (not p.require_fractal_leave) or (fractal_ready and left_liq)

        # detect failed swings using current swings + untouched till now
        fail_hh = False
        fh1 = fh1b = None
        if len(swings_h) >= 3:
            sh2, sh1, sh0 = swings_h[-1], swings_h[-2], swings_h[-3]
            gap = sh2.bar - sh1.bar
            if (
                sh1.price > sh0.price
                and 0 < gap <= p.max_failed_swing_gap
                and sh2.price < sh1.price
                and level_untouched_high(sh1.price, sh1.bar, i)
            ):
                fail_hh, fh1, fh1b = True, sh1.price, sh1.bar

        fail_ll = False
        fl1 = fl1b = None
        if len(swings_l) >= 3:
            s2, s1, s0 = swings_l[-1], swings_l[-2], swings_l[-3]
            gap = s2.bar - s1.bar
            if (
                s1.price < s0.price
                and 0 < gap <= p.max_failed_swing_gap
                and s2.price > s1.price
                and level_untouched_low(s1.price, s1.bar, i)
            ):
                fail_ll, fl1, fl1b = True, s1.price, s1.bar

        # MSS approx
        mss_low = swings_l[-1].price if swings_l else None
        mss_high = swings_h[-1].price if swings_h else None
        mss_bear = mss_low is not None and c[i] < mss_low
        mss_bull = mss_high is not None and c[i] > mss_high

        # arm short mitigation
        if fail_hh and fh1 is not None:
            # find bullish OB for swing
            candidates = [ob for ob in obs if ob.is_bull and ob.start <= fh1b]
            if candidates:
                ob = max(candidates, key=lambda x: x.start)
                broke_now = ob in just_broke or (ob.is_breaker and c[i] < ob.bottom)
                if ob.is_breaker and broke_now:
                    mss_ok = (not p.require_mss) or mss_bear or c[i] < ob.bottom
                    if mss_ok and h[i] < fh1:
                        pend_short, pend_long = True, False
                        arm_bar = i
                        sl = fh1 * (1 + p.sl_buffer_pct)
                        ob_top, ob_bot = ob.top, ob.bottom
                        fail_px = fh1
                        arm_hi, arm_lo = h[i], l[i]
                        fractal_ready = left_liq = False
                        rej_long = rej_short = False
                        rej_bar = -1

        # arm long mitigation
        if fail_ll and fl1 is not None and not (pend_short and arm_bar == i):
            candidates = [ob for ob in obs if (not ob.is_bull) and ob.start <= fl1b]
            if candidates:
                ob = max(candidates, key=lambda x: x.start)
                broke_now = ob in just_broke or (ob.is_breaker and c[i] > ob.top)
                if ob.is_breaker and broke_now:
                    mss_ok = (not p.require_mss) or mss_bull or c[i] > ob.top
                    if mss_ok and l[i] > fl1:
                        pend_long, pend_short = True, False
                        arm_bar = i
                        sl = fl1 * (1 - p.sl_buffer_pct)
                        ob_top, ob_bot = ob.top, ob.bottom
                        fail_px = fl1
                        arm_hi, arm_lo = h[i], l[i]
                        fractal_ready = left_liq = False
                        rej_long = rej_short = False
                        rej_bar = -1

        # pullback + rejection entries
        def zone_touch() -> bool:
            return h[i] >= ob_bot and l[i] <= ob_top

        if pend_short and i > arm_bar and h[i] < sl and fractal_ok_short:
            if p.require_rejection:
                if rej_short and rej_bar >= 0 and i > rej_bar:
                    if c[i] < rej_lo:
                        entry = c[i]
                        tp, src = pick_tp(False, entry, sl)
                        if open_mit(False, i, entry, sl, tp, src):
                            reset_pend()
                    elif c[i] > rej_hi:
                        rej_short = False
                        rej_bar = -1
                if pend_short and zone_touch() and is_bear_rej(o[i], h[i], l[i], c[i], wick_need, p.rej_close_in_half):
                    rej_short, rej_long = True, False
                    rej_hi, rej_lo, rej_bar = h[i], l[i], i
            elif zone_touch():
                entry = c[i]
                tp, src = pick_tp(False, entry, sl)
                if open_mit(False, i, entry, sl, tp, src):
                    reset_pend()

        if pend_long and i > arm_bar and l[i] > sl and fractal_ok_long:
            if p.require_rejection:
                if rej_long and rej_bar >= 0 and i > rej_bar:
                    if c[i] > rej_hi:
                        entry = c[i]
                        tp, src = pick_tp(True, entry, sl)
                        if open_mit(True, i, entry, sl, tp, src):
                            reset_pend()
                    elif c[i] < rej_lo:
                        rej_long = False
                        rej_bar = -1
                if pend_long and zone_touch() and is_bull_rej(o[i], h[i], l[i], c[i], wick_need, p.rej_close_in_half):
                    rej_long, rej_short = True, False
                    rej_hi, rej_lo, rej_bar = h[i], l[i], i
            elif zone_touch():
                entry = c[i]
                tp, src = pick_tp(True, entry, sl)
                if open_mit(True, i, entry, sl, tp, src):
                    reset_pend()

    if open_trade is not None:
        open_trade.exit_bar = n - 1
        open_trade.exit = c[-1]
        open_trade.reason = "eod"
        trades.append(open_trade)

    return trades, summarize(trades, p)


def summarize(trades: list[Trade], p: Params) -> dict:
    if not trades:
        return {
            "trades": 0,
            "winrate": 0.0,
            "profit_factor": 0.0,
            "net_R": 0.0,
            "max_dd_R": 0.0,
            "avg_R": 0.0,
        }
    Rs = []
    fee = p.fee_bps / 10000.0
    for t in trades:
        risk = abs(t.entry - t.sl)
        if risk <= 0 or t.exit is None:
            continue
        raw = (t.exit - t.entry) if t.side == "long" else (t.entry - t.exit)
        # fees in price terms approx
        raw -= (t.entry + (t.exit or t.entry)) * fee
        Rs.append(raw / risk)
    if not Rs:
        return {"trades": 0, "winrate": 0.0, "profit_factor": 0.0, "net_R": 0.0, "max_dd_R": 0.0, "avg_R": 0.0}
    wins = [r for r in Rs if r > 0]
    losses = [r for r in Rs if r <= 0]
    gp = sum(wins)
    gl = abs(sum(losses))
    equity = np.cumsum(Rs)
    peak = np.maximum.accumulate(equity)
    dd = peak - equity
    return {
        "trades": len(Rs),
        "wins": len(wins),
        "losses": len(losses),
        "winrate": round(100 * len(wins) / len(Rs), 2),
        "profit_factor": round(gp / gl, 3) if gl > 0 else (999.0 if gp > 0 else 0.0),
        "net_R": round(float(sum(Rs)), 3),
        "avg_R": round(float(np.mean(Rs)), 3),
        "max_dd_R": round(float(dd.max()), 3),
        "tp_exits": sum(1 for t in trades if t.reason == "tp"),
        "sl_exits": sum(1 for t in trades if t.reason == "sl"),
        "tp_bsl": sum(1 for t in trades if t.tp_source == "bsl"),
        "tp_ssl": sum(1 for t in trades if t.tp_source == "ssl"),
        "tp_fvg": sum(1 for t in trades if t.tp_source == "fvg"),
        "tp_rr": sum(1 for t in trades if t.tp_source == "rr"),
    }
