#!/usr/bin/env python3
"""
ICT Failed-Swing Mitigation backtester + combo filters from sibling strategies.

Core entry (long example):
  - prior LL then failed higher low (SSL untouched)
  - bearish OB breaks -> breaker
  - optional rejection / fractal leave
  - SL: tight behind nearest swing / reject / OB (not far failed liquidity)
  - TP: BSL/SSL (min RR) -> untouched FVG -> RR fallback

Combo overlays (optional):
  - NY ORB bias (9:30-9:45 America/New_York) from ny-orb-fvg
  - NY trade session 9:30-16:00
  - EQH/EQL near failed swing from order-blocks-liquidity
  - PDH/PDL affinity from session confirmation
  - ICT killzones (London 02-05 / NY AM 07-10 NY time)
  - EMA trend
"""

from __future__ import annotations

from dataclasses import dataclass
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
    # Tiny buffer beyond structural SL (0.02% default — not "1 meter")
    sl_buffer_pct: float = 0.0002
    # failed_liq | nearest_swing | reject | ob | tight_best
    sl_mode: str = "tight_best"
    # Reject entries whose stop is absurdly tight (noise) or still huge
    min_risk_pct: float = 0.0003  # 0.03%
    max_risk_pct: float = 0.012  # 1.2%
    rr_fallback: float = 2.0
    min_tp_rr: float = 1.5
    prefer_liq_tp: bool = True
    prefer_fvg_tp: bool = True
    min_fvg_pct: float = 0.0003
    cooldown_bars: int = 10
    one_trade_at_a_time: bool = True
    fee_bps: float = 4.0
    max_hold_bars: int = 500
    use_ema_filter: bool = False
    ema_len: int = 200
    session_start_hour: int = -1  # UTC window window; -1 off
    session_end_hour: int = -1
    # --- combo filters ---
    require_ny_orb_bias: bool = False
    require_ny_session: bool = False
    require_eq_liquidity: bool = False
    eq_tolerance_pct: float = 0.0005  # 0.05%
    require_pd_affinity: bool = False
    pd_affinity_pct: float = 0.003  # fail within 0.3% of PDH/PDL
    require_killzone: bool = False  # London or NY AM (NY clock)


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
    is_equal: bool = False


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
    tp_source: str = "rr"
    sl_source: str = "failed_liq"


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


def _ny_clock(index: pd.DatetimeIndex) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if index.tz is None:
        idx = index.tz_localize("UTC")
    else:
        idx = index
    ny = idx.tz_convert("America/New_York")
    return ny.hour.to_numpy(), ny.minute.to_numpy(), (ny.year * 10000 + ny.month * 100 + ny.day).to_numpy()


