const API = "/api";

export function getToken() {
  return localStorage.getItem("gather_token");
}

export function setSession(token: string, user: User) {
  localStorage.setItem("gather_token", token);
  localStorage.setItem("gather_user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("gather_token");
  localStorage.removeItem("gather_user");
}

export function getSavedUser(): User | null {
  try {
    const value = localStorage.getItem("gather_user");
    return value ? JSON.parse(value) as User : null;
  } catch {
    return null;
  }
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new Event("session-expired"));
    }
    throw new Error(data.error || "Request failed.");
  }
  return data as T;
}

export interface User {
  id: string;
  publicId: string;
  name: string;
  email: string;
}
