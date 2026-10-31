# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

---

## AD Clinic — configuración del proyecto

Stack: **Vite 8 + React 19 + TypeScript**, **Tailwind CSS 4** (plugin `@tailwindcss/vite`),
**@supabase/supabase-js**, **lucide-react** y **vite-plugin-pwa** (Workbox) para la PWA offline.

### 1. Variables de entorno

```bash
# Windows (PowerShell)
Copy-Item .env.example .env
```

| Variable | Descripción |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL del proyecto Supabase (`https://<ref>.supabase.co`). |
| `VITE_SUPABASE_ANON_KEY` | Clave pública `anon` / `publishable`. **Nunca** la `service_role`. |

Los archivos `.env*` están en `.gitignore`; solo se versiona `.env.example`.

### 2. Cliente de Supabase

`src/lib/supabase.ts` exporta el cliente ya configurado (sesión persistente + PKCE) y
valida al arrancar que las variables existan, que la URL sea http(s) y que la clave no sea
`service_role`:

```ts
import { supabase } from './lib/supabase'

const { data, error } = await supabase.from('patients').select('*')
```

Los tipos de `import.meta.env` viven en `src/vite-env.d.ts` (modo estricto: solo se
permiten las variables declaradas allí).

### 3. Tailwind CSS

`src/index.css` importa `tailwindcss` y define los tokens de marca en `@theme`:
`bg-brand-600`, `text-brand-900`, `border-brand-200`, etc. No requiere `tailwind.config.js`.

### 4. PWA (offline)

`vite.config.ts` genera el manifest de **AD Clinic** y un service worker con Workbox que:

- precachea el app shell (`js`, `css`, `html`, imágenes y fuentes);
- sirve `index.html` como fallback de navegación (SPA offline), excepto `/auth/*` y `/api/*`;
- cachea con `CacheFirst` solo los objetos **públicos** de Supabase Storage. Los datos
  clínicos (REST/Auth) no se cachean a propósito para no persistir información de pacientes.

Para probarlo: `npm run build && npm run preview`, y en DevTools → *Application* →
*Service Workers* / *Manifest*. Se puede simular el modo offline con la casilla *Offline*.

Los iconos están en `public/icons` y se pueden regenerar con:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-icons.ps1
```

### 5. Base de datos (SQL)

Las migraciones viven en `supabase/migrations` y se aplican **en orden**:

| Migración | Contenido |
| --- | --- |
| `20261028090000_init_ad_clinic_schema.sql` | Esquema completo: `patients`, `treatments`, `appointments`, `patient_treatments` y `transactions`, índices, triggers de `updated_at`, vista `patient_balances` y políticas RLS. |
| `20261028110000_cash_indexes_and_currency.sql` | Índices de caja y moneda (`PYG`). |
| `20261031100000_team_profiles_and_roles.sql` | Equipo: enum `staff_role`, tabla `profiles`, helpers `current_staff_role()` / `is_admin()`, triggers (perfil al crear usuario en Auth, sincronización de email, protección del último admin) y RLS por rol. |
| `20261031110000_treatments_catalog_pyg.sql` | Precios de referencia del catálogo en guaraníes (solo pisa los importes placeholder en USD) + índices de búsqueda. |

Se aplican de cualquiera de estas dos formas:

1. Supabase Dashboard → **SQL Editor** → pegar cada archivo completo → *Run* (en orden).
2. Supabase CLI: `supabase db push` (con el proyecto enlazado).

> **RLS de `profiles`:** cada persona ve su propio perfil y administración ve a todo el
> equipo; las escrituras directas a `profiles` quedan restringidas a `admin`. El resto de
> las tablas clínicas sigue con `for all to authenticated` (el rol `anon` no tiene acceso).
>
> **Bootstrap:** al aplicar la migración de equipo, el usuario **más antiguo** de
> `auth.users` queda como `admin` y el resto como `receptionist`, así nadie se queda sin
> administración. Para promover a otra persona:
>
> ```sql
> update public.profiles set role = 'admin' where email = 'persona@clinica.com';
> ```
>
> La base rechaza (`23514`) cualquier cambio que deje al consultorio **sin un
> administrador activo**; la UI muestra el mismo aviso antes de intentarlo.

### 6. Edge Function `team-admin`

Crear usuarios de Auth desde el cliente no es viable: `supabase.auth.signUp()` reemplaza la
sesión del administrador que está en pantalla. Por eso todas las escrituras del módulo de
equipo pasan por una función que usa la `service_role` del proyecto:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase functions deploy team-admin
```

Acciones soportadas (`action` en el body JSON):

| Acción | Body | Efecto |
| --- | --- | --- |
| `create` | `fullName`, `email`, `password`, `role` | Crea el usuario en Auth con `email_confirm: true`, guarda `full_name`/`role` en los metadatos (el trigger crea el perfil) y devuelve el perfil. |
| `update` | `memberId`, `fullName`, `role`, `isActive` | Actualiza `profiles` y sincroniza el acceso en Auth (`ban_duration` en lugar de borrar). Devuelve `warning` si el perfil se guardó pero Auth no quedó sincronizado. |
| `reset-password` | `memberId`, `password` | Define la contraseña nueva; apto para entregar en persona o por un canal seguro. |

