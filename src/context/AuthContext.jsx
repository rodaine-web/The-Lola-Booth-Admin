import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, clearTokens, setTokens } from "../api/client.js";
import { clearOfflineCache } from "../utils/offlineQueue.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me()
      .then((result) => setUser(result.user))
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
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
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
