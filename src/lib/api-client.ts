// src/lib/api-client.ts
import { getStoredToken, clearStoredToken } from "@/lib/auth";

/**
 * Authenticated fetch wrapper. Automatically adds Authorization header
 * if a token is stored in localStorage.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(input, { ...init, headers });

  // If 401, redirect to login
  if (response.status === 401 && typeof window !== "undefined") {
    clearStoredToken();
    const currentPath = window.location.pathname;
    if (currentPath !== "/login") {
      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
    }
  }

  return response;
}
