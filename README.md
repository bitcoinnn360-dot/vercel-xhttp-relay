# داشبورد گزارش روزانه بازار — توسعه معادن و فلزات

داشبورد مدیریتی RTL با ظاهر ترمینال تحلیلی (نزدیک به GuruFocus)، نمودار قیمت برای اقلام گزارش روزانه، و بروزرسانی خودکار.

## اجرا

```bash
npm install
npm run dev
```

```bash
npm run build
npx wrangler pages deploy dist --project-name=arz-digital-dashboard --branch=main
```

## منابع داده

| منبع | نقش |
|------|-----|
| **TGJU** | شاخص کل بورس، ارز، طلا، مس، آلومینیوم، روی، نفت، بیت‌کوین، سنگ‌آهن و ورق گرم (جایگزین موقت Custeel) |
| **FRED** | کلان جهانی (جایگزین Trading Economics): برنت، سنگ‌آهن، مس، شاخص دلار، اوراق ۱۰ساله |
| **گزارش روزانه / seed** | NAV، جدول سهام معدنی، جریان پول، ضرایب IME |
| **scripts/scrape_market.py** | اسکرپر اختیاری TSETMC/IME وقتی IP ایران در دسترس است |
| **Custeel** | زنجیره فولاد چین (لاگین اشتراک) — `scripts/scrape_steel.py` / `/api/steel` |
| **بورس کالا (IME)** | آمار فیزیکی `offer-stat` — از IP ایران؛ endpoint: `imedata.asmx/GetAmareMoamelatList` |

## ساختار مهم

```
src/                 # فرانت React
functions/api/       # Cloudflare Pages Functions (FRED proxy + live)
scripts/             # اسکرپر پایتون
```
