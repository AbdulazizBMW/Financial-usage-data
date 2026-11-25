import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type User } from '../lib/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  baseCurrency: string;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, baseCurrency: string) => Promise<string>;
  signOut: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function baseCurrencyOf(user: User | null): string {
  return user?.baseCurrency ?? user?.base_currency ?? 'UZS';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: current } = await api.me();
      setUser(current);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        console.error('session check failed', error);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: current } = await api.login(email, password);
    setUser(current);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string, baseCurrency: string) => {
    const { user: current, recoveryCode } = await api.register(name, email, password, baseCurrency);
    setUser(current);
    return recoveryCode;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, baseCurrency: baseCurrencyOf(user), refresh, signIn, signUp, signOut, setUser }),
    [user, loading, refresh, signIn, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
