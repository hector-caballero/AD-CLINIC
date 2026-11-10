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
  /**
   * Dictado asistido de la anamnesis (Google Gemini Flash).
   *
   * `VITE_GEMINI_API_KEY` es la clave de Google AI Studio; sin ella el
   * formulario de historia clínica funciona igual, pero el botón «Dictar con
   * IA» avisa que falta configurarla. `VITE_GEMINI_MODEL` es opcional: permite
   * fijar un modelo concreto (`gemini-2.5-flash`, `gemini-1.5-flash`, …) en
   * lugar del alias `gemini-flash-latest`.
   */
  readonly VITE_GEMINI_API_KEY?: string
  readonly VITE_GEMINI_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
