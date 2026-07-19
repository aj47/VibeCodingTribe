/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REALTIME_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
