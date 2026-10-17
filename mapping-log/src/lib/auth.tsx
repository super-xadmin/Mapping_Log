import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthState, Me } from "../../shared/types";
import { api, isOffline } from "./api";
import { syncNow } from "./outbox";
import { lsGet, lsSet } from "./store";

const K_ME = "mlog:me";

type Ctx = {
  loading: boolean;
  user: Me | null;
  setupRequired: boolean;
  setupKeyConfigured: boolean;
  /** ใช้ข้อมูลผู้ใช้ที่จำไว้ในเครื่อง เพราะเชื่อมต่อเซิร์ฟเวอร์ไม่ได้ */
  offline: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signedIn: (u: Me) => void;
  signedOut: () => void;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState({
    loading: true,
    user: null as Me | null,
    setupRequired: false,
    setupKeyConfigured: true,
    offline: false,
    error: null as string | null,
  });

  const refresh = useCallback(async () => {
    try {
      const s = await api<AuthState>("/auth/state");
      setSt({ loading: false, user: s.user, setupRequired: s.setupRequired, setupKeyConfigured: s.setupKeyConfigured, offline: false, error: null });
      lsSet(K_ME, s.user);
      if (s.user && !s.user.mustChangePassword) void syncNow();
    } catch (e) {
      if (isOffline(e)) {
        setSt((x) => ({ ...x, loading: false, user: lsGet<Me | null>(K_ME, null), offline: true, error: null }));
      } else {
        setSt((x) => ({ ...x, loading: false, error: e instanceof Error ? e.message : String(e) }));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onAuth = (e: Event) => {
      const code = (e as CustomEvent<string>).detail;
      if (code === "unauthorized") {
        lsSet(K_ME, null);
        setSt((x) => ({ ...x, user: null }));
      } else {
        void refresh();
      }
    };
    const onOnline = () => void refresh();
    window.addEventListener("mlog:auth", onAuth);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("mlog:auth", onAuth);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh]);

  const value = useMemo<Ctx>(
    () => ({
      ...st,
      refresh,
      signedIn: (u: Me) => {
        lsSet(K_ME, u);
        setSt((x) => ({ ...x, user: u, setupRequired: false, offline: false }));
        if (!u.mustChangePassword) void syncNow();
      },
      signedOut: () => {
        lsSet(K_ME, null);
        setSt((x) => ({ ...x, user: null }));
      },
    }),
    [st, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthContext);
  if (!c) throw new Error("AuthProvider missing");
  return c;
}
