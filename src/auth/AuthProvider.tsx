import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  recovering: boolean; // sessão aberta por link de recuperação de palavra-passe
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, recovering: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true, recovering: false });

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState((s) => ({ ...s, session: data.session, loading: false }));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setState((s) => ({ session, loading: false, recovering: event === 'PASSWORD_RECOVERY' ? true : s.recovering && !!session }));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
