"use client";

import { useEffect, useState } from "react";
import { AuthScreen } from "../components/AuthScreen";
import { Workspace } from "../components/Workspace";
import { api } from "../lib/api";

type Session = {
  authenticated: boolean;
  user?: { displayName?: string; email?: string };
};

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadSession() {
    try {
      setSession(await api<Session>("/api/v1/auth/me"));
    } catch {
      setSession({ authenticated: false });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST", body: "{}" });
    await loadSession();
  }

  if (loading) {
    return <div className="loading-screen">正在连接 looptask…</div>;
  }
  if (!session?.authenticated) {
    return <AuthScreen onAuthenticated={() => void loadSession()} />;
  }
  return <Workspace user={session.user || {}} onLogout={() => void logout()} />;
}