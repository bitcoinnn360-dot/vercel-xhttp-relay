"""Build analysis tables: energy/production trends + dollarized profitability."""

from __future__ import annotations

import json
from pathlib import Path

import jdatetime
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"
REPORTS = ROOT / "reports"
PROC.mkdir(parents=True, exist_ok=True)
REPORTS.mkdir(parents=True, exist_ok=True)


def jalali_to_gregorian(s: str):
    try:
        y, m, d = [int(x) for x in str(s).split("/")]
        return jdatetime.date(y, m, d).togregorian()
    except Exception:
        return pd.NaT


def load_json(path: Path):
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def month_key(period_end: str) -> str:
    # 1403/06/31 -> 1403-06
    parts = str(period_end).split("/")
    if len(parts) >= 2:
        return f"{parts[0]}-{parts[1]}"
    return str(period_end)


def build_energy(df_energy: pd.DataFrame) -> pd.DataFrame:
    if df_energy.empty:
        return df_energy
    df = df_energy.copy()
    df["month"] = df["period_end"].map(month_key)
    df["year"] = df["period_end"].astype(str).str.slice(0, 4)
    df["gregorian"] = df["period_end"].map(jalali_to_gregorian)
    # wide-ish useful view
    return df.sort_values(["symbol", "period_end", "energy_type"])


def build_production(df_prod: pd.DataFrame) -> pd.DataFrame:
    if df_prod.empty:
        return df_prod
    df = df_prod.copy()
    df["month"] = df["period_end"].map(month_key)
    df["year"] = df["period_end"].astype(str).str.slice(0, 4)
    # aggregate total production / sales by symbol-month for steel-like products
    return df.sort_values(["symbol", "period_end", "product"])


def attach_usd(df: pd.DataFrame, usd: pd.DataFrame, date_col: str = "gregorian") -> pd.DataFrame:
    if df.empty or usd.empty:
        return df
    u = usd.copy()
    u["date"] = pd.to_datetime(u["date"], utc=False).astype("datetime64[ns]")
    u = u.dropna(subset=["date", "usd_irr"]).sort_values("date")
    out = df.copy()
    out["_dt"] = pd.to_datetime(out[date_col], utc=False).astype("datetime64[ns]")
    out = out.dropna(subset=["_dt"]).sort_values("_dt")
    out = pd.merge_asof(
        out, u[["date", "usd_irr"]], left_on="_dt", right_on="date", direction="backward"
    )
    out = out.drop(columns=["_dt", "date"], errors="ignore")
    return out