La función valida que quien llama sea **admin activo** (con el JWT del request) y que nunca se
quede el consultorio sin administración. Los secretos `SUPABASE_URL`,
`SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase; no se versiona nada.

### 7. Autenticación, roles y navegación

Rutas con **react-router-dom** (`BrowserRouter`) y sesión con **Supabase Auth**. El rol del
personal se lee de `public.profiles`, no de Auth:

| Rol | Alcance |
| --- | --- |
| `admin` | Gestiona equipo (`/equipo`), catálogo de tratamientos y caja. |
| `dentist` | Atiende las citas y registra los tratamientos realizados. |
| `receptionist` | Agenda citas, registra pacientes y carga cobros. |

```
src/
├─ features/auth/
│  ├─ AuthContext.ts          contexto + hook useAuth() + tipos del perfil
│  ├─ AuthProvider.tsx        sesión (getSession + onAuthStateChange) y perfil
│  ├─ auth-profile-service.ts lectura de public.profiles
│  ├─ auth-errors.ts          errores de Auth traducidos al español
│  ├─ RequireAuth.tsx         guard de rutas privadas
│  └─ RequireAdmin.tsx        guard de rutas solo para administración
├─ features/treatments/       catálogo: servicio, hook, toolbar, tabla, modal
├─ features/team/             equipo: servicio, hook, toolbar, tabla y modales
├─ components/
│  ├─ layout/AppLayout.tsx       sidebar fija (lg+) + drawer móvil + header
│  ├─ layout/ConnectionStatus.tsx indicador PWA en línea / sin conexión
│  ├─ layout/Brand.tsx           logotipo reutilizado en login y nav
│  ├─ layout/nav-items.ts        definición de las secciones del menú
│  └─ ui/                        Modal, FullScreenLoader, ComingSoon
├─ hooks/useOnlineStatus.ts      eventos online/offline del navegador
└─ pages/                        LoginPage + una página por sección
```

| Ruta | Pantalla | Acceso |
| --- | --- | --- |
| `/login` | Inicio de sesión | Pública |
| `/` | Dashboard | Privada |
| `/pacientes` | Pacientes / fichas clínicas | Privada |
| `/citas` | Agenda de citas | Privada |
| `/tratamientos` | Catálogo de tratamientos (precios en PYG) | Privada |
| `/caja` | Caja y finanzas | Privada |
| `/equipo` | Equipo y roles | Solo `admin` |

`useAuth()` es la única puerta al estado de sesión:

```tsx
import { useAuth } from './features/auth/AuthContext'

const {
  user,
  session,
  profile, // { id, full_name, email, role, is_active } | null
  role, // 'admin' | 'dentist' | 'receptionist' | null
  isAdmin, // rol admin + perfil activo
  isLoading,
  isLoadingProfile,
  isSigningIn,
  isAuthenticated,
  signIn,
  signOut,
  refreshProfile,
} = useAuth()

const { error } = await signIn('recepcion@adclinic.com', 'contraseña') // error: null si fue bien
```

Comportamiento relevante:

- **Guard de rutas:** todo se monta dentro de `<RequireAuth>`; sin sesión se redirige a
  `/login` guardando la ruta original en `state.from` (solo se aceptan rutas internas).
- **Guard de administración:** `/equipo` se envuelve en `<RequireAdmin>`; mientras se carga el
  perfil se muestra un loader y, si el rol no es `admin`, una pantalla de *Acceso restringido*.
  El menú lateral se arma con `getNavItems(isAdmin)`, así que la sección solo aparece para
  quien puede usarla.
- **Usuarios:** no hay registro público. Las cuentas se crean desde `/equipo` (Edge Function
  `team-admin`) o desde Supabase → *Authentication* → *Users*; en ese último caso el trigger
  crea el perfil con rol `receptionist`, que luego se ajusta en `/equipo`.
- **Bajas:** los usuarios y los tratamientos **no se borran**, se desactivan
  (`is_active = false`): pierden el acceso o dejan de ofrecerse, pero se conserva el historial
  clínico y de caja. La base impide quedarse sin ningún administrador activo.
- **Sesión persistente:** `persistSession` + PKCE en `src/lib/supabase.ts`, así que la PWA
  reabre con la sesión iniciada; mientras se resuelve se muestra un loader para evitar el
  parpadeo hacia el login.
- **Logout offline:** si `signOut()` falla por falta de red se ejecuta `scope: 'local'`, de
  forma que un dispositivo compartido no queda con la sesión abierta.
- **Indicador PWA:** `ConnectionStatus` escucha los eventos `online`/`offline` y muestra
  *En línea* / *Sin conexión*; en el login avisa además de que hace falta red para entrar.

Para añadir una sección nueva: crear la página en `src/pages`, añadir la entrada en
`src/components/layout/nav-items.ts` (label + icono + descripción + `adminOnly` si aplica) y
registrar la `<Route>` en `src/App.tsx`.

