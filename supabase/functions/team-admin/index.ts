// =============================================================================
// AD Clinic · Edge Function `team-admin`
// -----------------------------------------------------------------------------
// Única forma segura de gestionar usuarios de Supabase Auth desde la app:
// `auth.signUp()` en el navegador reemplazaría la sesión del administrador,
// por eso el alta la hace el servidor con la service_role key.
//
// Verifica que quien llama sea un admin con perfil activo y luego ejecuta:
//   { action: 'create', fullName, email, password, role }
//   { action: 'update', memberId, fullName, role, isActive }
//   { action: 'reset-password', memberId, password }
//
// Deploy:
//   supabase functions deploy team-admin
// (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las inyecta
//  Supabase automáticamente; no hace falta configurarlas a mano.)
// =============================================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const STAFF_ROLES = ['admin', 'dentist', 'receptionist'] as const
type StaffRole = (typeof STAFF_ROLES)[number]

const MEMBER_SELECT = 'id, full_name, email, role, is_active, created_at, updated_at'
const MIN_PASSWORD_LENGTH = 8
/** 100 años: equivale a "suspendido hasta que un admin lo reactive". */
const SUSPENDED_BAN_DURATION = '876000h'

type Payload = {
  action?: unknown
  memberId?: unknown
  fullName?: unknown
  email?: unknown
  password?: unknown
  role?: unknown
  isActive?: unknown
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function fail(message: string, status = 400): Response {
  return json({ error: message }, status)
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRole(value: unknown): StaffRole | null {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value)
    ? (value as StaffRole)
    : null
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function translateAuthError(message?: string): string {
  const detail = (message ?? '').toLowerCase()

  if (detail.includes('already been registered') || detail.includes('already registered') || detail.includes('email_exists')) {
    return 'Ya existe una cuenta con ese correo electrónico.'
  }
  if (detail.includes('password')) {
    return `La contraseña no cumple los requisitos mínimos (${MIN_PASSWORD_LENGTH} caracteres).`
  }
  if (detail.includes('invalid email') || detail.includes('unable to validate email')) {
    return 'El correo electrónico no es válido.'
  }

  return message?.trim() ? `Supabase Auth rechazó la operación: ${message}` : 'Supabase Auth rechazó la operación.'
}

function translateProfileError(message?: string): string {
  if (!message) return 'No se pudo guardar el perfil del usuario.'
  if (message.includes('al menos un administrador')) return message
  return `No se pudo guardar el perfil del usuario: ${message}`
}


Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return fail('Método no permitido.', 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return fail('La función team-admin no tiene configuradas sus credenciales de Supabase.', 500)
  }

  const accessToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) {
    return fail('No encontramos tu sesión. Volvé a iniciar sesión.', 401)
  }

  // 1. ¿Quién llama?
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken)
  if (userError || !userData.user) {
    return fail('Tu sesión venció. Volvé a iniciar sesión.', 401)
  }

  // 2. ¿Es un administrador activo? (service_role salta RLS)
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: caller, error: callerError } = await adminClient
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (callerError) {
    return fail(`No se pudo verificar tu perfil: ${callerError.message}`, 500)
  }
  if (!caller || !caller.is_active) {
    return fail('Tu cuenta no tiene un perfil activo en el consultorio.', 403)
  }
  if (caller.role !== 'admin') {
    return fail('Solo un usuario con rol de administración puede gestionar el equipo.', 403)
  }

  // 3. Acción solicitada
  let payload: Payload
  try {
    payload = (await req.json()) as Payload
  } catch {
    return fail('El cuerpo de la solicitud no es válido.', 400)
  }

  switch (payload.action) {
    case 'create':
      return await handleCreate(adminClient, payload)
    case 'update':
      return await handleUpdate(adminClient, caller.id as string, payload)
    case 'reset-password':
      return await handleResetPassword(adminClient, payload)
    default:
      return fail('Acción no soportada.', 400)
  }
})


