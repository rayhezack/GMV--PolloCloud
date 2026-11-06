/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCAL_DATA_WINDOW?: { startDate: string; endDate: string } | null;
  readonly VITE_DATA_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
