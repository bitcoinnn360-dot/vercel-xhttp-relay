/** نام شرکت در گزارش → نماد تابلو + ISIN بورس‌ویو */
export const MINERAL_STOCK_SYMBOLS: {
  name: string
  symbol: string
  group: string
  isin: string
  exchange: string
}[] = [
  { name: 'توسعه معادن و فلزات', symbol: 'ومعادن', group: 'سرمایه‌گذاری', isin: 'IRO1MADN0001', exchange: 'IRTSENO' },
  { name: 'تجلی توسعه معادن و فلزات', symbol: 'تجلی', group: 'سرمایه‌گذاری', isin: 'IRO3TMMZ0001', exchange: 'IRIFBNO' },
  { name: 'گروه مدیریت سرمایه‌گذاری امید', symbol: 'وامید', group: 'سرمایه‌گذاری', isin: 'IRO1OIMC0001', exchange: 'IRTSENO' },
  { name: 'سرمایه‌گذاری صدر تأمین', symbol: 'تاصیکو', group: 'سرمایه‌گذاری', isin: 'IRO1SADR0001', exchange: 'IRTSENO' },
  { name: 'هلدینگ صنایع معدنی خاورمیانه', symbol: 'میدکو', group: 'سرمایه‌گذاری', isin: 'IRO1MDKO0001', exchange: 'IRTSENO' },
  { name: 'صنایع و معادن احیاء سپاهان', symbol: 'واحیا', group: 'سرمایه‌گذاری', isin: 'IRO7VHYP0001', exchange: 'IRIFBOTC' },
  { name: 'بین‌المللی توسعه صنایع و معادن غدیر', symbol: 'وغدیر', group: 'سرمایه‌گذاری', isin: 'IRO1GDIR0001', exchange: 'IRTSENO' },
  { name: 'گروه صنایع معادن فلات ایرانیان', symbol: 'فلات', group: 'سرمایه‌گذاری', isin: 'IRO7FLTP0001', exchange: 'IRIFBOTC' },
  { name: 'معدنی و صنعتی گل‌گهر', symbol: 'کگل', group: 'سنگ‌آهن', isin: 'IRO1GOLG0001', exchange: 'IRTSENO' },
  { name: 'معدنی و صنعتی چادرملو', symbol: 'کچاد', group: 'سنگ‌آهن', isin: 'IRO1CHML0001', exchange: 'IRTSENO' },
  { name: 'سنگ آهن گهرزمین', symbol: 'کگهر', group: 'سنگ‌آهن', isin: 'IRO3GZIZ0001', exchange: 'IRIFBNO' },
  { name: 'توسعه معدنی و صنعتی صبانور', symbol: 'کنور', group: 'سنگ‌آهن', isin: 'IRO1KNRZ0001', exchange: 'IRTSENO' },
  { name: 'فرآوری معدنی اپال کانی پارس', symbol: 'اپال', group: 'سنگ‌آهن', isin: 'IRO1OPAL0001', exchange: 'IRTSENO' },
  { name: 'فولاد مبارکه اصفهان', symbol: 'فولاد', group: 'فولادی', isin: 'IRO1FOLD0001', exchange: 'IRTSENO' },
  { name: 'فولاد خوزستان', symbol: 'فخوز', group: 'فولادی', isin: 'IRO1FKHZ0001', exchange: 'IRTSENO' },
  { name: 'فولاد هرمزگان جنوب', symbol: 'هرمز', group: 'فولادی', isin: 'IRO3FOHZ0001', exchange: 'IRIFBNO' },
  { name: 'آهن و فولاد ارفع', symbol: 'ارفع', group: 'فولادی', isin: 'IRO3ARFZ0001', exchange: 'IRIFBNO' },
  { name: 'فولاد خراسان', symbol: 'فخاس', group: 'فولادی', isin: 'IRO1FKAS0001', exchange: 'IRTSENO' },
  { name: 'فولاد امیرکبیر کاشان', symbol: 'فجر', group: 'فولادی', isin: 'IRO1FAJR0001', exchange: 'IRTSENO' },
  { name: 'فولاد کاوه جنوب کیش', symbol: 'کاوه', group: 'فولادی', isin: 'IRO1KVEH0001', exchange: 'IRTSENO' },
  { name: 'ذوب آهن اصفهان', symbol: 'ذوب', group: 'فولادی', isin: 'IRO1ZOBI0001', exchange: 'IRTSENO' },
  { name: 'جهان فولاد سیرجان', symbol: 'فجهان', group: 'فولادی', isin: 'IRO3SJSZ0001', exchange: 'IRIFBNO' },
  { name: 'فولاد سیرجان ایرانیان', symbol: 'سیسکو', group: 'فولادی', isin: 'IRO1SSCO0001', exchange: 'IRTSENO' },
  { name: 'ملی صنایع مس ایران', symbol: 'فملی', group: 'مس', isin: 'IRO1MSMI0001', exchange: 'IRTSENO' },
  { name: 'کارخانجات تولیدی شهید قندی', symbol: 'بکام', group: 'کابل', isin: 'IRO1KGND0001', exchange: 'IRTSENO' },
]

export const MINERAL_SYMBOL_BY_NAME = Object.fromEntries(
  MINERAL_STOCK_SYMBOLS.map((r) => [r.name, r.symbol]),
)

export const MINERAL_SYMBOLS = MINERAL_STOCK_SYMBOLS.map((r) => r.symbol)
