import { RUC_PATTERN, splitRuc } from '../features/invoicing/invoicing-format'

/**
 * Consulta pública de contribuyentes en **Tu RUC** (`https://turuc.com.py`).
 *
 * La API no requiere autenticación y devuelve los datos que la DNIT publica:
 *
 * ```json
 * {
 *   "data": {
 *     "doc": 3870633,
 *     "razonSocial": "CABALLERO MERCADO, HECTOR FABIAN",
 *     "dv": 4,
 *     "ruc": "3870633-4",
 *     "estado": "ACTIVO",
 *     "esPersonaJuridica": false,
 *     "esEntidadPublica": false
 *   },
 *   "message": "OK"
 * }
 * ```
 *
 * Detalles que condicionan este archivo:
 * - Hay dos rutas equivalentes y se prueban en orden:
 *   `GET /api/contribuyente?ruc=3870633-4` y `GET /api/contribuyente/3870633-4`.
 * - Un RUC inexistente responde **400** (no 404) con `{ message }`, así que
 *   ambos códigos se tratan como «no encontrado».
 * - Si el navegador bloquea la consulta por CORS o no hay internet, `fetch`
 *   lanza `TypeError`: se traduce a un mensaje accionable y el formulario sigue
 *   funcionando con la carga manual del nombre.
 * - En personas físicas el DV es el último dígito (`3870633-4`); la respuesta
 *   trae el número canónico con guion y se usa ese.
 */

/** URL base de la API; se puede apuntar a un proxy propio con `VITE_TURUC_API_URL`. */
const DEFAULT_API_BASE = 'https://turuc.com.py/api'

/** Sitio público que se ofrece como alternativa cuando la API no es accesible. */
const PUBLIC_SITE_URL = 'https://turuc.com.py'

/** Tope de espera: la consulta no debe congelar el formulario. */
const REQUEST_TIMEOUT_MS = 12_000

const UNREACHABLE_MESSAGE =
  'No se pudo consultar Tu RUC desde el navegador (sin internet o bloqueo CORS). Verificá el RUC en turuc.com.py y escribí el nombre a mano.'

/** Datos normalizados del contribuyente consultado. */
export type RucLookupResult = {
  /** RUC canónico con guion, tal como figura en la DNIT (`3870633-4`). */
  ruc: string
  base: string
  dv: string
  /** Razón social (persona jurídica) o nombre completo (persona física). */
  name: string
  /** `ACTIVO`, `SUSPENDIDO`, `CANCELADO`, `BLOQUEADO`, … */
  status: string
  isCompany: boolean
  isPublicEntity: boolean
}

export type RucLookupErrorCode =
  /** El texto escrito no tiene forma de RUC paraguayo. */
  | 'invalid'
  /** La DNIT no devolvió datos para ese RUC. */
  | 'not_found'
  /** Red caída o consulta bloqueada por CORS. */
  | 'unreachable'
  | 'timeout'
  /** Respondió algo inesperado (HTML, JSON sin datos, 5xx). */
  | 'server'

/** Error con un mensaje listo para mostrar en el formulario. */
export class RucLookupError extends Error {
  readonly code: RucLookupErrorCode

  constructor(message: string, code: RucLookupErrorCode) {
    super(message)
    this.name = 'RucLookupError'
    this.code = code
  }
}

/** URL base configurada (sin barras finales). */
export function getRucLookupApiBase(): string {
  const configured = (import.meta.env.VITE_TURUC_API_URL ?? '').trim()

  return (configured || DEFAULT_API_BASE).replace(/\/+$/, '')
}

/** Enlace público para verificar el RUC a mano cuando la API falla. */
export function getRucLookupSiteUrl(ruc: string): string {
  const trimmed = ruc.trim()

  return trimmed ? `${PUBLIC_SITE_URL}/?q=${encodeURIComponent(trimmed)}` : PUBLIC_SITE_URL
}

/** `true` solo para contribuyentes habilitados. */
export function isRucActivo(result: Pick<RucLookupResult, 'status'>): boolean {
  return result.status === 'ACTIVO'
}


function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '')
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)

  return ''
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return /^(true|1|si|sí)$/i.test(value.trim())

  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  return value as Record<string, unknown>
}

/**
 * RUC listo para consultar: acepta `3870633-4`, `38706334` o `80012345-6`.
 *
 * Devuelve `null` si el texto no puede interpretarse (base de menos de 5
 * dígitos o más de 8).
 */
export function normalizeRucLookup(
  value: string,
): { formatted: string; base: string; dv: string; digits: string } | null {
  const trimmed = value.trim()

  if (!trimmed) return null

  if (RUC_PATTERN.test(trimmed)) {
    const { base, dv } = splitRuc(trimmed)

    return { formatted: `${base}-${dv}`, base, dv, digits: `${base}${dv}` }
  }

  const digits = onlyDigits(trimmed)

  if (digits.length < 6 || digits.length > 9) return null

  const base = digits.slice(0, -1)
  const dv = digits.slice(-1)

  return { formatted: `${base}-${dv}`, base, dv, digits }
}