// -----------------------------------------------------------------------------
// Alta de usuario: crea la cuenta en Auth y su perfil en `profiles`.
// El trigger on_auth_user_created ya inserta el perfil; el upsert asegura que
// nombre y rol coincidan con lo pedido y evita perfiles incompletos.
// -----------------------------------------------------------------------------
async function handleCreate(adminClient: SupabaseClient, payload: Payload): Promise<Response> {
  const fullName = normalizeText(payload.fullName)
  const email = normalizeText(payload.email).toLowerCase()
  const password = typeof payload.password === 'string' ? payload.password : ''
  const role = normalizeRole(payload.role)

  if (fullName.length < 3) {
    return fail('Ingresá el nombre y apellido del usuario (mínimo 3 caracteres).')
  }
  if (!isEmail(email)) {
    return fail('El correo electrónico no es válido.')
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  }
  if (!role) {
    return fail('Elegí un rol válido: admin, dentist o receptionist.')
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
    app_metadata: { staff_role: role },
  })

  if (createError || !created?.user) {
    return fail(translateAuthError(createError?.message), 400)
  }

  const { data: member, error: profileError } = await adminClient
    .from('profiles')
    .upsert({ id: created.user.id, full_name: fullName, email, role, is_active: true }, { onConflict: 'id' })
    .select(MEMBER_SELECT)
    .single()

  if (profileError || !member) {
    // Revertimos la cuenta de Auth para no dejar usuarios huérfanos.
    await adminClient.auth.admin.deleteUser(created.user.id)
    return fail(
      `Se creó la cuenta pero no su perfil (${profileError?.message ?? 'error desconocido'}). Se revirtió el alta.`,
      500,
    )
  }

  return json({ member }, 201)
}


// -----------------------------------------------------------------------------
// Edición: nombre, rol y estado de acceso.
// -----------------------------------------------------------------------------
async function handleUpdate(
  adminClient: SupabaseClient,
  callerId: string,
  payload: Payload,
): Promise<Response> {
  const memberId = normalizeText(payload.memberId)
  const fullName = normalizeText(payload.fullName)
  const role = payload.role === undefined ? undefined : normalizeRole(payload.role)
  const isActive = typeof payload.isActive === 'boolean' ? payload.isActive : undefined

  if (!isUuid(memberId)) {
    return fail('Falta el identificador del usuario a editar.')
  }
  if (fullName.length < 3) {
    return fail('El nombre debe tener al menos 3 caracteres.')
  }
  if (role === null) {
    return fail('El rol elegido no es válido.')
  }
  if (payload.isActive !== undefined && isActive === undefined) {
    return fail('El estado de acceso no es válido.')
  }

  if (memberId === callerId) {
    if (role !== undefined && role !== 'admin') {
      return fail('No podés quitarte tu propio rol de administración. Pedile a otro admin que lo haga.')
    }
    if (isActive === false) {
      return fail('No podés suspender tu propia cuenta.')
    }
  }

  const { data: current, error: currentError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('id', memberId)
    .maybeSingle()

  if (currentError) {
    return fail(`No se pudo leer el perfil: ${currentError.message}`, 500)
  }
  if (!current) {
    return fail('Ese usuario ya no forma parte del equipo.', 404)
  }

  const patch: Record<string, unknown> = { full_name: fullName }
  if (role) patch.role = role
  if (isActive !== undefined) patch.is_active = isActive

  const { data: member, error: updateError } = await adminClient
    .from('profiles')
    .update(patch)
    .eq('id', memberId)
    .select(MEMBER_SELECT)
    .single()

  if (updateError || !member) {
    return fail(translateProfileError(updateError?.message))
  }

  // Sincronizamos metadatos de Auth y bloqueamos/desbloqueamos el login.
  const authPatch: Record<string, unknown> = {
    user_metadata: { full_name: member.full_name, role: member.role },
  }
  if (isActive === false) authPatch.ban_duration = SUSPENDED_BAN_DURATION
  if (isActive === true) authPatch.ban_duration = 'none'

  const { error: authError } = await adminClient.auth.admin.updateUserById(memberId, authPatch)

  return json({
    member,
    warning: authError
      ? `El perfil se guardó, pero el acceso en Supabase Auth no se pudo sincronizar: ${authError.message}`
      : undefined,
  })
}


// -----------------------------------------------------------------------------
// Contraseña: el admin define una nueva y se la comparte al usuario.
// -----------------------------------------------------------------------------
async function handleResetPassword(adminClient: SupabaseClient, payload: Payload): Promise<Response> {
  const memberId = normalizeText(payload.memberId)
  const password = typeof payload.password === 'string' ? payload.password : ''

  if (!isUuid(memberId)) {
    return fail('Falta el identificador del usuario.')
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  }

  const { error } = await adminClient.auth.admin.updateUserById(memberId, { password })

  if (error) {
    return fail(translateAuthError(error.message))
  }

  return json({ ok: true })
}

