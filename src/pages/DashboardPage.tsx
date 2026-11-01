import { useState } from 'react'
import { CalendarDays, TrendingUp, Users, Wallet } from 'lucide-react'
import { useAuth } from '../features/auth/AuthContext'
import { formatLongDate, getGreeting } from '../lib/format'

const METRICS = [
  {
    label: 'Pacientes activos',
    hint: 'Tabla patients',
    value: '—',
    icon: Users,
  },
  {
    label: 'Citas de hoy',
    hint: 'Tabla appointments',
    value: '—',
    icon: CalendarDays,
  },
  {
    label: 'Tratamientos en curso',
    hint: 'Tabla patient_treatments',
    value: '—',
    icon: TrendingUp,
  },
  {
    label: 'Saldo pendiente',
    hint: 'Vista patient_balances',
    value: '—',
    icon: Wallet,
  },
]

export default function DashboardPage() {
  const { user } = useAuth()
  // Fecha fijada al montar: `new Date()` no debe ejecutarse en cada render.
  const [today] = useState(() => new Date())

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-slate-500">{formatLongDate(today)}</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          {getGreeting(today)}
          {user?.email ? `, ${user.email.split('@')[0]}` : ''}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Este es el punto de partida de la clínica: los indicadores se conectarán a Supabase en la
          siguiente fase.
        </p>
      </section>

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {METRICS.map((metric) => {
          const Icon = metric.icon

          return (
            <article
              key={metric.label}
              className="rounded-2xl border border-slate-200/80 bg-white/85 p-5 shadow-card backdrop-blur-md"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-slate-500">{metric.label}</p>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon className="size-4.5" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                {metric.value}
              </p>
              <p className="mt-1 text-xs text-slate-400">{metric.hint}</p>
            </article>
          )
        })}
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white/85 p-6 shadow-card backdrop-blur-md">
        <h3 className="text-base font-semibold tracking-tight text-slate-900">Próximos pasos</h3>
        <ol className="mt-3 space-y-2 text-sm text-slate-600">
          <li>1. Alta y búsqueda de pacientes.</li>
          <li>2. Agenda de citas con control de solapamientos.</li>
          <li>3. Registro de tratamientos por pieza dental.</li>
          <li>4. Cobros, pagos y saldos por paciente.</li>
        </ol>
      </section>
    </div>
  )
}
