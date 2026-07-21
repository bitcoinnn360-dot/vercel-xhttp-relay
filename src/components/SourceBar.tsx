import type { SourceStatus } from '../data/types'

const label: Record<SourceStatus['status'], string> = {
  live: 'زنده',
  seed: 'نمونه',
  blocked: 'نیاز به دسترسی',
  error: 'خطا',
}

const chipClass: Record<SourceStatus['status'], string> = {
  live: 'chip-live',
  seed: 'chip-seed',
  blocked: 'chip-blocked',
  error: 'chip-blocked',
}

export function SourceBar({ sources }: { sources: SourceStatus[] }) {
  return (
    <div className="panel px-4 py-3">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h2 className="section-title text-sm">وضعیت منابع داده</h2>
        <p className="section-sub m-0 text-[0.72rem]">
          بورس از TGJU · کلان از FRED · فولاد چین موقت از TGJU/FRED تا Custeel
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((s) => (
          <div key={s.id} className={`chip ${chipClass[s.status]}`} title={s.note}>
            <span className="font-bold">{s.name}</span>
            <span className="opacity-80">{label[s.status]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
