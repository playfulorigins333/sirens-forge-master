import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client
 * Uses SERVICE ROLE key — never expose to frontend
 */
export const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);
