/// <reference types="vite/client" />

interface ViteTypeOptions {
  // `import.meta.env` estricto: solo las variables declaradas aquí son accesibles.
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