/** La API envuelve los datos en `data`; se toleran otras claves por si cambia. */
function readDataRecord(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload)

  if (!root) return null

  for (const key of ['data', 'contribuyente', 'result']) {
    const nested = root[key]

    if (Array.isArray(nested)) {
      const first = asRecord(nested[0])

      if (first) return first
    }

    const record = asRecord(nested)

    if (record) return record
  }

  return root
}

function pickText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = toText(record[key])

    if (value) return value
  }

  return ''
}

function pickBoolean(record: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    if (key in record) return toBoolean(record[key])
  }

  return false
}

/** Mensaje de la API (`{ message }`) para los casos de error. */
function readMessage(payload: unknown): string {
  const root = asRecord(payload)

  if (!root) return ''

  return pickText(root, ['message', 'error', 'detail', 'mensaje'])
}

async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text().catch(() => '')

  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Traduce el JSON de Tu RUC al resultado normalizado. */
export function parseRucLookupPayload(
  payload: unknown,
  fallback: { base: string; dv: string },
): RucLookupResult | null {
  const record = readDataRecord(payload)

  if (!record) return null

  const name = pickText(record, [
    'razonSocial',
    'razon_social',
    'nombre',
    'denominacion',
    'contribuyente',
    'name',
  ])

  if (!name) return null

  const rucText = pickText(record, ['ruc', 'rucCompleto', 'ruc_completo'])
  const docText = onlyDigits(pickText(record, ['doc', 'documento', 'rucBase', 'ruc_base']))
  const dvText = onlyDigits(
    pickText(record, ['dv', 'digitoVerificador', 'digito_verificador', 'dvRuc']),
  ).slice(-1)

  const rucDigits = onlyDigits(rucText)

  let base = ''
  let dv = ''

  if (rucDigits.length >= 6) {
    base = rucDigits.slice(0, -1)
    dv = rucDigits.slice(-1)
  } else if (docText) {
    base = docText
    dv = dvText || fallback.dv
  } else {
    base = fallback.base
    dv = dvText || fallback.dv
  }

  return {
    ruc: `${base}-${dv}`,
    base,
    dv,
    name,
    status: pickText(record, [
      'estado',
      'estadoContribuyente',
      'estado_contribuyente',
      'situacion',
      'state',
    ]).toUpperCase(),
    isCompany: pickBoolean(record, ['esPersonaJuridica', 'es_persona_juridica']),
    isPublicEntity: pickBoolean(record, ['esEntidadPublica', 'es_entidad_publica']),
  }
}

/**
 * Consulta un RUC en Tu RUC y devuelve razón social, estado y número canónico.
 *
 * Lanza `RucLookupError` (con `code` y mensaje para la interfaz) si el RUC no
 * tiene formato válido, no existe en la DNIT o la API no es accesible.
 */
export async function lookupRucParaguay(
  ruc: string,
  { timeoutMs = REQUEST_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<RucLookupResult> {
  const target = normalizeRucLookup(ruc)

  if (!target) {
    throw new RucLookupError(
      'Escribí el RUC con base y dígito verificador: 3870633-4 u 80012345-6.',
      'invalid',
    )
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new RucLookupError(
      'Sin conexión a internet: no se pudo consultar el RUC. Volvé a intentar cuando estés en línea.',
      'unreachable',
    )
  }

  const apiBase = getRucLookupApiBase()
  const encoded = encodeURIComponent(target.formatted)
  const endpoints = [
    `${apiBase}/contribuyente?ruc=${encoded}`,
    `${apiBase}/contribuyente/${encoded}`,
  ]

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let notFound = false
  let notFoundMessage = ''
  let serverFailure = false

  try {
    for (const url of endpoints) {
      let response: Response

      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
      } catch {
        if (controller.signal.aborted) {
          throw new RucLookupError(
            'Tu RUC tardó demasiado en responder. Probá de nuevo en unos segundos.',
            'timeout',
          )
        }

        // `fetch` no distingue CORS, DNS o servidor caído.
        throw new RucLookupError(UNREACHABLE_MESSAGE, 'unreachable')
      }

      if (response.status === 400 || response.status === 404) {
        // Tu RUC responde 400 (no 404) cuando el RUC no existe en la DNIT.
        notFoundMessage = readMessage(await readJson(response)) || notFoundMessage
        notFound = true
        continue
      }

      if (!response.ok) {
        serverFailure = true
        continue
      }

      const parsed = parseRucLookupPayload(await readJson(response), target)

      if (!parsed) {
        throw new RucLookupError(
          'Tu RUC respondió con un formato inesperado. Escribí el nombre a mano o verificá el RUC en turuc.com.py.',
          'server',
        )
      }

      return parsed
    }
  } finally {
    clearTimeout(timeout)
  }

  if (notFound) {
    const detail =
      notFoundMessage && !/^ok$/i.test(notFoundMessage) ? ` (${notFoundMessage})` : ''

    throw new RucLookupError(
      `La DNIT no devolvió datos para el RUC ${target.formatted}${detail}. Revisá el número o cargá el nombre a mano.`,
      'not_found',
    )
  }

  throw new RucLookupError(
    serverFailure
      ? 'Tu RUC no pudo completar la consulta. Probá de nuevo en unos segundos o cargá el nombre a mano.'
      : UNREACHABLE_MESSAGE,
    serverFailure ? 'server' : 'unreachable',
  )
}

