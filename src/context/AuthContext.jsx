import {restoreSession} from '../../shared/session-recovery.js';
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, clearTokens, setTokens } from "../api/client.js";
import { clearOfflineCache } from "../utils/offlineQueue.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [authError,setAuthError]=useState(null);
  const [attempt,setAttempt]=useState(0);
  useEffect(() => {
    let active=true;
    setLoading(true);setAuthError(null);
    restoreSession(()=>api.me(),clearTokens).then(result=>{if(active){setUser(result.user);setAuthError(result.error);setLoading(false);}});
    return ()=>{active=false;};
  }, [attempt]);

  const value = useMemo(() => ({
    user,
    loading,
    authError,
    retryAuth:()=>setAttempt(value=>value+1),
    async login(credentials) {
      const tokens = await api.login(credentials);
      setTokens(tokens);
      const profile = await api.me();
      setUser(profile.user);
    },
    async logout() {
      await api.logout().catch(() => null);
      await clearOfflineCache();
      clearTokens();
      setUser(null);
    },
    can(permission) {
      return user?.permissions?.includes("*") || user?.permissions?.includes(permission);
    }
  }), [user, loading, authError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
