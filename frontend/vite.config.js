import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      '7248c77ec595d227-202-136-87-59.serveusercontent.com',
      '.serveusercontent.com'
    ]
  }
})