def _build_orb_and_pd(
    h: np.ndarray, l: np.ndarray, c: np.ndarray, ny_h: np.ndarray, ny_m: np.ndarray, ny_day: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per-bar NY ORB bias (+1/-1/0) and previous-day high/low."""
    n = len(c)
    bias = np.zeros(n, dtype=np.int8)
    pdh = np.full(n, np.nan)
    pdl = np.full(n, np.nan)

    day_orb_hi = {}
    day_orb_lo = {}
    day_range_done = {}
    day_bias = {}
    day_hi = {}
    day_lo = {}

    # first pass: daily hi/lo and ORB
    for i in range(n):
        d = int(ny_day[i])
        day_hi[d] = h[i] if d not in day_hi else max(day_hi[d], h[i])
        day_lo[d] = l[i] if d not in day_lo else min(day_lo[d], l[i])
        mins = int(ny_h[i]) * 60 + int(ny_m[i])
        in_orb = 9 * 60 + 30 <= mins < 9 * 60 + 45
        if in_orb:
            if d not in day_orb_hi:
                day_orb_hi[d] = h[i]
                day_orb_lo[d] = l[i]
            else:
                day_orb_hi[d] = max(day_orb_hi[d], h[i])
                day_orb_lo[d] = min(day_orb_lo[d], l[i])
        elif d in day_orb_hi and d not in day_range_done and mins >= 9 * 60 + 45:
            day_range_done[d] = True

        if d in day_range_done:
            if d not in day_bias:
                day_bias[d] = 0
            if day_bias[d] == 0:
                if c[i] > day_orb_hi[d]:
                    day_bias[d] = 1
                elif c[i] < day_orb_lo[d]:
                    day_bias[d] = -1
        bias[i] = day_bias.get(d, 0)

    # map previous calendar day in the series
    unique_days = []
    seen = set()
    for d in ny_day:
        di = int(d)
        if di not in seen:
            seen.add(di)
            unique_days.append(di)
    prev = {}
    for i, d in enumerate(unique_days):
        if i > 0:
            prev[d] = unique_days[i - 1]

    for i in range(n):
        d = int(ny_day[i])
        pd = prev.get(d)
        if pd is not None:
            pdh[i] = day_hi[pd]
            pdl[i] = day_lo[pd]

    return bias, pdh, pdl


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

    pend_long = pend_short = False
    arm_bar = -1
    fail_px = arm_hi = arm_lo = ob_top = ob_bot = np.nan
    fractal_ready = left_liq = False
    rej_long = rej_short = False
    rej_hi = rej_lo = np.nan
    rej_bar = -1

    ema = df["close"].ewm(span=p.ema_len, adjust=False).mean().to_numpy() if p.use_ema_filter else None

    hours = None
    if p.session_start_hour >= 0 and p.session_end_hour >= 0:
        try:
            hours = df.index.hour.to_numpy()
        except Exception:
            hours = None

    ny_h = ny_m = ny_day = None
    orb_bias = pdh = pdl = None
    need_ny = p.require_ny_orb_bias or p.require_ny_session or p.require_pd_affinity or p.require_killzone
    if need_ny:
        ny_h, ny_m, ny_day = _ny_clock(df.index)
        orb_bias, pdh, pdl = _build_orb_and_pd(h, l, c, ny_h, ny_m, ny_day)

    def level_untouched_high(px: float, from_bar: int, i: int) -> bool:
        if from_bar >= i:
            return True
        return float(h[from_bar : i + 1].max()) <= px

    def level_untouched_low(px: float, from_bar: int, i: int) -> bool:
        if from_bar >= i:
            return True
        return float(l[from_bar : i + 1].min()) >= px

    def mark_equal(new_lv: Liq):
        tol = new_lv.price * p.eq_tolerance_pct
        for lv in liqs:
            if lv.is_high != new_lv.is_high or lv.swept:
                continue
            if abs(lv.price - new_lv.price) <= tol:
                lv.is_equal = True
                new_lv.is_equal = True

    def has_eq_near(fail: float, want_high: bool) -> bool:
        tol = fail * p.eq_tolerance_pct * 2
        for lv in liqs:
            if lv.is_high != want_high or not lv.is_equal:
                continue
            if abs(lv.price - fail) <= tol:
                return True
        return False

    def liq_targets(want_high: bool, below: bool, ref: float) -> list[float]:
        out = []
        for lv in liqs:
            if lv.is_high != want_high or lv.swept:
                continue
            if below and lv.price < ref:
                out.append(lv.price)
            if not below and lv.price > ref:
                out.append(lv.price)
        out.sort(reverse=below)
        return out

    def fvg_targets(want_bull: bool, below: bool, ref: float) -> list[float]:
        out = []
        for f in fvgs:
            if f.is_bull != want_bull or f.touched:
                continue
            edge = (f.top + f.bottom) / 2.0
            if below and edge < ref:
                out.append(edge)
            if not below and edge > ref:
                out.append(edge)
        out.sort(reverse=below)
        return out

    def pick_tp(is_long: bool, entry: float, stop: float) -> tuple[float, str]:
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
                    tp, src = px, ("bsl" if is_long else "ssl")
                    break
        if tp is None and p.prefer_fvg_tp:
            cands = fvg_targets(True, False, entry) if is_long else fvg_targets(False, True, entry)
            for px in cands:
                if ok(px):
                    tp, src = px, "fvg"
                    break
        if tp is None:
            rr = max(p.rr_fallback, p.min_tp_rr)
            tp = entry + risk * rr if is_long else entry - risk * rr
            src = "rr"
        return float(tp), src

    def compute_sl(is_long: bool, entry: float, i: int) -> tuple[Optional[float], str]:
        """Tight SL behind nearest structure — not the far failed BSL/SSL."""
        buf = entry * p.sl_buffer_pct
        cands: list[tuple[float, str]] = []

        # nearest confirmed swing on the protective side
        if is_long:
            for sw in reversed(swings_l):
                if sw.bar <= i and sw.price < entry:
                    cands.append((sw.price - buf, "nearest_swing"))
                    break
            if arm_bar >= 0:
                loc = float(l[max(arm_bar, 0) : i + 1].min())
                if loc < entry:
                    cands.append((loc - buf, "local_swing"))
        else:
            for sw in reversed(swings_h):
                if sw.bar <= i and sw.price > entry:
                    cands.append((sw.price + buf, "nearest_swing"))
                    break
            if arm_bar >= 0:
                loc = float(h[max(arm_bar, 0) : i + 1].max())
                if loc > entry:
                    cands.append((loc + buf, "local_swing"))

        if not np.isnan(rej_hi) and rej_bar >= 0:
            if is_long and rej_lo < entry:
                cands.append((rej_lo - buf, "reject"))
            if (not is_long) and rej_hi > entry:
                cands.append((rej_hi + buf, "reject"))

        if not np.isnan(ob_top):
            if is_long and ob_bot < entry:
                cands.append((ob_bot - buf, "ob"))
            if (not is_long) and ob_top > entry:
                cands.append((ob_top + buf, "ob"))

        # far failed liquidity as last-resort structural stop
        if not np.isnan(fail_px):
            if is_long and fail_px < entry:
                cands.append((fail_px - buf, "failed_liq"))
            if (not is_long) and fail_px > entry:
                cands.append((fail_px + buf, "failed_liq"))

        mode = p.sl_mode
        chosen = None
        src = "failed_liq"

        def valid(px: float) -> bool:
            if is_long:
                return px < entry
            return px > entry

        filtered = [(px, s) for px, s in cands if valid(px)]
        if not filtered:
            return None, src

        if mode == "failed_liq":
            for px, s in filtered:
                if s == "failed_liq":
                    chosen, src = px, s
                    break
            if chosen is None:
                chosen, src = filtered[-1]
        elif mode == "nearest_swing":
            for pref in ("nearest_swing", "local_swing", "reject", "ob", "failed_liq"):
                hit = [(px, s) for px, s in filtered if s == pref]
                if hit:
                    # tightest among this preference
                    chosen, src = (max(hit) if is_long else min(hit))
                    break
        elif mode == "reject":
            for pref in ("reject", "nearest_swing", "local_swing", "ob", "failed_liq"):
                hit = [(px, s) for px, s in filtered if s == pref]
                if hit:
                    chosen, src = (max(hit) if is_long else min(hit))
                    break
        elif mode == "ob":
            for pref in ("ob", "reject", "nearest_swing", "local_swing", "failed_liq"):
                hit = [(px, s) for px, s in filtered if s == pref]
                if hit:
                    chosen, src = (max(hit) if is_long else min(hit))
                    break
        else:  # tight_best — closest stop to entry among non-failed first
            non_fail = [(px, s) for px, s in filtered if s != "failed_liq"]
            pool = non_fail or filtered
            chosen, src = (max(pool) if is_long else min(pool))

        if chosen is None:
            return None, src

        risk_pct = abs(entry - chosen) / entry
        if risk_pct < p.min_risk_pct or risk_pct > p.max_risk_pct:
            # if too tight, widen to next farther candidate; if too wide, reject
            if risk_pct > p.max_risk_pct:
                return None, src
            # too tight: pick next farther (still preferably structural)
            farther = [(px, s) for px, s in filtered if abs(entry - px) / entry >= p.min_risk_pct]
            if not farther:
                return None, src
            chosen, src = (max(farther) if is_long else min(farther))  # still tightest among valid
            # wait, for long farther = lower SL = min; tightest valid with min risk = max among those with risk>=min
            if is_long:
                chosen, src = max(farther, key=lambda x: x[0])
            else:
                chosen, src = min(farther, key=lambda x: x[0])
            if abs(entry - chosen) / entry > p.max_risk_pct:
                return None, src
        return float(chosen), src

    def reset_pend():
        nonlocal pend_long, pend_short, fractal_ready, left_liq, rej_long, rej_short
        nonlocal rej_hi, rej_lo, rej_bar, arm_bar, fail_px, arm_hi, arm_lo, ob_top, ob_bot
        pend_long = pend_short = False
        fractal_ready = left_liq = False
        rej_long = rej_short = False
        rej_hi = rej_lo = np.nan
        rej_bar = -1
        arm_bar = -1
        fail_px = arm_hi = arm_lo = ob_top = ob_bot = np.nan

    def combo_ok(is_long: bool, i: int) -> bool:
        if p.require_ny_orb_bias and orb_bias is not None:
            b = int(orb_bias[i])
            if is_long and b != 1:
                return False
            if (not is_long) and b != -1:
                return False
        if p.require_ny_session and ny_h is not None:
            mins = int(ny_h[i]) * 60 + int(ny_m[i])
            if not (9 * 60 + 30 <= mins < 16 * 60):
                return False
        if p.require_killzone and ny_h is not None:
            mins = int(ny_h[i]) * 60 + int(ny_m[i])
            london = 2 * 60 <= mins < 5 * 60
            ny_am = 7 * 60 <= mins < 10 * 60
            if not (london or ny_am):
                return False
        if p.require_eq_liquidity and not np.isnan(fail_px):
            # short -> EQH near failed high; long -> EQL near failed low
            if not has_eq_near(fail_px, want_high=(not is_long)):
                return False
        if p.require_pd_affinity and pdh is not None and not np.isnan(fail_px):
            if is_long:
                if np.isnan(pdl[i]) or abs(fail_px - pdl[i]) / fail_px > p.pd_affinity_pct:
                    return False
            else:
                if np.isnan(pdh[i]) or abs(fail_px - pdh[i]) / fail_px > p.pd_affinity_pct:
                    return False
        return True

    def open_mit(is_long: bool, i: int, entry: float) -> bool:
        nonlocal open_trade, last_signal_bar, pend_long, pend_short
        if p.one_trade_at_a_time and open_trade is not None:
            return False
        if i - last_signal_bar < p.cooldown_bars:
            return False
        if p.use_ema_filter and ema is not None:
            if is_long and entry < ema[i]:
                return False
            if (not is_long) and entry > ema[i]:
                return False
        if hours is not None:
            hh = int(hours[i])
            s0, s1 = p.session_start_hour, p.session_end_hour
            in_sess = (s0 <= hh < s1) if s0 <= s1 else (hh >= s0 or hh < s1)
            if not in_sess:
                return False
        if not combo_ok(is_long, i):
            return False

        stop, sl_src = compute_sl(is_long, entry, i)
        if stop is None:
            return False
        tp, tp_src = pick_tp(is_long, entry, stop)
        if is_long and not (stop < entry < tp):
            return False
        if (not is_long) and not (tp < entry < stop):
            return False

        open_trade = Trade(
            side="long" if is_long else "short",
            entry_bar=i,
            entry=entry,
            sl=stop,
            tp=tp,
            tag="MIT",
            tp_source=tp_src,
            sl_source=sl_src,
        )
        last_signal_bar = i
        pend_long = pend_short = False
        return True

    for i in range(n):
        conf = i - p.pivot_len
        if conf >= 0:
            if ph_arr[conf] is not None:
                last_ph = ph_arr[conf]
                last_ph_idx = conf
                swings_h.append(Swing(last_ph, conf))
                if len(swings_h) > 40:
                    swings_h.pop(0)
                lv = Liq(last_ph, conf, True)
                mark_equal(lv)
                liqs.append(lv)
                if len(liqs) > 160:
                    liqs.pop(0)
            if pl_arr[conf] is not None:
                last_pl = pl_arr[conf]
                last_pl_idx = conf
                swings_l.append(Swing(last_pl, conf))
                if len(swings_l) > 40:
                    swings_l.pop(0)
                lv = Liq(last_pl, conf, False)
                mark_equal(lv)
                liqs.append(lv)
                if len(liqs) > 160:
                    liqs.pop(0)

        if last_ph is not None and i > 0 and c[i - 1] < last_ph <= c[i]:
            found = find_ob_candle(o, h, l, c, i, True, min(100, i - (last_pl_idx or 0)), p.ob_engulf_lookback)
            if found:
                idx, top, bot = found
                obs.append(OB(top, bot, idx, True))
                if len(obs) > 80:
                    obs.pop(0)
            last_ph = None
        if last_pl is not None and i > 0 and c[i - 1] > last_pl >= c[i]:
            found = find_ob_candle(o, h, l, c, i, False, min(100, i - (last_ph_idx or 0)), p.ob_engulf_lookback)
            if found:
                idx, top, bot = found
                obs.append(OB(top, bot, idx, False))
                if len(obs) > 80:
                    obs.pop(0)
            last_pl = None

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

        for lv in liqs:
            if lv.swept:
                continue
            if lv.is_high and h[i] > lv.price:
                lv.swept = True
            if (not lv.is_high) and l[i] < lv.price:
                lv.swept = True

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

        if open_trade is not None:
            t = open_trade
            hit_sl = hit_tp = False
            if t.side == "long":
                if l[i] <= t.sl:
                    hit_sl = True
                    t.exit, t.reason = t.sl, "sl"
                elif h[i] >= t.tp:
                    hit_tp = True
                    t.exit, t.reason = t.tp, "tp"
            else:
                if h[i] >= t.sl:
                    hit_sl = True
                    t.exit, t.reason = t.sl, "sl"
                elif l[i] <= t.tp:
                    hit_tp = True
                    t.exit, t.reason = t.tp, "tp"
            if not hit_sl and not hit_tp and i - t.entry_bar >= p.max_hold_bars:
                t.exit, t.reason = c[i], "time"
                hit_tp = True
            if hit_sl or hit_tp:
                if t.side == "long" and l[i] <= t.sl and h[i] >= t.tp:
                    t.exit, t.reason = t.sl, "sl"
                if t.side == "short" and h[i] >= t.sl and l[i] <= t.tp:
                    t.exit, t.reason = t.sl, "sl"
                t.exit_bar = i
                trades.append(t)
                open_trade = None

        # invalidate setup if failed liquidity is taken (structure break)
        if pend_short and not np.isnan(fail_px) and h[i] > fail_px:
            reset_pend()
        if pend_long and not np.isnan(fail_px) and l[i] < fail_px:
            reset_pend()

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

        mss_low = swings_l[-1].price if swings_l else None
        mss_high = swings_h[-1].price if swings_h else None
        mss_bear = mss_low is not None and c[i] < mss_low
        mss_bull = mss_high is not None and c[i] > mss_high

        if fail_hh and fh1 is not None:
            candidates = [ob for ob in obs if ob.is_bull and ob.start <= fh1b]
            if candidates:
                ob = max(candidates, key=lambda x: x.start)
                broke_now = ob in just_broke or (ob.is_breaker and c[i] < ob.bottom)
                if ob.is_breaker and broke_now:
                    mss_ok = (not p.require_mss) or mss_bear or c[i] < ob.bottom
                    if mss_ok and h[i] < fh1:
                        pend_short, pend_long = True, False
                        arm_bar = i
                        fail_px = fh1
                        ob_top, ob_bot = ob.top, ob.bottom
                        arm_hi, arm_lo = h[i], l[i]
                        fractal_ready = left_liq = False
                        rej_long = rej_short = False
                        rej_bar = -1
                        rej_hi = rej_lo = np.nan

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
                        fail_px = fl1
                        ob_top, ob_bot = ob.top, ob.bottom
                        arm_hi, arm_lo = h[i], l[i]
                        fractal_ready = left_liq = False
                        rej_long = rej_short = False
                        rej_bar = -1
                        rej_hi = rej_lo = np.nan

        def zone_touch() -> bool:
            return h[i] >= ob_bot and l[i] <= ob_top

        # structure still valid if failed liq untouched
        if pend_short and i > arm_bar and (np.isnan(fail_px) or h[i] < fail_px) and fractal_ok_short:
            if p.require_rejection:
                if rej_short and rej_bar >= 0 and i > rej_bar:
                    if c[i] < rej_lo:
                        if open_mit(False, i, c[i]):
                            reset_pend()
                    elif c[i] > rej_hi:
                        rej_short = False
                        rej_bar = -1
                        rej_hi = rej_lo = np.nan
                if pend_short and zone_touch() and is_bear_rej(o[i], h[i], l[i], c[i], wick_need, p.rej_close_in_half):
                    rej_short, rej_long = True, False
                    rej_hi, rej_lo, rej_bar = h[i], l[i], i
            elif zone_touch():
                if open_mit(False, i, c[i]):
                    reset_pend()

        if pend_long and i > arm_bar and (np.isnan(fail_px) or l[i] > fail_px) and fractal_ok_long:
            if p.require_rejection:
                if rej_long and rej_bar >= 0 and i > rej_bar:
                    if c[i] > rej_hi:
                        if open_mit(True, i, c[i]):
                            reset_pend()
                    elif c[i] < rej_lo:
                        rej_long = False
                        rej_bar = -1
                        rej_hi = rej_lo = np.nan
                if pend_long and zone_touch() and is_bull_rej(o[i], h[i], l[i], c[i], wick_need, p.rej_close_in_half):
                    rej_long, rej_short = True, False
                    rej_hi, rej_lo, rej_bar = h[i], l[i], i
            elif zone_touch():
                if open_mit(True, i, c[i]):
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
            "avg_risk_pct": 0.0,
        }
    Rs = []
    risks = []
    fee = p.fee_bps / 10000.0
    for t in trades:
        risk = abs(t.entry - t.sl)
        if risk <= 0 or t.exit is None:
            continue
        risks.append(risk / t.entry * 100)
        raw = (t.exit - t.entry) if t.side == "long" else (t.entry - t.exit)
        raw -= (t.entry + (t.exit or t.entry)) * fee
        Rs.append(raw / risk)
    if not Rs:
        return {
            "trades": 0,
            "winrate": 0.0,
            "profit_factor": 0.0,
            "net_R": 0.0,
            "max_dd_R": 0.0,
            "avg_R": 0.0,
            "avg_risk_pct": 0.0,
        }
    wins = [r for r in Rs if r > 0]
    losses = [r for r in Rs if r <= 0]
    gp = sum(wins)
    gl = abs(sum(losses))
    equity = np.cumsum(Rs)
    peak = np.maximum.accumulate(equity)
    dd = peak - equity
    sl_sources: dict[str, int] = {}
    for t in trades:
        sl_sources[t.sl_source] = sl_sources.get(t.sl_source, 0) + 1
    return {
        "trades": len(Rs),
        "wins": len(wins),
        "losses": len(losses),
        "winrate": round(100 * len(wins) / len(Rs), 2),
        "profit_factor": round(gp / gl, 3) if gl > 0 else (999.0 if gp > 0 else 0.0),
        "net_R": round(float(sum(Rs)), 3),
        "avg_R": round(float(np.mean(Rs)), 3),
        "max_dd_R": round(float(dd.max()), 3),
        "avg_risk_pct": round(float(np.mean(risks)), 4),
        "tp_exits": sum(1 for t in trades if t.reason == "tp"),
        "sl_exits": sum(1 for t in trades if t.reason == "sl"),
        "tp_bsl": sum(1 for t in trades if t.tp_source == "bsl"),
        "tp_ssl": sum(1 for t in trades if t.tp_source == "ssl"),
        "tp_fvg": sum(1 for t in trades if t.tp_source == "fvg"),
        "tp_rr": sum(1 for t in trades if t.tp_source == "rr"),
        "sl_sources": sl_sources,
    }
