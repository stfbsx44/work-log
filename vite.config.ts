import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { isProjectUrl, isPublicKey } from './src/publicConfig'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const url = env.VITE_SUPABASE_URL?.trim(), key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  // Fail before any VITE_ values can be embedded in the public JavaScript bundle.
  if ((url || key) && (!isProjectUrl(url) || !isPublicKey(key))) {
    throw new Error('Use a valid Supabase HTTPS URL and PUBLIC publishable/anon key. Never use secret or service_role keys.')
  }
  return { plugins: [react()], base: env.VITE_BASE_PATH || '/' }
})
