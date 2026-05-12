/**
 * Landing page for Auth0's redirect callback (`/auth/callback`).
 *
 * The Auth0 SDK handles `?code=…&state=…` in Auth0Provider's bootstrap
 * effect — by the time React mounts here, the URL has already been
 * cleaned up. This component just shows a brief spinner and forwards
 * the user to either the original page they came from or the home
 * page once authentication state hydrates.
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth0 } from "../auth/auth0Provider";

export default function AuthCallback() {
  const { isLoading, isAuthenticated } = useAuth0();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    // Auth0Provider has finished its bootstrap; we can safely redirect.
    // appState.returnTo would be ideal but Auth0Provider doesn't expose
    // it yet — for now, send the user to the workspace landing.
    navigate(isAuthenticated ? "/" : "/", { replace: true });
  }, [isLoading, isAuthenticated, navigate]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
