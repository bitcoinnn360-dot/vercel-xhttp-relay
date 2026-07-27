const fa = new Intl.NumberFormat('fa-IR')
const faDec = new Intl.NumberFormat('fa-IR', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

export function fmtInt(n: number): string {
  return fa.format(Math.round(n))
}

export function fmtNum(n: number, digits = 2): string {
  return new Intl.NumberFormat('fa-IR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: n % 1 === 0 ? 0 : Math.min(digits, 2),
  }).format(n)
}

export function fmtCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${faDec.format(n / 1_000_000_000)} میلیارد`
  if (abs >= 1_000_000) return `${faDec.format(n / 1_000_000)} میلیون`
  if (abs >= 1_000) return `${faDec.format(n / 1_000)} هزار`
  return faDec.format(n)
}

export function fmtPct(n: number, digits = 2): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${faDec.format(Number(n.toFixed(digits)))}٪`
}

export function fmtChange(n: number): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${fa.format(Math.round(n))}`
}

export function changeClass(n: number): string {
  if (n > 0) return 'pos'
  if (n < 0) return 'neg'
  return 'flat'
}

export function timeFa(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Live Jalali calendar date in Asia/Tehran as YYYY/MM/DD (Latin digits). */
export function jalaliTodayTehran(): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
    return `${String(parts.year).padStart(4, '0')}/${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}`
  } catch {
    return ''
  }
}
