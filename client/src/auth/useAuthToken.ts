/**
 * Convenience hook over the Auth0 SPA SDK that resolves to a fresh
 * access token (or null when the user isn't logged in).
 *
 * Use it from any component or query function that needs to send
 * `Authorization: Bearer <jwt>` to the Express server (which then
 * proxies to core-backend).
 *
 * Tokens are cached by Auth0 and silently refreshed; calling
 * getAccessToken() in a tight loop is cheap.
 */

import { useCallback } from "react";
import { useAuth0 } from "./auth0Provider";

export function useAuthToken() {
  const { isAuthenticated, isLoading, getAccessToken } = useAuth0();

  const fetchToken = useCallback(async (): Promise<string | null> => {
    if (isLoading) return null;
    if (!isAuthenticated) return null;
    try {
      return await getAccessToken();
    } catch (err) {
      // Most common cause: the user's session expired and silent
      // renewal failed. Returning null lets the caller render an
      // unauthenticated state instead of crashing.
      console.warn("[Auth0] getAccessToken failed", err);
      return null;
    }
  }, [isAuthenticated, isLoading, getAccessToken]);

  return { fetchToken, isAuthenticated, isLoading };
}
