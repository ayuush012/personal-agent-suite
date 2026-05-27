import { useCallback, useMemo } from "react";
import axios from "axios";
import type { User } from "@/types";

const USER_KEY = "asgard_user";
const SESSION_KEY = "asgard_session_id";

function getSessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, next);
  return next;
}

function buildUser(): User {
  const stored = localStorage.getItem(USER_KEY);
  if (stored) return JSON.parse(stored) as User;
  const sessionId = getSessionId();
  const user: User = {
    email: `recruiter-${sessionId.slice(0, 8)}@asgard.local`,
    team: "product",
    access_token: sessionId,
  };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export function useAuth() {
  const user = useMemo(() => buildUser(), []);

  // Preserve original frontend call patterns: components still send Authorization.
  // Backend ignores this in demo mode, but expects X-Asgard-Session for identity.
  axios.defaults.headers.common.Authorization = `Bearer ${user.access_token}`;
  axios.defaults.headers.common["X-Asgard-Session"] = user.access_token;

  const logout = useCallback(() => {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(SESSION_KEY);
    window.location.reload();
  }, []);

  return { user, logout };
}
