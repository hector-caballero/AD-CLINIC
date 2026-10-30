import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `autoUpdate`: al publicar una versión nueva, el service worker se activa
      // y recarga las pestañas abiertas para servir siempre el bundle más reciente.
      registerType: 'autoUpdate',
      // Registra el service worker con un <script defer> generado por el plugin.
      injectRegister: 'script-defer',
      // Assets de `public/` precacheados por `workbox.globPatterns`; los iconos del
      // manifest también entran por ese glob, así que evitamos duplicados.
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'AD Clinic',
        short_name: 'AD Clinic',
        description:
          'Gestión de pacientes, citas e historiales clínicos de la clínica dental AD Clinic.',
        lang: 'es',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'portrait',
        theme_color: '#0c4a6e',
        background_color: '#f8fafc',
        categories: ['medical', 'health', 'productivity'],
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Nueva cita',
            short_name: 'Cita',
            url: '/citas/nueva',
            description: 'Agendar una cita para un paciente',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Pacientes',
            short_name: 'Pacientes',
            url: '/pacientes',
            description: 'Buscar y consultar la ficha de un paciente',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        // Precarga del app shell: JS, CSS, HTML e imágenes estáticas.
        globPatterns: ['**/*.{js,css,html,ico,svg,png,webp,woff,woff2}'],
        // Soporte offline para la SPA: cualquier navegación cae en el index.html cacheado.
        navigateFallback: '/index.html',
        // Rutas que nunca deben resolverse contra el app shell (callbacks de auth, API).
        navigateFallbackDenylist: [/^\/auth\//, /^\/api\//],
        cleanupOutdatedCaches: true,
        // Assets pesados (p. ej. imágenes de fondo) superan el límite por defecto (2 MiB).
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Solo buckets públicos (logos, avatares). Los documentos clínicos deben
            // vivir en buckets privados y NO se cachean para proteger datos de pacientes.
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ad-clinic-supabase-storage',
              expiration: {
                maxEntries: 150,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 días
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Ponlo en `true` solo si necesitas probar el offline con `npm run dev`
        // (el service worker de desarrollo ensucia la caché entre cambios).
        enabled: false,
      },
    }),
  ],
})
