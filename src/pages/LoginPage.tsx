import { useState, type FormEvent } from 'react'
import { CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle, Lock, Mail, WifiOff } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Brand } from '../components/layout/Brand'
import { ConnectionStatus } from '../components/layout/ConnectionStatus'
import { FullScreenLoader } from '../components/ui/FullScreenLoader'
import { useAuth } from '../features/auth/AuthContext'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

const HIGHLIGHTS = [
  'Historiales clínicos siempre a mano',
  'Agenda de citas sin solapamientos',
  'Cobros y saldos en tiempo real',
  'Funciona sin conexión en el móvil',
]

const INPUT_CLASSES =
  'block w-full rounded-xl border border-slate-300 bg-white py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

/**
 * Solo aceptamos rutas internas como destino tras el login: evita que un
 * `state.from` manipulado convierta el formulario en un open redirect.
 */
function resolveRedirectTarget(state: unknown): string {
  const candidate = (state as { from?: unknown } | null)?.from

  if (typeof candidate === 'string' && candidate.startsWith('/') && !candidate.startsWith('//')) {
    return candidate
  }

  return '/'
}

export default function LoginPage() {
  const { signIn, isAuthenticated, isLoading, isSigningIn } = useAuth()
  const isOnline = useOnlineStatus()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const redirectTo = resolveRedirectTarget(location.state)

  // Evita el parpadeo del formulario mientras se resuelve la sesión guardada.
  if (isLoading) return <FullScreenLoader label="Comprobando tu sesión…" />

  // Ya hay sesión (o se acaba de iniciar): fuera del login.
  if (isAuthenticated) return <Navigate to={redirectTo} replace />

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!email.trim() || !password) {
      setError('Introduce tu correo y tu contraseña.')
      return
    }

    const { error: signInError } = await signIn(email, password)

    if (signInError) {
      setError(signInError)
      return
    }

    navigate(redirectTo, { replace: true })
  }

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-2">
      {/* Panel de marca (solo escritorio) */}
      <aside className="relative hidden overflow-hidden bg-linear-to-br from-brand-700 via-brand-800 to-brand-950 p-12 lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-brand-400/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-16 -bottom-32 size-96 rounded-full bg-brand-300/10 blur-3xl"
        />

        <Brand inverted className="relative" />

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Toda la clínica, en un solo lugar.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-brand-100/80">
            Pacientes, citas, tratamientos y caja sincronizados con Supabase, incluso cuando la
            conexión falla.
          </p>
          <ul className="mt-8 space-y-3">
            {HIGHLIGHTS.map((highlight) => (
              <li key={highlight} className="flex items-start gap-2.5 text-sm text-brand-50">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden="true" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-200/70">
          AD Clinic · Sistema de gestión odontológica
        </p>
      </aside>

      {/* Formulario */}
      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <Brand className="mb-8 lg:hidden" />

          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Iniciar sesión</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Accede con las credenciales que te entregó la administración de la clínica.
          </p>

          {!isOnline && (
            <div
              role="status"
              className="mt-5 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
            >
              <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>Sin conexión. Necesitas internet para iniciar sesión.</p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          )}

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                Correo electrónico
              </label>
              <div className="relative mt-1.5">
                <Mail
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  spellCheck={false}
                  required
                  disabled={isSigningIn}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="recepcion@adclinic.com"
                  aria-invalid={error ? true : undefined}
                  className={`${INPUT_CLASSES} pr-3 pl-10`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Contraseña
              </label>
              <div className="relative mt-1.5">
                <Lock
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  disabled={isSigningIn}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  aria-invalid={error ? true : undefined}
                  className={`${INPUT_CLASSES} pr-11 pl-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((previous) => !previous)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center rounded-r-xl px-3 text-slate-400 transition-colors hover:text-slate-700"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSigningIn}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:bg-brand-900 disabled:cursor-not-allowed disabled:bg-brand-700/70"
            >
              {isSigningIn ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  Entrando…
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-slate-400">
            Las cuentas de acceso las crea la administración de la clínica. Si no puedes entrar,
            contacta con soporte.
          </p>

          <div className="mt-8 flex justify-center border-t border-slate-200 pt-5">
            <ConnectionStatus />
          </div>
        </div>
      </main>
    </div>
  )
}
