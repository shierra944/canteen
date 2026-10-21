import { createClient, type PostgrestError } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

// The anon key is public by design; every privilege is enforced by RLS and
// SECURITY DEFINER functions in the database.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Turn Postgres / PostgREST errors into messages school staff can act on. */
export function friendlyError(error: unknown): string {
  if (!error) return 'Something went wrong.';
  const e = error as Partial<PostgrestError> & { message?: string; status?: number };
  const msg = e.message ?? String(error);
  if (e.code === '42501' || /permission denied/i.test(msg)) {
    return /permission denied for/i.test(msg)
      ? 'You do not have permission to perform this action.'
      : msg.replace(/\s*\([a-z_.]+\)\.?$/, '.');
  }
  if (e.code === '23505') {
    return /already/i.test(msg) ? msg : 'This record already exists (duplicate entry).';
  }
  if (e.code === '23514') return 'One of the values is not allowed (for example a negative amount or quantity).';
  if (e.code === '22P02') return 'One of the values has an invalid format.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Cannot reach the server. Check your internet connection and try again.';
  if (/JWT expired|invalid JWT/i.test(msg)) return 'Your session has expired. Please sign in again.';
  return msg;
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw new Error(friendlyError(res.error));
  return res.data as T;
}
