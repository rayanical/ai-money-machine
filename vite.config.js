import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        financials: fileURLToPath(new URL('./index.html', import.meta.url)),
        deals: fileURLToPath(new URL('./deals/index.html', import.meta.url)),
      },
    },
  },
})
