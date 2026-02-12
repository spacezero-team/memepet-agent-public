import { createClient } from '@supabase/supabase-js'

let supabaseInstance: ReturnType<typeof createClient<any>> | null = null

/**
 * Get or create a singleton Supabase client instance
 * Uses connection pooling to prevent file descriptor leaks in serverless environments
 */
export function getServiceSupabase() {
  if (supabaseInstance) {
    return supabaseInstance
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!url || !key) {
    if (
      process.env.NODE_ENV === 'production' &&
      typeof window === 'undefined' &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL
    ) {
      return {} as ReturnType<typeof createClient<any>>
    }
    throw new Error('Supabase configuration missing')
  }

  const client = createClient<any>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: 'public',
    },
  })

  supabaseInstance = client
  return client
}
