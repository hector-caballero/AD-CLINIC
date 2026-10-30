import { Wifi, WifiOff } from 'lucide-react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'

type ConnectionStatusProps = {
  className?: string
  /** Oculta el texto y deja solo el icono + tooltip (útil en headers estrechos). */
  iconOnly?: boolean
}

/**
 * Indicador de conexión de la PWA.
 *
 * Cuando no hay red, la app sigue abierta gracias al service worker: el
 * indicador avisa de que los datos mostrados pueden estar desactualizados y de
 * que las escrituras se reintentarán al recuperar la conexión.
 */
export function ConnectionStatus({ className = '', iconOnly = false }: ConnectionStatusProps) {
  const isOnline = useOnlineStatus()
  const Icon = isOnline ? Wifi : WifiOff
  const label = isOnline ? 'En línea' : 'Sin conexión'

  return (
    <span
      role="status"
      aria-live="polite"
      title={
        isOnline
          ? 'Conectado a Supabase'
          : 'Sin conexión: trabajando con la copia local de la app. Los cambios se guardarán al recuperar la red.'
      }
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        isOnline
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-amber-300 bg-amber-50 text-amber-800',
        iconOnly ? 'px-2' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className={iconOnly ? 'sr-only' : undefined}>{label}</span>
    </span>
  )
}
