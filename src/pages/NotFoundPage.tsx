import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-slate-200/80 bg-white/85 px-6 py-14 text-center shadow-card backdrop-blur-md">
      <p className="text-5xl font-semibold tracking-tight text-brand-700">404</p>
      <h2 className="mt-3 text-lg font-semibold tracking-tight text-slate-900">
        No encontramos esta página
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        Puede que el enlace esté mal escrito o que la sección todavía no exista.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Volver al dashboard
      </Link>
    </section>
  )
}
