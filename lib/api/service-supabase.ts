import { createClient } from '@supabase/supabase-js'

let supabaseInstance: ReturnType<typeof createClient<any>> | null = null

/**
 * Get or create a singleton Supabase client instance.
 * Checks both SUPABASE_URL (server-side preferred) and NEXT_PUBLIC_SUPABASE_URL as fallback.
 * Throws immediately if env vars are missing -- never returns a stub object.
 */
export function getServiceSupabase() {
  if (supabaseInstance) {
    return supabaseInstance
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    const missing = [
      ...(!url ? ['SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)'] : []),
      ...(!key ? ['SUPABASE_SERVICE_ROLE_KEY'] : []),
    ]
    throw new Error(
      `Supabase configuration missing: ${missing.join(', ')}. Set these environment variables before starting the server.`
    )
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
