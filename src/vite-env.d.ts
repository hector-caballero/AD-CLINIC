/// <reference types="vite/client" />

interface ViteTypeOptions {
  // `import.meta.env` estricto: solo las variables declaradas aquí son accesibles.
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /**
   * Evolution API (WhatsApp de la clínica). Son opcionales: si faltan, la
   * agenda sigue funcionando y el envío automático de recordatorios avisa que
   * hay que configurarlas.
   *
   * Ejemplo: `http://mi-servidor:8080`, la `apikey` global y el nombre de la
   * instancia conectada (`ad-clinic`).
   */
  readonly VITE_EVOLUTION_API_URL?: string
  readonly VITE_EVOLUTION_API_KEY?: string
  readonly VITE_EVOLUTION_INSTANCE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
