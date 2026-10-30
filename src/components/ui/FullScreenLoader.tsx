import { LoaderCircle } from 'lucide-react'

type FullScreenLoaderProps = {
  label?: string
}

/** Pantalla de espera a página completa (arranque, sesión, carga de datos). */
export function FullScreenLoader({ label = 'Cargando…' }: FullScreenLoaderProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
      <LoaderCircle className="size-8 animate-spin text-brand-600" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-500" role="status">
        {label}
      </p>
    </div>
  )
}
