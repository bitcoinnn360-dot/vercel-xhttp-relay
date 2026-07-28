/** نام شرکت در گزارش روزانه → نماد تابلو */
export const MINERAL_STOCK_SYMBOLS: { name: string; symbol: string; group: string }[] = [
  { name: 'توسعه معادن و فلزات', symbol: 'ومعادن', group: 'سرمایه‌گذاری' },
  { name: 'تجلی توسعه معادن و فلزات', symbol: 'تجلی', group: 'سرمایه‌گذاری' },
  { name: 'گروه مدیریت سرمایه‌گذاری امید', symbol: 'وامید', group: 'سرمایه‌گذاری' },
  { name: 'سرمایه‌گذاری صدر تأمین', symbol: 'تاصیکو', group: 'سرمایه‌گذاری' },
  { name: 'هلدینگ صنایع معدنی خاورمیانه', symbol: 'میدکو', group: 'سرمایه‌گذاری' },
  { name: 'صنایع و معادن احیاء سپاهان', symbol: 'واحیا', group: 'سرمایه‌گذاری' },
  { name: 'بین‌المللی توسعه صنایع و معادن غدیر', symbol: 'وغدیر', group: 'سرمایه‌گذاری' },
  { name: 'گروه صنایع معادن فلات ایرانیان', symbol: 'فلات', group: 'سرمایه‌گذاری' },
  { name: 'معدنی و صنعتی گل‌گهر', symbol: 'کگل', group: 'سنگ‌آهن' },
  { name: 'معدنی و صنعتی چادرملو', symbol: 'کچاد', group: 'سنگ‌آهن' },
  { name: 'سنگ آهن گهرزمین', symbol: 'کگهر', group: 'سنگ‌آهن' },
  { name: 'توسعه معدنی و صنعتی صبانور', symbol: 'کنور', group: 'سنگ‌آهن' },
  { name: 'فرآوری معدنی اپال کانی پارس', symbol: 'اپال', group: 'سنگ‌آهن' },
  { name: 'فولاد مبارکه اصفهان', symbol: 'فولاد', group: 'فولادی' },
  { name: 'فولاد خوزستان', symbol: 'فخوز', group: 'فولادی' },
  { name: 'فولاد هرمزگان جنوب', symbol: 'هرمز', group: 'فولادی' },
  { name: 'آهن و فولاد ارفع', symbol: 'ارفع', group: 'فولادی' },
  { name: 'فولاد خراسان', symbol: 'فخاس', group: 'فولادی' },
  { name: 'فولاد امیرکبیر کاشان', symbol: 'فاما', group: 'فولادی' },
  { name: 'فولاد کاوه جنوب کیش', symbol: 'کاوه', group: 'فولادی' },
  { name: 'ذوب آهن اصفهان', symbol: 'ذوب', group: 'فولادی' },
  { name: 'جهان فولاد سیرجان', symbol: 'فجهان', group: 'فولادی' },
  { name: 'فولاد سیرجان ایرانیان', symbol: 'فسپا', group: 'فولادی' },
  { name: 'ملی صنایع مس ایران', symbol: 'فملی', group: 'مس' },
  { name: 'کارخانجات تولیدی شهید قندی', symbol: 'بکام', group: 'کابل' },
]

export const MINERAL_SYMBOL_BY_NAME = Object.fromEntries(
  MINERAL_STOCK_SYMBOLS.map((r) => [r.name, r.symbol]),
)

export const MINERAL_SYMBOLS = MINERAL_STOCK_SYMBOLS.map((r) => r.symbol)
