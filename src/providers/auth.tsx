import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyError, supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  permissions: string[];
  loading: boolean;
  /** UI convenience only — the database re-checks every permission. */
  can: (permission: string) => boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setPermissions([]);
      return;
    }
    const [{ data: p }, { data: perms }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.rpc('my_permissions'),
    ]);
    setProfile((p as Profile) ?? null);
    setPermissions((perms as string[]) ?? []);
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (mounted) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // defer: Supabase recommends not awaiting inside the callback
        setTimeout(() => {
          void loadProfile(s);
          if (event === 'SIGNED_OUT') qc.clear();
        }, 0);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, qc]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      permissions,
      loading,
      isAdmin: profile?.role === 'admin' && profile.is_active,
      can: (p) => permissions.includes(p),
      async signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          throw new Error(/invalid login/i.test(error.message) ? 'Incorrect email or password.' : friendlyError(error));
        }
        await loadProfile(data.session);
      },
      async signOut() {
        await supabase.auth.signOut();
        qc.clear();
      },
      refreshProfile: () => loadProfile(session),
    }),
    [session, profile, permissions, loading, loadProfile, qc],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
