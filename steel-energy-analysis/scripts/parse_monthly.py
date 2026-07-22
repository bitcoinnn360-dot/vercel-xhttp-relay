"""Parse Codal monthly HTML-Excel reports for production/sales/energy."""

from __future__ import annotations

import io
import re
from typing import Any

import pandas as pd

PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
ARABIC_CHARS = str.maketrans({
    "ي": "ی",
    "ك": "ک",
    "ة": "ه",
    "‌": "",  # zwnj
    "‎": "",
    "‏": "",
})


def normalize_fa(text: Any) -> str:
    if text is None or (isinstance(text, float) and pd.isna(text)):
        return ""
    s = str(text).translate(PERSIAN_DIGITS).translate(ARABIC_CHARS)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def to_english_digits(text: Any) -> str:
    return normalize_fa(text)


def parse_number(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    s = to_english_digits(value).strip()
    if not s or s.lower() in {"nan", "none", "-", "—", "–"}:
        return None
    s = s.replace(",", "").replace("٬", "").replace(" ", "")
    s = s.replace("(", "-").replace(")", "")
    try:
        return float(s)
    except ValueError:
        return None


def extract_period_end(title: str) -> str | None:
    """Return YYYY/MM/DD (Jalali, English digits) from monthly title."""
    t = to_english_digits(title)
    m = re.search(r"(1[34]\d{2}/\d{2}/\d{2})", t)
    return m.group(1) if m else None


def is_revision(title: str) -> bool:
    return "اصلاحیه" in (title or "")


def _flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if isinstance(out.columns, pd.MultiIndex):
        cols = []
        for col in out.columns:
            parts = [to_english_digits(x).strip() for x in col if str(x) != "nan"]
            # keep last non-empty unique-ish label
            label = " | ".join(dict.fromkeys([p for p in parts if p]))
            cols.append(label)
        out.columns = cols
    else:
        out.columns = [to_english_digits(c).strip() for c in out.columns]
    return out


def _find_period_block_columns(columns: list[str]) -> dict[str, list[str]]:
    """Group columns by period header keywords."""
    blocks: dict[str, list[str]] = {
        "month": [],
        "ytd": [],
        "ytd_ly": [],
        "ytd_prev": [],
    }
    for col in columns:
        c = col.replace("‌", "")
        if "دوره یک ماهه" in c or "دوره یکماهه" in c:
            blocks["month"].append(col)
        elif "از ابتدای سال مالی تا تاریخ" in c and "اصلاح" not in c:
            # distinguish current ytd vs last-year ytd by later parsing of date
            blocks["ytd"].append(col)
        elif "اصلاح شده" in c:
            blocks["ytd_prev"].append(col)
    return blocks


def _pick_metric_col(cols: list[str], metric_keys: list[str]) -> str | None:
    for col in cols:
        low = col
        if all(k in low for k in metric_keys):
            return col
        # multiindex flattened often ends with metric
        tail = low.split("|")[-1].strip()
        if any(tail == k or tail.endswith(k) for k in metric_keys):
            # ensure parent period matches by requiring col in cols already
            if any(k in tail for k in metric_keys):
                return col
    # softer match: metric keyword in last segment
    for col in cols:
        tail = col.split("|")[-1].strip()
        for k in metric_keys:
            if k in tail:
                return col
    return None


def _row_name(row: pd.Series) -> str:
    for key in row.index[:3]:
        val = to_english_digits(row.get(key)).strip()
        if val and val.lower() != "nan":
            # skip unit-like tiny fields later
            return val
    return ""


def _period_date_in_label(label: str) -> str | None:
    m = re.search(r"(1[34]\d{2}/\d{2}/\d{2})", to_english_digits(label))
    return m.group(1) if m else None


def _group_cols_by_prefix(columns: list[str], predicate) -> list[list[str]]:
    """Group flattened columns that share the same period-prefix before ' | '."""
    groups: dict[str, list[str]] = {}
    order: list[str] = []
    for col in columns:
        if not predicate(col):
            continue
        prefix = col.split("|")[0].strip()
        if prefix not in groups:
            groups[prefix] = []
            order.append(prefix)
        groups[prefix].append(col)
    return [groups[p] for p in order]


def _metrics_from_cols(row: pd.Series, cols: list[str]) -> dict[str, float | None]:
    qty = rate = amt = None
    for col in cols:
        tail = col.split("|")[-1].strip()
        num = parse_number(row.get(col))
        if "مقدار" in tail:
            qty = num
        elif "نرخ" in tail:
            rate = num
        elif "مبلغ" in tail:
            amt = num
    return {"qty": qty, "rate": rate, "amount_mrial": amt}


def parse_energy_table(df: pd.DataFrame, period_end: str | None = None) -> list[dict[str, Any]]:
    df = _flatten_columns(df)
    flat = " ".join(map(str, df.columns)) + " " + " ".join(df.astype(str).fillna("").values.ravel())
    if "گاز طبیعی" not in flat and "نوع انرژی" not in flat:
        return []

    month_groups = _group_cols_by_prefix(
        list(df.columns),
        lambda c: ("دوره یک ماهه" in c or "دوره یکماهه" in c),
    )
    ytd_groups = _group_cols_by_prefix(
        list(df.columns),
        lambda c: (
            "از ابتدای سال مالی تا تاریخ" in c
            and "اصلاح" not in c
            and "دوره یک" not in c
        ),
    )

    # Choose current YTD group: exact period_end match, else the max date in same year, else last group
    def choose_ytd(groups: list[list[str]]) -> list[str]:
        if not groups:
            return []
        scored = []
        for g in groups:
            label = g[0]
            d = _period_date_in_label(label)
            scored.append((d or "", g))
        if period_end:
            for d, g in scored:
                if d == period_end:
                    return g
            year = period_end.split("/")[0]
            same_year = [(d, g) for d, g in scored if d.startswith(year)]
            if same_year:
                return max(same_year, key=lambda x: x[0])[1]
        return scored[-1][1] if scored else []

    month_cols = month_groups[0] if month_groups else []
    ytd_cols = choose_ytd(ytd_groups)

    records = []
    for _, row in df.iterrows():
        energy_type = None
        unit = None
        for val in row.values:
            s = to_english_digits(val).strip()
            if s in {"گاز طبیعی", "برق", "آب"}:
                energy_type = s
            if s in {"مترمکعب", "مگاوات ساعت", "کیلووات ساعت", "کيلووات ساعت"}:
                unit = s
        if not energy_type:
            continue

        month = _metrics_from_cols(row, month_cols)
        ytd = _metrics_from_cols(row, ytd_cols)
        records.append(
            {
                "energy_type": energy_type,
                "unit": unit,
                "month_qty": month["qty"],
                "month_rate_rial": month["rate"],
                "month_amount_mrial": month["amount_mrial"],
                "ytd_qty": ytd["qty"],
                "ytd_rate_rial": ytd["rate"],
                "ytd_amount_mrial": ytd["amount_mrial"],
            }
        )
    return records


def parse_production_sales_table(df: pd.DataFrame) -> list[dict[str, Any]]:
    df = _flatten_columns(df)
    flat = " ".join(map(str, df.columns))
    if "تعداد تولید" not in flat and "مبلغ فروش" not in flat:
        return []

    month_cols = [c for c in df.columns if "دوره یک ماهه" in c or "دوره یکماهه" in c]
    if not month_cols:
        return []

    records = []
    section = None
    for _, row in df.iterrows():
        name = None
        unit = None
        values = [to_english_digits(v).strip() for v in row.values]
        # detect section headers
        joined = " ".join(v for v in values if v and v.lower() != "nan")
        if "فروش داخلی" in joined:
            section = "domestic"
            continue
        if "فروش صادراتی" in joined:
            section = "export"
            continue
        if joined.startswith("جمع") or "برگشت از فروش" in joined or "تخفيفات" in joined or "تخفیفات" in joined:
            continue

        # product name: first non-empty textual cell that is not a pure number/unit
        for v in values:
            if not v or v.lower() == "nan":
                continue
            if parse_number(v) is not None and re.fullmatch(r"[-0-9.,]+", v.replace(",", "")):
                continue
            if v in {"تن", "مگاوات ساعت", "کیلوگرم", "عدد", "مترمکعب"}:
                unit = v
                continue
            name = v
            break
        if not name or name in {"شرح", "نام محصول"}:
            continue

        # unit may be second cell
        if not unit:
            for v in values[1:4]:
                if v in {"تن", "مگاوات ساعت", "کیلوگرم", "عدد", "مترمکعب"}:
                    unit = v
                    break

        prod = sales_qty = rate = amount = None
        for col in month_cols:
            tail = col.split("|")[-1].strip()
            num = parse_number(row.get(col))
            if "تعداد تولید" in tail or tail == "تعداد تولید":
                prod = num
            elif "تعداد فروش" in tail:
                sales_qty = num
            elif "نرخ فروش" in tail:
                rate = num
            elif "مبلغ فروش" in tail:
                amount = num

        if prod is None and sales_qty is None and amount is None:
            continue

        records.append(
            {
                "section": section,
                "product": name,
                "unit": unit,
                "month_production": prod,
                "month_sales_qty": sales_qty,
                "month_sales_rate_rial": rate,
                "month_sales_amount_mrial": amount,
            }
        )
    return records


def parse_monthly_html(content: bytes | str, period_end: str | None = None) -> dict[str, Any]:
    if isinstance(content, bytes):
        text = content.decode("utf-8", "ignore")
    else:
        text = content

    tables: list[pd.DataFrame] = []
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(text, "lxml")
        for node in soup.find_all("table"):
            try:
                dfs = pd.read_html(io.StringIO(str(node)), flavor="lxml")
                tables.extend(dfs)
            except Exception:
                try:
                    dfs = pd.read_html(io.StringIO(str(node)), header=None, flavor="lxml")
                    tables.extend(dfs)
                except Exception:
                    continue
    except Exception:
        try:
            tables = pd.read_html(io.StringIO(text))
        except Exception:
            return {"energy": [], "products": [], "n_tables": 0}

    energy: list[dict[str, Any]] = []
    products: list[dict[str, Any]] = []
    for df in tables:
        if df is None or df.empty:
            continue
        if not energy:
            try:
                energy = parse_energy_table(df, period_end=period_end)
            except Exception:
                energy = []
        if not products:
            try:
                products = parse_production_sales_table(df)
            except Exception:
                products = []

    return {
        "energy": energy,
        "products": products,
        "n_tables": len(tables),
    }
