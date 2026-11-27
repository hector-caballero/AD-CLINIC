import { formatPYG, formatPatientDocument, formatPhonePY, formatShortDate } from '../../lib/format'
import {
  combineDateAndTime,
  findPatientConflicts,
  formatAppointmentTime,
  todayKey,
} from '../appointments/appointment-dates'
import {
  canCallToRoom,
  getAppointmentPatientName,
  type AppointmentWithPatient,
} from '../appointments/appointment-types'
import {
  callAppointmentToRoom,
  createAppointment,
  fetchAppointments,
  fetchAppointmentsForDay,
  fetchPatientAppointments,
  markReminderSent,
} from '../appointments/appointments-service'
import { buildReminderUrl } from '../appointments/appointment-whatsapp'
import { addDays, startOfLocalDay, toDateKey } from '../cash/cash-dates'
import { computeCashMetrics } from '../cash/cash-metrics'
import {
  fetchCashOverview,
  fetchPatientAccount,
  fetchPatientTransactionLinks,
  type PatientTransactionLink,
} from '../cash/cash-service'
import { filterTreatmentOptions } from '../odontogram/odontogram-catalog'
import { buildPlanFinancials, type PlanFinancialSummary } from '../odontogram/odontogram-financials'
import { addOdontogramItem, fetchOdontogram } from '../odontogram/odontogram-service'
import { isTemporaryTooth, isValidTooth } from '../odontogram/odontogram-teeth'
import { ITEM_STATUS_META, getSurfaceLabel } from '../odontogram/odontogram-types'
import {
  describeVoiceCommand,
  findTreatmentMatch,
  toOdontogramDraft,
  type OdontogramVoiceCommand,
} from '../odontogram/odontogram-voice-service'
import {
  fetchInvoices,
  fetchPatientInvoices,
  fetchTransactionInvoicing,
  type TransactionInvoicing,
} from '../invoicing/invoicing-service'
import { fetchMedicalHistory } from '../patients/anamnesis-service'
import { getPatientFullName, type Patient } from '../patients/patient-types'
import { fetchPatients } from '../patients/patients-service'
import { fetchStaffDirectory } from '../team/staff-directory'
import { fetchTreatments } from '../treatments/treatments-service'
import { buildWaitingRoomSnapshot } from '../tv/tv-queue'
import type { WaitingRoomEntry, WaitingRoomSnapshot } from '../tv/tv-types'
import { lookupRucParaguay, isRucActivo } from '../../services/turuc-service'
import { sendAppointmentReminder } from '../../services/whatsapp'
import { notifyAssistantDataChange } from './assistant-events'
import type {
  AssistantIntent,
  AssistantNavigationTarget,
  AssistantReplyLink,
  AssistantReplyTone,
} from './assistant-types'

/**
 * Ejecución de las intenciones del copiloto clínico.
 *
 * El parser (local o Gemini) devuelve una `AssistantIntent`; este módulo es el
 * único lugar que toca la base. Reglas:
 * - El paciente se resuelve por nombre/cédula con búsqueda difusa, o se usa el
 *   paciente activo (ficha u odontograma abierto).
 * - Los procedimientos se resuelven contra `public.treatments` al ejecutar: el
 *   modelo nunca inventa un `treatment_id` ni un precio.
 * - Cada escritura avisa con `notifyAssistantDataChange` para que la pantalla
 *   abierta refresque sus datos sin recargar la página.
 */

export type AssistantRoomState = {
  appointments: AppointmentWithPatient[]
  snapshot: WaitingRoomSnapshot
}

export type AssistantActionContext = {
  /** Paciente en consulta (ficha u odontograma abierto). */
  activePatient: Patient | null
  /** Fecha local `YYYY-MM-DD`. */
  today: string
  /** El rol puede escribir en el odontograma (`admin` o `dentist`). */
  canEditOdontogram: boolean
  /** Odontólogo logueado: queda como responsable de la cita de control. */
  dentistId: string | null
  /** Sala ya cargada por el proveedor (evita una consulta extra). */
  room: AssistantRoomState | null
}

export type AssistantActionResult = {
  tone: AssistantReplyTone
  text: string
  /** Paciente que queda activo (`null` = no cambia). */
  patient: Patient | null
  /** Ruta a abrir después de ejecutar (`null` = quedarse donde está). */
  navigateTo: string | null
  /** Enlace externo (recordatorio de WhatsApp). */
  link: AssistantReplyLink | null
  /** Paso de la guía que esta acción completa. */
  guidedStep: 'call' | 'open' | 'alerts' | 'odontogram' | 'finish' | 'collect' | 'invoice' | null
}

function result(
  tone: AssistantReplyTone,
  text: string,
  extra: Partial<Omit<AssistantActionResult, 'tone' | 'text'>> = {},
): AssistantActionResult {
  return {
    tone,
    text,
    patient: null,
    navigateTo: null,
    link: null,
    guidedStep: null,
    ...extra,
  }
}

/** Texto comparable: sin tildes, sin signos y en minúsculas. */
function normalizeTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

