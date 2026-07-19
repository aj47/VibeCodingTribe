import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'docs-site',
  plugins: [react()],
  build: {
    outDir: '../dist-docs',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 4174,
  },
  preview: {
    host: '0.0.0.0',
    port: 4174,
  },
})
