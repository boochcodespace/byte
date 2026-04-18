import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite is the build tool and dev server for the frontend.
// The proxy below forwards any /api/* request from the frontend
// to the Express backend at port 3001, so we never have to type
// the full backend URL in frontend code.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
