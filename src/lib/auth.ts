// src/lib/auth.ts

/**
 * Server-side: verify auth token from request header.
 * If AUTH_TOKEN env var is not set, authentication is disabled.
 */
export function verifyAuthToken(request: Request): boolean {
  const authToken = process.env.AUTH_TOKEN;

  // If no AUTH_TOKEN configured, auth is disabled (local-only mode)
  if (!authToken) return true;

  const authorization = request.headers.get("Authorization");
  if (!authorization) return false;

  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) return false;

  return token === authToken;
}

/**
 * Client-side: get stored auth token from localStorage.
 */
export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("codeanywhere_auth_token");
}

/**
 * Client-side: store auth token in localStorage.
 */
export function setStoredToken(token: string): void {
  localStorage.setItem("codeanywhere_auth_token", token);
  document.cookie = `codeanywhere_auth_token=${encodeURIComponent(token)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

/**
 * Client-side: remove stored auth token.
 */
export function clearStoredToken(): void {
  localStorage.removeItem("codeanywhere_auth_token");
  document.cookie = "codeanywhere_auth_token=; Path=/; Max-Age=0; SameSite=Lax";
}

/**
 * Client-side: check if auth is required by querying the server.
 * Returns true if the server requires authentication (401 response).
 * Returns null if the server is unreachable (unknown state).
 */
export async function isAuthRequired(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/health");
    return res.status === 401;
  } catch {
    return null; // Server unreachable — distinct from "no auth needed"
  }
}
