# تحلیل اثر انرژی بر شرکت‌های سنگ‌آهن و فولاد

نمادها: **کچاد، کگل، کگهر، کنور، ارفع، کاوه، فصبا، فسبزوار**  
بازه: گزارش‌های فعالیت ماهانه کدال از **۱۴۰۰** تا آخرین ماه موجود.

## خروجی‌ها

| مسیر | توضیح |
|---|---|
| `data/raw/<نماد>/monthly_*.html` | اکسل HTML خام گزارش ماهانه کدال |
| `data/processed/energy_monthly.csv` | مصرف/نرخ/مبلغ گاز، برق، آب ماهانه |
| `data/processed/products_monthly.csv` | تولید و فروش ماهانه محصولات |
| `data/processed/usd_irr_daily.csv` | دلار آزاد TGJU |
| `data/processed/financials.json` | سود خالص / EPS از صورت‌های مالی |
| `reports/analysis_fa.md` | جمع‌بندی ترندها |

## محدودیت دسترسی کدال

`codal.ir` از خارج ایران معمولاً قابل دسترسی نیست. اسکریپت‌ها از HTTP/SOCKS پروکسی ایران استفاده می‌کنند.

فایل پروکسی: `/tmp/codal_ok_proxies.txt` یا `data/proxies.txt` با فرمت:

```
http|1.2.3.4:8080
socks5h|5.6.7.8:1080
```

## اجرا

```bash
cd steel-energy-analysis/scripts
python3 scrape_monthly.py          # دانلود گزارش‌های ماهانه
python3 reparse_all.py             # پارس مجدد با پارسر به‌روز
python3 scrape_financials.py       # صورت‌های مالی (سودآوری)
python3 fetch_usd.py               # دلار آزاد
python3 build_analysis.py          # ساخت جداول و گزارش
```

برای یک نماد:

```bash
python3 scrape_monthly.py کچاد
```

## فیلدهای انرژی

از جدول «مصرف انرژی» گزارش ماهانه:

- `month_qty` مقدار ماه
- `month_rate_rial` نرخ (ریال)
- `month_amount_mrial` مبلغ (میلیون ریال)
- مشابه برای YTD (`ytd_*`)

واحدها: گاز/آب معمولاً مترمکعب، برق مگاوات‌ساعت.