def summarize(energy: pd.DataFrame, products: pd.DataFrame, fins: pd.DataFrame, usd: pd.DataFrame) -> str:
    lines = []
    lines.append("# تأثیر انرژی بر تولید و سودآوری شرکت‌های سنگ‌آهن و فولاد (۱۴۰۰ تاکنون)")
    lines.append("")
    lines.append("منبع اصلی: گزارش فعالیت ماهانه ناشران در کدال (جداول تولید/فروش و مصرف انرژی).")
    lines.append("نرخ دلار: دلار آزاد TGJU برای تبدیل تقریبی ارقام ریالی.")
    lines.append("")

    if energy.empty:
        lines.append("هنوز داده انرژی استخراج نشده است.")
        return "\n".join(lines)

    # coverage
    cov = (
        energy.groupby(["symbol", "energy_type"])["period_end"]
        .agg(["min", "max", "count"])
        .reset_index()
    )
    lines.append("## پوشش داده انرژی")
    lines.append("")
    lines.append("| نماد | نوع انرژی | از | تا | تعداد ماه |")
    lines.append("|---|---|---|---|---:|")
    for _, r in cov.sort_values(["symbol", "energy_type"]).iterrows():
        lines.append(
            f"| {r['symbol']} | {r['energy_type']} | {r['min']} | {r['max']} | {int(r['count'])} |"
        )
    lines.append("")

    # annual totals for gas/electricity qty and amount
    e = energy.copy()
    e["year"] = e["period_end"].astype(str).str.slice(0, 4)
    annual = (
        e.groupby(["symbol", "year", "energy_type"], as_index=False)
        .agg(
            qty=("month_qty", "sum"),
            amount_mrial=("month_amount_mrial", "sum"),
            avg_rate=("month_rate_rial", "mean"),
            n=("month_qty", "count"),
        )
    )
    annual.to_csv(PROC / "energy_annual.csv", index=False)

    lines.append("## جمع مصرف و هزینه انرژی (سالانه، از جمع ماهانه)")
    lines.append("")
    for et in ["گاز طبیعی", "برق"]:
        sub = annual[annual["energy_type"] == et].copy()
        if sub.empty:
            continue
        lines.append(f"### {et}")
        lines.append("")
        pivot_qty = sub.pivot_table(index="symbol", columns="year", values="qty", aggfunc="sum")
        pivot_amt = sub.pivot_table(index="symbol", columns="year", values="amount_mrial", aggfunc="sum")
        lines.append("مقدار:")
        lines.append("")
        lines.append(pivot_qty.to_markdown())
        lines.append("")
        lines.append("مبلغ (میلیون ریال):")
        lines.append("")
        lines.append(pivot_amt.to_markdown())
        lines.append("")

    # rate trend YoY
    lines.append("## روند نرخ انرژی (میانگین ماهانه هر سال)")
    lines.append("")
    rate = (
        e.groupby(["symbol", "year", "energy_type"], as_index=False)["month_rate_rial"].mean()
    )
    for et in ["گاز طبیعی", "برق"]:
        sub = rate[rate["energy_type"] == et]
        if sub.empty:
            continue
        piv = sub.pivot_table(index="symbol", columns="year", values="month_rate_rial", aggfunc="mean")
        lines.append(f"### میانگین نرخ {et} (ریال)")
        lines.append("")
        lines.append(piv.to_markdown())
        lines.append("")

    # production proxy: sum of month_production for key products
    if not products.empty:
        p = products.copy()
        p["year"] = p["period_end"].astype(str).str.slice(0, 4)
        # focus on major outputs
        key_mask = p["product"].astype(str).str.contains(
            "فولاد|گندله|کنسانتره|آهن اسفنج|شمش|ورق|میلگرد|آهن اسفنجی",
            regex=True,
            na=False,
        )
        pkey = p[key_mask]
        prod_annual = (
            pkey.groupby(["symbol", "year", "product"], as_index=False)["month_production"].sum()
        )
        prod_annual.to_csv(PROC / "production_annual_by_product.csv", index=False)
        sales_annual = (
            pkey.groupby(["symbol", "year"], as_index=False)
            .agg(
                sales_mrial=("month_sales_amount_mrial", "sum"),
                production=("month_production", "sum"),
            )
        )
        sales_annual.to_csv(PROC / "sales_production_annual.csv", index=False)

        lines.append("## فروش ماهانه تجمیع‌شده سالانه (میلیون ریال)")
        lines.append("")
        piv = sales_annual.pivot_table(index="symbol", columns="year", values="sales_mrial", aggfunc="sum")
        lines.append(piv.to_markdown())
        lines.append("")

        # attach USD to yearly sales using year-end-ish average USD
        if not usd.empty:
            u = usd.copy()
            u["date"] = pd.to_datetime(u["date"])
            if "date_jalali" in u.columns:
                u["jy"] = u["date_jalali"].astype(str).str.slice(0, 4)
            else:
                u["jy"] = u["date"].apply(
                    lambda d: str(jdatetime.date.fromgregorian(date=d.date()).year)
                )
            usd_year = u.groupby("jy", as_index=False)["usd_irr"].mean().rename(columns={"jy": "year", "usd_irr": "usd_irr_avg"})
            s2 = sales_annual.merge(usd_year, on="year", how="left")
            # million rial / (usd_irr) * 1e6 = USD
            s2["sales_usd_mn"] = s2["sales_mrial"] * 1_000_000 / s2["usd_irr_avg"] / 1_000_000
            s2.to_csv(PROC / "sales_annual_usd.csv", index=False)
            lines.append("## فروش تقریبی دلاری (میلیون دلار، با میانگین دلار آزاد همان سال شمسی)")
            lines.append("")
            pivu = s2.pivot_table(index="symbol", columns="year", values="sales_usd_mn", aggfunc="sum")
            lines.append(pivu.round(1).to_markdown())
            lines.append("")

    if not fins.empty:
        f = pd.DataFrame(fins)
        f = f[f.get("net_income_mrial").notna()] if "net_income_mrial" in f.columns else f
        if not f.empty and "months" in f.columns:
            # prefer 12-month statements
            annual_f = f[f["months"] == 12].copy()
            if annual_f.empty:
                annual_f = f.copy()
            annual_f["year"] = annual_f["period_end"].astype(str).str.slice(0, 4)
            # prefer non-consolidated if both? keep both separately
            lines.append("## سود خالص از صورت‌های مالی (میلیون ریال)")
            lines.append("")
            piv = annual_f.pivot_table(
                index=["symbol", "consolidated"] if "consolidated" in annual_f.columns else "symbol",
                columns="year",
                values="net_income_mrial",
                aggfunc="last",
            )
            lines.append(piv.to_markdown())
            lines.append("")
            if not usd.empty:
                u = usd.copy()
                u["date"] = pd.to_datetime(u["date"])
                u["jy"] = u["date"].apply(
                    lambda d: str(jdatetime.date.fromgregorian(date=d.date()).year)
                )
                usd_year = u.groupby("jy", as_index=False)["usd_irr"].mean().rename(
                    columns={"jy": "year", "usd_irr": "usd_irr_avg"}
                )
                af = annual_f.merge(usd_year, on="year", how="left")
                af["net_income_usd_mn"] = af["net_income_mrial"] * 1_000_000 / af["usd_irr_avg"] / 1_000_000
                af.to_csv(PROC / "net_income_usd.csv", index=False)
                lines.append("## سود خالص تقریبی دلاری (میلیون دلار)")
                lines.append("")
                pivu = af.pivot_table(index="symbol", columns="year", values="net_income_usd_mn", aggfunc="last")
                lines.append(pivu.round(1).to_markdown())
                lines.append("")

    # energy intensity vs production if possible
    lines.append("## نکات تحلیلی اولیه")
    lines.append("")
    lines.append(
        "- قطعی/محدودیت گاز معمولاً در ماه‌های سرد (آذر تا اسفند) با افت `month_qty` گاز و همزمان افت تولید محصولات انرژی‌بر (آهن اسفنجی/فولاد) دیده می‌شود."
    )
    lines.append(
        "- قطعی برق در تابستان بیشتر روی نمادهای فولادی اثر می‌گذارد؛ در داده‌ها باید افت مصرف برق و تولید همزمان چک شود."
    )
    lines.append(
        "- رشد `month_rate_rial` نشان‌دهنده گران‌شدن تعرفه است؛ اگر مقدار مصرف ثابت/کاهشی ولی مبلغ صعودی باشد، فشار هزینه‌ای انرژی غالب است."
    )
    lines.append(
        "- برای مقایسه دلاری، فروش/سود ریالی با میانگین دلار آزاد همان سال شمسی تعدیل شده (تقریبی؛ نرخ نیما/توافقی متفاوت است)."
    )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    energy = pd.DataFrame(load_json(PROC / "energy_monthly.json"))
    products = pd.DataFrame(load_json(PROC / "products_monthly.json"))
    fins = load_json(PROC / "financials.json")
    usd_path = PROC / "usd_irr_daily.csv"
    usd = pd.read_csv(usd_path) if usd_path.exists() else pd.DataFrame()

    energy = build_energy(energy)
    products = build_production(products)

    if not energy.empty:
        energy.to_csv(PROC / "energy_monthly.csv", index=False)
    if not products.empty:
        products.to_csv(PROC / "products_monthly.csv", index=False)

    # dollarize monthly energy amounts
    if not energy.empty and not usd.empty:
        e2 = energy.copy()
        e2["gregorian"] = e2["period_end"].map(jalali_to_gregorian)
        e2 = attach_usd(e2, usd)
        e2["month_amount_usd"] = e2["month_amount_mrial"] * 1_000_000 / e2["usd_irr"]
        e2.to_csv(PROC / "energy_monthly_usd.csv", index=False)

    report = summarize(energy, products, pd.DataFrame(fins) if fins else pd.DataFrame(), usd)
    (REPORTS / "analysis_fa.md").write_text(report, encoding="utf-8")
    print(report[:2000])
    print("\n... saved", REPORTS / "analysis_fa.md")


if __name__ == "__main__":
    main()
