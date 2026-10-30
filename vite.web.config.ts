// Aperçu navigateur de l'interface, branché sur une API simulée (src/renderer/src/lib/mockApi.ts).
// Sert au développement de l'UI et aux captures automatisées, pas à l'usage réel.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  plugins: [react()],
  server: { port: 5199, strictPort: true }
})
