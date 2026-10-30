import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
      <p className="text-5xl font-semibold tracking-tight text-brand-700">404</p>
      <h2 className="mt-3 text-lg font-semibold tracking-tight text-slate-900">
        No encontramos esta página
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        Puede que el enlace esté mal escrito o que la sección todavía no exista.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Volver al dashboard
      </Link>
    </section>
  )
}
