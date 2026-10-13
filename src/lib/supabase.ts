import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Chave publicável (sb_publishable_…). Aceita também o nome antigo «anon».
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const isConfigured = Boolean(url && key);
export const environmentLabel = (import.meta.env.VITE_ENVIRONMENT_LABEL as string | undefined)?.trim() || '';

export const supabase: SupabaseClient = isConfigured
  ? createClient(url!, key!, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : (null as unknown as SupabaseClient);
