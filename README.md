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

La migración `supabase/migrations/20261028090000_init_ad_clinic_schema.sql` crea el esquema
completo: `patients`, `treatments`, `appointments`, `patient_treatments` y `transactions`,
con índices, triggers de `updated_at`, la vista `patient_balances` y las políticas RLS.

Se aplica de cualquiera de estas dos formas:

1. Supabase Dashboard → **SQL Editor** → pegar el archivo completo → *Run*.
2. Supabase CLI: `supabase db push` (con el proyecto enlazado).

> **RLS:** cualquier usuario **autenticado** puede leer y escribir en todas las tablas
> (`for all to authenticated`); el rol `anon` no tiene acceso. Cuando existan roles
> (administración / odontología / recepción) hay que reemplazar esas políticas.

### 6. Autenticación y navegación

Rutas con **react-router-dom** (`BrowserRouter`) y sesión con **Supabase Auth**.

```
src/
├─ features/auth/
│  ├─ AuthContext.ts    contexto + hook useAuth()
│  ├─ AuthProvider.tsx  sesión (getSession + onAuthStateChange)
│  ├─ auth-errors.ts    errores de Auth traducidos al español
│  └─ RequireAuth.tsx   guard de rutas privadas
├─ components/
│  ├─ layout/AppLayout.tsx       sidebar fija (lg+) + drawer móvil + header
│  ├─ layout/ConnectionStatus.tsx indicador PWA en línea / sin conexión
│  ├─ layout/Brand.tsx           logotipo reutilizado en login y nav
│  ├─ layout/nav-items.ts        definición de las secciones del menú
│  └─ ui/                        FullScreenLoader, ComingSoon
├─ hooks/useOnlineStatus.ts      eventos online/offline del navegador
└─ pages/                        LoginPage + una página por sección
```

| Ruta | Pantalla | Acceso |
| --- | --- | --- |
| `/login` | Inicio de sesión | Pública |
| `/` | Dashboard | Privada |
| `/pacientes` | Pacientes / fichas clínicas | Privada |
| `/citas` | Agenda de citas | Privada |
| `/tratamientos` | Tratamientos | Privada |
| `/caja` | Caja y finanzas | Privada |

`useAuth()` es la única puerta al estado de sesión:

```tsx
import { useAuth } from './features/auth/AuthContext'

const { user, session, isLoading, isSigningIn, isAuthenticated, signIn, signOut } = useAuth()

const { error } = await signIn('recepcion@adclinic.com', 'contraseña') // error: null si fue bien
```

Comportamiento relevante:

- **Guard de rutas:** todo se monta dentro de `<RequireAuth>`; sin sesión se redirige a
  `/login` guardando la ruta original en `state.from` (solo se aceptan rutas internas).
- **Sin registro público:** las cuentas se crean desde Supabase → *Authentication* → *Users*.
- **Sesión persistente:** `persistSession` + PKCE en `src/lib/supabase.ts`, así que la PWA
  reabre con la sesión iniciada; mientras se resuelve se muestra un loader para evitar el
  parpadeo hacia el login.
- **Logout offline:** si `signOut()` falla por falta de red se ejecuta `scope: 'local'`, de
  forma que un dispositivo compartido no queda con la sesión abierta.
- **Indicador PWA:** `ConnectionStatus` escucha los eventos `online`/`offline` y muestra
  *En línea* / *Sin conexión*; en el login avisa además de que hace falta red para entrar.

Para añadir una sección nueva: crear la página en `src/pages`, añadir la entrada en
`src/components/layout/nav-items.ts` (label + icono + descripción) y registrar la `<Route>`
en `src/App.tsx`.

