import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { demoFetch } from './demo'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

const realSupabase =
  supabaseUrl && supabaseAnonKey
    ? createClient<Database>(supabaseUrl, supabaseAnonKey)
    : null

const demoSupabase = createClient<Database>('https://demo.local', 'demo-anon-key', {
  global: { fetch: demoFetch },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

export let supabase = realSupabase

export function setDemoSupabaseMode(enabled: boolean): void {
  supabase = enabled ? demoSupabase : realSupabase
}
