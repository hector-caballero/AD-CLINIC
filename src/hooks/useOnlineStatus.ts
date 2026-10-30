import { useEffect, useState } from 'react'

/**
 * Estado de conexión del navegador (base del indicador PWA).
 * Se actualiza con los eventos `online` / `offline` y al volver a la pestaña.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const syncStatus = () => setIsOnline(navigator.onLine)

    // Algunos navegadores no emiten el evento hasta que la pestaña vuelve al foco.
    syncStatus()

    window.addEventListener('online', syncStatus)
    window.addEventListener('offline', syncStatus)
    document.addEventListener('visibilitychange', syncStatus)

    return () => {
      window.removeEventListener('online', syncStatus)
      window.removeEventListener('offline', syncStatus)
      document.removeEventListener('visibilitychange', syncStatus)
    }
  }, [])

  return isOnline
}
