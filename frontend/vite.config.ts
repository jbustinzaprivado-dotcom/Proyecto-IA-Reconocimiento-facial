import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // A build for a server that does not know where the API is would publish a page that can never
  // reach it, and nothing would say why: it stops here instead. Development and the tests are not
  // affected (`npm run build` is the only one that runs in production mode)
  if (mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    if (!env.VITE_API_URL) {
      throw new Error(
        'Falta VITE_API_URL: la dirección del backend (por ejemplo https://mi-api.onrender.com). ' +
          'Defínela como variable de entorno antes de compilar.',
      )
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/setupTests.ts'],
    },
  }
})
