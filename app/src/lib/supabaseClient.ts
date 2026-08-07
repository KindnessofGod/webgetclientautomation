import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local and fill them in.')
}

// Row shapes are asserted via the interfaces in ./database.types at each
// call site rather than threaded through as a generic — the hand-written
// Database type isn't a full match for supabase-js's Insert/Update
// inference, and codegen isn't worth it for a 7-table schema.
export const supabase = createClient(url, anonKey)