type ScoredPatient = { patient: Patient; score: number }

/**
 * Ranking simple de pacientes para el comando dictado.
 *
 * 100 = documento o nombre completo exacto · 80 = el nombre contiene la frase ·
 * 60+ = coinciden todas las palabras (en cualquier orden) · 50 = teléfono.
 */
function rankPatients(patients: Patient[], query: string): ScoredPatient[] {
  const term = normalizeTerm(query)
  const digits = query.replace(/\D/g, '')

  if (!term && digits.length < 4) return []

  const tokens = term.split(' ').filter(Boolean)

  return patients
    .map((patient) => {
      const name = normalizeTerm(
        [getPatientFullName(patient), patient.legal_name ?? ''].join(' '),
      )
      const document = (patient.document_number ?? '').replace(/\D/g, '')
      const phone = patient.phone.replace(/\D/g, '')

      if (digits.length >= 4 && document === digits) return { patient, score: 100 }
      if (term && name === term) return { patient, score: 100 }
      if (term && name.includes(term)) return { patient, score: 80 }

      if (tokens.length > 0) {
        const hits = tokens.filter((token) => name.includes(token)).length

        if (hits === tokens.length) return { patient, score: 60 + Math.min(hits, 10) }
        if (hits > 0) return { patient, score: Math.round((40 * hits) / tokens.length) }
      }

      if (digits.length >= 6 && phone.includes(digits)) return { patient, score: 50 }

      return { patient, score: 0 }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
}

export type PatientResolution = {
  patient: Patient | null
  message: string | null
}

/**
 * Paciente indicado por el doctor o, si no dijo ninguno, el paciente activo.
 * Cuando hay dos coincidencias empatadas no se adivina: se pide el apellido.
 */
export async function resolveAssistantPatient(
  query: string | null,
  activePatient: Patient | null,
): Promise<PatientResolution> {
  if (!query) {
    return activePatient
      ? { patient: activePatient, message: null }
      : {
          patient: null,
          message:
            'Primero abrí la ficha o el odontograma del paciente, o decime su nombre para buscarlo.',
        }
  }

  const { patients } = await fetchPatients()
  const matches = rankPatients(patients, query).slice(0, 4)
  const [best] = matches

  if (!best) {
    return {
      patient: null,
      message: `No encontré a nadie con «${query}». Probá con el nombre completo, la cédula o el RUC.`,
    }
  }

  const tied = matches.filter((entry) => entry.score === best.score)

  if (tied.length > 1 && best.score < 100) {
    return {
      patient: null,
      message: `Hay varios pacientes que coinciden con «${query}»: ${tied
        .map((entry) => getPatientFullName(entry.patient))
        .join(', ')}. Decime el apellido completo.`,
    }
  }

  return { patient: best.patient, message: null }
}

/** Paciente por id (la cita solo trae un resumen del paciente embebido). */
export async function findAssistantPatientById(patientId: string): Promise<Patient | null> {
  const { patients } = await fetchPatients()

  return patients.find((patient) => patient.id === patientId) ?? null
}

/** Citas del día + estado de la sala (lo que ve la tele). */
export async function fetchAssistantRoom(today: string = todayKey()): Promise<AssistantRoomState> {
  const appointments = await fetchAppointmentsForDay(today)

  return { appointments, snapshot: buildWaitingRoomSnapshot(appointments) }
}

/** Índice `transaction_invoicing` de los cobros confirmados del paciente. */
async function fetchInvoicingIndex(
  transactions: PatientTransactionLink[],
): Promise<Map<string, TransactionInvoicing>> {
  const paymentIds = transactions
    .filter((row) => row.type === 'payment' && row.status === 'paid')
    .map((row) => row.id)

  if (paymentIds.length === 0) return new Map()

  const rows = await fetchTransactionInvoicing(paymentIds)

  return new Map(rows.map((row) => [row.transaction_id, row]))
}

/** Resumen del plan del paciente: presupuesto, cobrado, facturado y saldo. */
export async function fetchPatientPlanSummary(patientId: string): Promise<PlanFinancialSummary> {
  const [permanent, temporary, invoices, transactions] = await Promise.all([
    fetchOdontogram(patientId, 'permanent'),
    fetchOdontogram(patientId, 'temporary'),
    fetchPatientInvoices(patientId),
    fetchPatientTransactionLinks(patientId),
  ])

  return buildPlanFinancials({
    items: [...permanent.items, ...temporary.items],
    invoices,
    transactions,
    invoicing: await fetchInvoicingIndex(transactions),
  })
}

/** Busca en la sala (o en las citas del día) a quién hay que llamar. */
function findCallableEntry(
  room: AssistantRoomState,
  query: string | null,
): WaitingRoomEntry | null {
  if (!query) return room.snapshot.waiting[0] ?? null

  const term = normalizeTerm(query)
  const tokens = term.split(' ').filter(Boolean)
  const matchesName = (value: string) => {
    const name = normalizeTerm(value)

    return (
      name.includes(term) || (tokens.length > 0 && tokens.every((token) => name.includes(token)))
    )
  }

  const inRoom = [room.snapshot.current, ...room.snapshot.waiting].filter(
    (entry): entry is WaitingRoomEntry => entry !== null,
  )
  const inRoomMatch = inRoom.find((entry) => matchesName(entry.patientName))

  if (inRoomMatch) return inRoomMatch

  const appointment = room.appointments.find(
    (item) => canCallToRoom(item.status) && matchesName(getAppointmentPatientName(item)),
  )

  if (!appointment) return null

  return {
    appointment,
    patientName: getAppointmentPatientName(appointment),
    phase: null,
    dentistName: null,
    room: appointment.room,
    minutesWaiting: 0,
    calledAtTime: null,
  }
}


// --- Ejecución por acción ------------------------------------------------------

async function executeCallNext(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const room = context.room ?? (await fetchAssistantRoom(context.today))
  const entry = findCallableEntry(room, intent.patientQuery)

  if (!entry) {
    if (intent.patientQuery) {
      return result(
        'warning',
        `No encontré a ${intent.patientQuery} en la sala ni en las citas de hoy. Revisá la agenda o marcá su llegada.`,
      )
    }

    if (room.snapshot.current) {
      return result(
        'info',
        `La última llamada fue para ${room.snapshot.current.patientName} y no hay nadie más esperando en la sala.`,
      )
    }

    return result(
      'warning',
      'No hay pacientes en la sala de espera. Marcá la llegada en la agenda y volvé a intentar.',
    )
  }

  const wasWaiting = entry.appointment.status === 'checked_in'
  const called = await callAppointmentToRoom(entry.appointment)
  const name = getAppointmentPatientName(called)
  const where = called.room ? ` (${called.room})` : ''
  const patient = await findAssistantPatientById(called.patient_id)

  notifyAssistantDataChange({ scope: 'appointments', patientId: called.patient_id })

  return result(
    'success',
    wasWaiting
      ? `Llamé a ${name} a la sala${where}. Ya aparece en la pantalla del turnero.`
      : `Marqué la llegada de ${name} y lo llamé a la sala${where}.`,
    { patient, guidedStep: 'call' },
  )
}

async function executeOpenPatient(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const target = intent.openTarget ?? 'patients'
  const base = target === 'odontogram' ? '/odontograma' : '/pacientes'
  const { patient, message } = await resolveAssistantPatient(
    intent.patientQuery,
    context.activePatient,
  )

  if (!patient) {
    return result('warning', message ?? 'No pude identificar al paciente.', { navigateTo: base })
  }

  const name = getPatientFullName(patient)
  const route = `${base}?paciente=${encodeURIComponent(patient.id)}`

  return result(
    'success',
    target === 'odontogram' ? `Abro el odontograma de ${name}.` : `Abro la ficha de ${name}.`,
    {
      patient,
      navigateTo: route,
      guidedStep: target === 'odontogram' ? 'open' : null,
    },
  )
}

async function executeReadAlerts(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const { patient, message } = await resolveAssistantPatient(
    intent.patientQuery,
    context.activePatient,
  )

  if (!patient) return result('warning', message ?? 'No pude identificar al paciente.')

  const history = await fetchMedicalHistory(patient.id)
  const name = getPatientFullName(patient)
  const alerts: string[] = []

  if (patient.allergies.length > 0) alerts.push(`Alergias: ${patient.allergies.join(', ')}.`)
  if (patient.medical_conditions.length > 0) {
    alerts.push(`Antecedentes: ${patient.medical_conditions.join(', ')}.`)
  }
  if (patient.current_medications.length > 0) {
    alerts.push(`Medicación: ${patient.current_medications.join(', ')}.`)
  }

  if (history) {
    if (history.allergic_anesthetics) alerts.push('Alergia a anestésicos.')
    if (history.allergic_penicillin) alerts.push('Alergia a penicilina.')
    if (history.allergic_others && history.allergic_details) {
      alerts.push(`Otras alergias: ${history.allergic_details}.`)
    }
    if (history.has_disease && history.disease_details) {
      alerts.push(`Enfermedad de base: ${history.disease_details}.`)
    }
    if (history.under_treatment && history.treatment_details) {
      alerts.push(`En tratamiento: ${history.treatment_details}.`)
    }
    if (history.has_pain && history.pain_details) alerts.push(`Dolor: ${history.pain_details}.`)
    if (history.has_dental_issues && history.dental_issues_details) {
      alerts.push(`Antecedente dental: ${history.dental_issues_details}.`)
    }
    if (history.is_pregnant) alerts.push('Embarazo declarado.')
    if (history.is_breastfeeding) alerts.push('Lactancia declarada.')
  }

  if (patient.medical_notes) alerts.push(`${patient.medical_notes}.`)

  if (alerts.length === 0) {
    return result(
      'success',
      history
        ? `${name} no tiene alertas médicas registradas.`
        : `${name} todavía no tiene historia clínica cargada: no hay alertas registradas.`,
      { patient, guidedStep: 'alerts' },
    )
  }

  return result('warning', `${name}: ${alerts.join(' ')}`, { patient, guidedStep: 'alerts' })
}

async function executeReadFinancial(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const { patient, message } = await resolveAssistantPatient(
    intent.patientQuery,
    context.activePatient,
  )

  if (!patient) return result('warning', message ?? 'No pude identificar al paciente.')

  const summary = await fetchPatientPlanSummary(patient.id)
  const name = getPatientFullName(patient)

  if (summary.planTotal <= 0 && summary.collectedAmount <= 0) {
    return result(
      'info',
      `${name} todavía no tiene procedimientos en el odontograma ni cobros registrados.`,
      { patient },
    )
  }

  const parts = [
    `Presupuesto ${formatPYG(summary.planTotal)}`,
    `cobrado ${formatPYG(summary.collectedAmount)}`,
    summary.remainingToCollect > 0
      ? `saldo por cobrar ${formatPYG(summary.remainingToCollect)}`
      : 'plan cobrado en su totalidad',
    summary.invoiceCount > 0
      ? `facturado ${formatPYG(summary.invoicedAmount)} en ${summary.invoiceCount} comprobante${
          summary.invoiceCount === 1 ? '' : 's'
        }`
      : 'sin facturas emitidas',
  ]

  return result('info', `${name}: ${parts.join(' · ')}.`, { patient })
}

async function executeCollectionOrInvoice(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const isInvoice = intent.disposition === 'invoice'
  const base = isInvoice ? '/facturacion' : '/caja'
  const { patient, message } = await resolveAssistantPatient(
    intent.patientQuery,
    context.activePatient,
  )

  if (!patient) {
    return result('warning', message ?? 'No pude identificar al paciente.', { navigateTo: base })
  }

  const name = getPatientFullName(patient)
  const route = `${base}?paciente=${encodeURIComponent(patient.id)}&${
    isInvoice ? 'emitir=1' : 'cobrar=1'
  }`

  return result(
    'success',
    isInvoice
      ? `Abro facturación con ${name} precargado. Revisá el importe y confirmá la emisión.`
      : `Abro caja con ${name} precargado. El cobro se confirma en el modal.`,
    {
      patient,
      navigateTo: route,
      guidedStep: isInvoice ? 'invoice' : 'collect',
    },
  )
}

async function executeScheduleFollowup(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const followup = intent.followup

  if (!followup) {
    return result('warning', 'Decime día y hora del control, por ejemplo «agendá control el viernes a las 10».')
  }

  const { patient, message } = await resolveAssistantPatient(
    intent.patientQuery,
    context.activePatient,
  )

  if (!patient) return result('warning', message ?? 'No pude identificar al paciente.')

  const name = getPatientFullName(patient)
  const startsAt = combineDateAndTime(followup.date, followup.time)

  if (!startsAt) {
    return result(
      'warning',
      `No pude interpretar el horario ${followup.date} ${followup.time}. Probá con «el viernes a las 10».`,
    )
  }

  const endsAt = new Date(startsAt.getTime() + followup.durationMinutes * 60_000)
  const dayAppointments =
    context.room && followup.date === context.today
      ? context.room.appointments
      : await fetchAppointmentsForDay(followup.date)

  const conflicts = findPatientConflicts(dayAppointments, {
    patient_id: patient.id,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  })

  if (conflicts.length > 0) {
    const first = conflicts[0]

    return result(
      'warning',
      `${name} ya tiene una cita el ${formatShortDate(first.starts_at)} a las ${formatAppointmentTime(
        first.starts_at,
      )}. Elegí otro horario para el control.`,
    )
  }

  const saved = await createAppointment({
    patient_id: patient.id,
    dentist_id: context.dentistId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason: followup.reason.trim() || 'Control',
    notes: null,
    room: null,
  })

  const whatsappUrl = followup.sendWhatsApp ? buildReminderUrl(saved) : null

  notifyAssistantDataChange({ scope: 'appointments', patientId: patient.id })

  return result(
    'success',
    `Agendé el control de ${name} para el ${formatShortDate(saved.starts_at)} a las ${formatAppointmentTime(
      saved.starts_at,
    )} (${followup.durationMinutes} min).`,
    {
      patient,
      link: whatsappUrl ? { url: whatsappUrl, label: 'Enviar recordatorio por WhatsApp' } : null,
      guidedStep: 'finish',
    },
  )
}


async function executeOdontogramAction(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const draft = intent.odontogram

  if (!draft) {
    return result('warning', 'No pude identificar la pieza del dictado. Probá «pieza 16 oclusal resina».')
  }

  if (!context.canEditOdontogram) {
    return result(
      'warning',
      'Tu rol es de solo lectura: el odontograma lo edita odontología o administración.',
    )
  }

  const dentition = isTemporaryTooth(draft.toothNumber) ? 'temporary' : 'permanent'

  if (!isValidTooth(draft.toothNumber, dentition)) {
    return result(
      'warning',
      `La pieza ${draft.toothNumber} no existe en la dentición ${
        dentition === 'temporary' ? 'temporal' : 'permanente'
      }.`,
    )
  }

  const { patient, message } = await resolveAssistantPatient(
    intent.patientQuery,
    context.activePatient,
  )

  if (!patient) return result('warning', message ?? 'No pude identificar al paciente.')

  const name = getPatientFullName(patient)
  const where = draft.surface
    ? `Pieza ${draft.toothNumber} (${getSurfaceLabel(draft.surface)})`
    : `Pieza ${draft.toothNumber}`
  let command: OdontogramVoiceCommand

  if (draft.status === 'absent') {
    command = {
      raw: intent.reply,
      toothNumber: draft.toothNumber,
      surface: null,
      status: 'absent',
      name: 'ausente',
      treatment: null,
      source: 'regex',
    }
  } else {
    const { treatments } = await fetchTreatments()
    const match = findTreatmentMatch(draft.procedure, filterTreatmentOptions(treatments, ''))

    if (!match.treatment) {
      const alternatives = match.alternatives.slice(0, 4).map((option) => option.name)

      return result(
        'warning',
        alternatives.length > 0
          ? `${where}: «${draft.procedure}» coincide con varios procedimientos (${alternatives.join(
              ', ',
            )}). Decime cuál de ellos.`
          : `${where}: no encontré «${draft.procedure}» en el catálogo de tratamientos. Decime el procedimiento como figura en Tratamientos (por ejemplo «resina»).`,
        { patient },
      )
    }

    if (match.treatment.default_price <= 0) {
      return result(
        'warning',
        `El procedimiento «${match.treatment.name}» no tiene precio en el catálogo. Cargalo en Tratamientos y volvé a dictar el hallazgo.`,
        { patient },
      )
    }

    command = {
      raw: intent.reply,
      toothNumber: draft.toothNumber,
      surface: draft.surface,
      status: draft.status,
      name: draft.procedure,
      treatment: match.treatment,
      source: 'regex',
    }
  }

  await addOdontogramItem({
    patientId: patient.id,
    dentition,
    ...toOdontogramDraft(command),
  })

  notifyAssistantDataChange({ scope: 'odontogram', patientId: patient.id })

  return result('success', `Guardé ${describeVoiceCommand(command)} en el plan de ${name}.`, {
    patient,
    navigateTo: `/odontograma?paciente=${encodeURIComponent(patient.id)}`,
    guidedStep: 'odontogram',
  })
}


// --- Consultas de solo lectura -------------------------------------------------

/** `YYYY-MM-DD` local de un instante ISO (las facturas se emiten en hora local). */
function toLocalDateKey(value: string): string {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '' : toDateKey(date)
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** Texto corto y legible en voz alta: «10:00 Ana Benítez». */
function describeAppointment(appointment: AppointmentWithPatient): string {
  return `${formatAppointmentTime(appointment.starts_at)} ${getAppointmentPatientName(appointment)}`
}

function assistantErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** Resumen del día: agenda, sala, caja y facturas de hoy. */
async function executeClinicSummary(
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const [room, overview, invoices] = await Promise.all([
    context.room ?? fetchAssistantRoom(context.today),
    fetchCashOverview(),
    fetchInvoices(),
  ])

  const metrics = computeCashMetrics(overview)
  const issuedToday = invoices.filter(
    (invoice) => invoice.status === 'issued' && toLocalDateKey(invoice.issued_at) === context.today,
  )
  const issuedTotal = issuedToday.reduce((total, invoice) => total + invoice.total, 0)
  const scheduled = room.appointments.filter(
    (appointment) => appointment.status !== 'cancelled' && appointment.status !== 'no_show',
  ).length
  const waiting = room.snapshot.waiting.length
  const next = room.snapshot.waiting[0]?.patientName ?? null

  const agenda = [
    `Hoy tenés ${formatCount(scheduled, 'cita', 'citas')}`,
    waiting > 0
      ? `${formatCount(waiting, 'paciente en sala', 'pacientes en sala')}${
          next ? `, siguiente ${next}` : ''
        }`
      : 'sala vacía',
  ]
  const money = [
    `cobrado ${formatPYG(metrics.collectedToday)} en ${formatCount(
      metrics.paymentsToday,
      'pago',
      'pagos',
    )}`,
    issuedToday.length > 0
      ? `${formatCount(issuedToday.length, 'factura emitida', 'facturas emitidas')} por ${formatPYG(
          issuedTotal,
        )}`
      : 'sin facturas emitidas',
  ]

  return result('info', `${agenda.join(', ')}. ${money.join(', ')}.`)
}

/** Agenda de un día (hoy por defecto), opcionalmente filtrada por profesional. */
async function executeQueryAppointments(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const date = intent.date ?? context.today
  const appointments =
    date === context.today && context.room
      ? context.room.appointments
      : await fetchAppointmentsForDay(date)

  const active = appointments.filter(
    (appointment) => appointment.status !== 'cancelled' && appointment.status !== 'no_show',
  )

  if (active.length === 0) {
    return result(
      'info',
      `No hay citas cargadas para el ${formatShortDate(date)}${
        intent.staffQuery ? ' con ese profesional' : ''
      }.`,
    )
  }

  let filtered = active

  if (intent.staffQuery) {
    const directory = await fetchStaffDirectory()
    const term = normalizeTerm(intent.staffQuery)
    const ids = new Set(
      directory
        .filter((member) => normalizeTerm(member.full_name).includes(term))
        .map((member) => member.id),
    )

    filtered = active.filter(
      (appointment) => appointment.dentist_id !== null && ids.has(appointment.dentist_id),
    )

    if (filtered.length === 0) {
      return result(
        'warning',
        `No encontré a ${intent.staffQuery} en el equipo o no tiene citas ese día.`,
      )
    }
  }

  const list = filtered.slice(0, 4).map(describeAppointment).join(', ')
  const more = filtered.length > 4 ? ` y ${filtered.length - 4} más` : ''
  const who = intent.staffQuery ? ` de ${intent.staffQuery}` : ''

  return result(
    'info',
    `Agenda${who} del ${formatShortDate(date)}: ${formatCount(
      filtered.length,
      'cita',
      'citas',
    )}. ${list}${more}.`,
  )
}


/** Teléfono, documento, saldo y último movimiento del paciente. */
async function executeQueryPatientInfo(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const { patient, message } = await resolveAssistantPatient(
    intent.patientQuery,
    context.activePatient,
  )

  if (!patient) return result('warning', message ?? 'No pude identificar al paciente.')

  const name = getPatientFullName(patient)
  const [account, visits] = await Promise.all([
    fetchPatientAccount(patient.id),
    fetchPatientAppointments(patient.id, 8).catch(() => []),
  ])
  const document = formatPatientDocument(patient.document_type, patient.document_number)
  const phone = patient.phone ? formatPhonePY(patient.phone) : 'sin teléfono'
  const balance = account.balance?.balance ?? 0
  const lastCompleted = visits.find((appointment) => appointment.status === 'completed') ?? null
  const lastMovement = account.movements[0]?.created_at ?? null
  const lastVisit = lastCompleted
    ? `última visita el ${formatShortDate(lastCompleted.starts_at)}`
    : lastMovement
      ? `último movimiento el ${formatShortDate(lastMovement)}`
      : 'sin visitas registradas'

  const parts = [
    name,
    document,
    phone,
    balance > 0 ? `saldo ${formatPYG(balance)}` : 'sin saldo pendiente',
    lastVisit,
  ]

  if (patient.legal_name && patient.legal_name.trim() !== name) {
    parts.push(`factura a ${patient.legal_name.trim()}`)
  }

  return result('info', `${parts.join(' · ')}.`, { patient })
}

/** Busca precio y duración en el catálogo de tratamientos. */
async function executeTreatmentCatalog(intent: AssistantIntent): Promise<AssistantActionResult> {
  const query = intent.treatmentQuery?.trim() ?? ''
  const { treatments } = await fetchTreatments()
  const matches = filterTreatmentOptions(treatments, query)

  if (matches.length === 0) {
    return result(
      'warning',
      query
        ? `No encontré «${query}» en el catálogo. Probá con el nombre del procedimiento o la categoría.`
        : 'Decime qué tratamiento querés consultar, por ejemplo «cuánto sale una endodoncia».',
    )
  }

  const list = matches
    .slice(0, 3)
    .map((option) => {
      const duration = option.default_duration_minutes
        ? ` en ${option.default_duration_minutes} minutos`
        : ''

      return `${option.name}: ${formatPYG(option.default_price)}${duration}`
    })
    .join('; ')
  const more = matches.length > 3 ? ` y ${matches.length - 3} más` : ''

  return result('info', `${list}${more}.`)
}

/** Cobros y saldos del día y del mes. */
async function executeCashSummary(): Promise<AssistantActionResult> {
  const overview = await fetchCashOverview()
  const metrics = computeCashMetrics(overview)

  const parts = [
    `Hoy cobraste ${formatPYG(metrics.collectedToday)} en ${formatCount(
      metrics.paymentsToday,
      'pago',
      'pagos',
    )}`,
    `este mes ${formatPYG(metrics.collectedMonth)}`,
    metrics.pendingTotal > 0
      ? `pendiente ${formatPYG(metrics.pendingTotal)} con ${formatCount(
          metrics.debtors,
          'paciente',
          'pacientes',
        )}`
      : 'sin saldos pendientes',
  ]

  return result('info', `${parts.join(' · ')}.`)
}

/** Facturas emitidas hoy y facturas con saldo pendiente. */
async function executeInvoicesSummary(
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const invoices = await fetchInvoices()
  const issued = invoices.filter((invoice) => invoice.status === 'issued')
  const todayInvoices = issued.filter(
    (invoice) => toLocalDateKey(invoice.issued_at) === context.today,
  )
  const pending = issued.filter((invoice) => invoice.payment_status !== 'paid')
  const pendingBalance = pending.reduce(
    (total, invoice) => total + Math.max(0, invoice.balance),
    0,
  )

  const parts = [
    todayInvoices.length > 0
      ? `hoy emitiste ${formatCount(todayInvoices.length, 'factura', 'facturas')} por ${formatPYG(
          todayInvoices.reduce((total, invoice) => total + invoice.total, 0),
        )}`
      : 'hoy no se emitió ninguna factura',
    pending.length > 0
      ? `${formatCount(pending.length, 'factura pendiente', 'facturas pendientes')} por ${formatPYG(
          pendingBalance,
        )}`
      : 'no hay facturas pendientes de cobro',
  ]

  return result('info', `${parts.join(' · ')}.`)
}

/** Personal activo del consultorio (vista pública del directorio). */
async function executeQueryTeam(): Promise<AssistantActionResult> {
  const directory = await fetchStaffDirectory()

  if (directory.length === 0) {
    return result('warning', 'No pude leer el directorio del equipo del consultorio.')
  }

  const dentists = directory
    .filter((member) => member.role === 'dentist')
    .map((member) => member.full_name)
  const admins = directory.filter((member) => member.role === 'admin').length
  const reception = directory.filter((member) => member.role === 'receptionist').length

  const parts = [
    formatCount(directory.length, 'persona activa', 'personas activas'),
    dentists.length > 0
      ? `odontología: ${dentists.slice(0, 3).join(', ')}${dentists.length > 3 ? '…' : ''}`
      : 'sin odontólogos cargados',
    `administración ${admins} y recepción ${reception}`,
  ]

  return result('info', `${parts.join(' · ')}.`)
}

/** Estados de cita que todavía se pueden recordar por WhatsApp. */
function isRemindableAppointment(appointment: AppointmentWithPatient): boolean {
  return (
    appointment.status === 'scheduled' ||
    appointment.status === 'confirmed' ||
    appointment.status === 'reschedule_requested' ||
    appointment.status === 'checked_in'
  )
}

/** Próxima cita del paciente dentro de los 7 días (incluye la de hoy). */
async function findUpcomingAppointment(
  patientId: string,
): Promise<AppointmentWithPatient | null> {
  const now = new Date()
  const from = startOfLocalDay(now)
  const to = addDays(from, 7)
  const appointments = await fetchAppointments(from.toISOString(), to.toISOString())
  const limit = now.getTime() - 60 * 60 * 1000

  return (
    appointments.find(
      (appointment) =>
        appointment.patient_id === patientId &&
        isRemindableAppointment(appointment) &&
        new Date(appointment.starts_at).getTime() >= limit,
    ) ?? null
  )
}

/** Envía por WhatsApp el recordatorio de la próxima cita del paciente. */
async function executeWhatsAppReminder(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  const { patient, message } = await resolveAssistantPatient(
    intent.patientQuery,
    context.activePatient,
  )

  if (!patient) return result('warning', message ?? 'No pude identificar al paciente.')

  const name = getPatientFullName(patient)
  const appointment = await findUpcomingAppointment(patient.id)

  if (!appointment) {
    return result(
      'warning',
      `${name} no tiene una cita próxima para recordar. Agendá una primero y volvé a intentar.`,
    )
  }

  try {
    const sent = await sendAppointmentReminder(appointment, appointment.patient)

    // La auditoría (`reminder_sent_at`) no bloquea el envío ya confirmado.
    void markReminderSent(appointment.id).catch(() => undefined)
    notifyAssistantDataChange({ scope: 'appointments', patientId: patient.id })

    return result(
      'success',
      `Envié el recordatorio de ${name} al ${sent.number} para el ${formatShortDate(
        appointment.starts_at,
      )} a las ${formatAppointmentTime(appointment.starts_at)}.`,
      { patient },
    )
  } catch (error) {
    return result('warning', assistantErrorMessage(error, 'No pude enviar el recordatorio.'))
  }
}

/** Consulta un RUC en Tu RUC (`turuc.com.py`). */
async function executeRucLookup(intent: AssistantIntent): Promise<AssistantActionResult> {
  if (!intent.ruc) {
    return result('warning', 'Decime el RUC completo con dígito verificador, por ejemplo 3870633-4.')
  }

  try {
    const data = await lookupRucParaguay(intent.ruc)
    const status = isRucActivo(data) ? 'activo' : `en estado ${data.status.toLowerCase()}`
    const kind = data.isCompany ? 'Persona jurídica' : 'Persona física'

    return result('info', `RUC ${data.ruc}: ${data.name}, ${status}. ${kind}.`)
  } catch (error) {
    return result('warning', assistantErrorMessage(error, 'No pude consultar el RUC en Tu RUC.'))
  }
}

/** Sección visible + ruta del menú para `navigate_to`. */
const NAVIGATION_ROUTES: Record<AssistantNavigationTarget, { path: string; label: string }> = {
  dashboard: { path: '/', label: 'el dashboard' },
  patients: { path: '/pacientes', label: 'Pacientes' },
  appointments: { path: '/citas', label: 'la agenda' },
  treatments: { path: '/tratamientos', label: 'el catálogo de tratamientos' },
  odontogram: { path: '/odontograma', label: 'el odontograma' },
  cash: { path: '/caja', label: 'Caja' },
  invoicing: { path: '/facturacion', label: 'Facturación' },
  team: { path: '/equipo', label: 'el equipo' },
  tv: { path: '/tv', label: 'la pantalla de sala' },
}

/** Navegación pura: abre una sección del menú sin tocar datos. */
function executeNavigation(intent: AssistantIntent): AssistantActionResult {
  const target = intent.navigationTarget

  if (!target) {
    return result(
      'warning',
      'Decime a qué sección querés ir: agenda, pacientes, caja, facturación, tratamientos, odontograma o equipo.',
    )
  }

  const route = NAVIGATION_ROUTES[target]

  return result('success', `Abro ${route.label}.`, { navigateTo: route.path })
}

// --- Tarjeta de confirmación ---------------------------------------------------

/**
 * Texto de la confirmación previa para las acciones que tocan datos sensibles.
 * Se describe el efecto real (quién se llama, qué pieza se guarda, qué cita se
 * crea) y no solo el nombre de la acción.
 */
export function describeAssistantConfirmation(
  intent: AssistantIntent,
  activePatient: Patient | null,
): { title: string; detail: string } {
  const patientName = activePatient ? getPatientFullName(activePatient) : null

  switch (intent.action) {
    case 'call_next_patient':
      return {
        title: 'Llamar a la sala',
        detail: intent.patientQuery
          ? `Se va a llamar a ${intent.patientQuery}. El aviso aparece en la pantalla /tv y la cita queda en sala.`
          : 'Se va a llamar al siguiente paciente en espera. El aviso aparece en la pantalla /tv.',
      }
    case 'odontogram_action': {
      const draft = intent.odontogram

      if (!draft) {
        return {
          title: 'Guardar en el plan',
          detail: 'Se va a guardar el hallazgo dictado en el odontograma del paciente.',
        }
      }

      const where = draft.surface
        ? `Pieza ${draft.toothNumber} (${getSurfaceLabel(draft.surface)})`
        : `Pieza ${draft.toothNumber}`
      const what =
        draft.status === 'absent'
          ? ITEM_STATUS_META.absent.label
          : `${draft.procedure} · ${ITEM_STATUS_META[draft.status].label}`

      return {
        title: 'Guardar en el plan',
        detail: `${where} → ${what}${
          patientName ? ` · ${patientName}` : ''
        }. Queda en el presupuesto del paciente.`,
      }
    }
    case 'schedule_followup': {
      const followup = intent.followup

      if (!followup) {
        return { title: 'Agendar control', detail: 'Se va a crear una cita de control.' }
      }

      return {
        title: 'Agendar control',
        detail: `${patientName ?? 'El paciente'} · ${formatShortDate(followup.date)} a las ${
          followup.time
        } (${followup.durationMinutes} min) · ${followup.reason}.`,
      }
    }
    case 'send_whatsapp_reminder':
      return {
        title: 'Enviar recordatorio por WhatsApp',
        detail: `${
          intent.patientQuery ?? patientName ?? 'El paciente'
        } recibirá el recordatorio de su próxima cita. El mensaje sale desde el WhatsApp de la clínica.`,
      }
    default:
      return { title: 'Confirmar acción', detail: intent.reply }
  }
}

// --- Entrada única -------------------------------------------------------------

export async function executeAssistantIntent(
  intent: AssistantIntent,
  context: AssistantActionContext,
): Promise<AssistantActionResult> {
  switch (intent.action) {
    case 'call_next_patient':
      return executeCallNext(intent, context)
    case 'open_patient':
      return executeOpenPatient(intent, context)
    case 'read_medical_alerts':
      return executeReadAlerts(intent, context)
    case 'odontogram_action':
      return executeOdontogramAction(intent, context)
    case 'read_financial_status':
      return executeReadFinancial(intent, context)
    case 'schedule_followup':
      return executeScheduleFollowup(intent, context)
    case 'prepare_collection_or_invoice':
      return executeCollectionOrInvoice(intent, context)
    case 'query_clinic_summary':
      return executeClinicSummary(context)
    case 'query_appointments':
      return executeQueryAppointments(intent, context)
    case 'query_patient_info':
      return executeQueryPatientInfo(intent, context)
    case 'query_treatment_catalog':
      return executeTreatmentCatalog(intent)
    case 'query_cash_summary':
      return executeCashSummary()
    case 'query_invoices_summary':
      return executeInvoicesSummary(context)
    case 'query_team':
      return executeQueryTeam()
    case 'send_whatsapp_reminder':
      return executeWhatsAppReminder(intent, context)
    case 'lookup_ruc_dnit':
      return executeRucLookup(intent)
    case 'navigate_to':
      return executeNavigation(intent)
    case 'guided_workflow':
      return result('info', intent.reply || 'Modo guía de consulta.')
    default:
      return result('info', intent.reply || 'No hay ninguna acción para ejecutar.')
  }
}
