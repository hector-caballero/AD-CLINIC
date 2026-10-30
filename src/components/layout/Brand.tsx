type BrandProps = {
  className?: string
  /** `true` para fondos de marca oscuros (texto claro). */
  inverted?: boolean
}

/** Logotipo + nombre de la clínica, reutilizado en login y en la navegación. */
export function Brand({ className = '', inverted = false }: BrandProps) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <img
        src="/icons/icon.svg"
        alt=""
        width={40}
        height={40}
        className="size-10 shrink-0 rounded-2xl shadow-sm ring-1 ring-black/5"
      />
      <div className="min-w-0">
        <p
          className={`truncate text-sm font-semibold tracking-tight ${
            inverted ? 'text-white' : 'text-slate-900'
          }`}
        >
          AD Clinic
        </p>
        <p className={`truncate text-xs ${inverted ? 'text-brand-100/80' : 'text-slate-500'}`}>
          Gestión odontológica
        </p>
      </div>
    </div>
  )
}
