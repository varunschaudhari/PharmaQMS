import type { AccessTokenPayload, AuthenticatedUser } from '@pharmaqms/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { decodeJwt } from '../../../lib/jwt';
import { clearTokens, getAccessToken, setTokens } from '../../../lib/token-storage';
import { loginRequest } from '../api/auth-api';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, rememberDevice?: boolean) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function payloadToUser(payload: AccessTokenPayload): AuthenticatedUser {
  return {
    userId: payload.sub,
    tenantId: payload.tenantId,
    roleId: payload.roleId,
    email: payload.email,
    fullName: payload.fullName,
    permissions: payload.permissions,
    isPlatformAdmin: payload.isPlatformAdmin,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      try {
        const payload = decodeJwt<AccessTokenPayload>(token);
        if (payload.exp && payload.exp * 1000 > Date.now()) {
          setUser(payloadToUser(payload));
        } else {
          clearTokens();
        }
      } catch {
        clearTokens();
      }
    }
    setIsLoading(false);
  }, []);

  async function login(email: string, password: string, rememberDevice = false): Promise<void> {
    // PLT-1: v1 runs single-tenant (SPEC.md §2 goal 5); tenant identification for login is
    // sourced from a build-time env var until PLT-8 adds subdomain/slug-based tenant resolution.
    const tenantId = import.meta.env.VITE_DEFAULT_TENANT_ID ?? '';
    const result = await loginRequest({ tenantId, email, password, rememberDevice });
    setTokens(result.tokens);
    setUser(result.user);
  }

  function logout(): void {
    clearTokens();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: user !== null, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
