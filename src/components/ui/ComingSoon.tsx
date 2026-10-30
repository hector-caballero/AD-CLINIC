import { CircleCheck, Sparkles } from 'lucide-react'

type ComingSoonProps = {
  title: string
  description: string
  bullets?: string[]
}

/** Marcador de posición para los módulos que se construirán en las próximas fases. */
export function ComingSoon({ title, description, bullets = [] }: ComingSoonProps) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <Sparkles className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-500">{description}</p>

      {bullets.length > 0 && (
        <ul className="mx-auto mt-6 grid max-w-2xl gap-2 text-left text-sm text-slate-600 sm:grid-cols-2">
          {bullets.map((bullet) => (
            <li
              key={bullet}
              className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
            >
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
        Módulo en preparación
      </p>
    </section>
  )
}
