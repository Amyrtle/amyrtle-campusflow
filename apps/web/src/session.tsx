import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Organization, Session } from '@campusflow/shared';
import { api, ApiError } from './api';
interface AuthValue {
  session: Session | null;
  pending: boolean;
  error: unknown;
  org: Organization | null;
  selectOrg: (id: string) => void;
  refresh: () => Promise<unknown>;
}
const AuthContext = createContext<AuthValue>(null!);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [orgId, setOrgId] = useState(() => localStorage.getItem('campusflow-org') || '');
  const query = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api<Session>('/auth/session');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
  });
  const session = query.data || null;
  const org =
    session?.organizations.find((o) => o.id === orgId) || session?.organizations[0] || null;
  return (
    <AuthContext.Provider
      value={{
        session,
        org,
        pending: query.isPending,
        error: query.error,
        refresh: query.refetch,
        selectOrg: (id) => {
          localStorage.setItem('campusflow-org', id);
          setOrgId(id);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
