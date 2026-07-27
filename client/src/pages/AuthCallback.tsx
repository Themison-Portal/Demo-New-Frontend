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
    const { isLoading, isAuthenticated, appState, bootstrapError } = useAuth0();
    const [, navigate] = useLocation();

    useEffect(() => {
        if (bootstrapError) return;
        const returnTo =
            typeof appState?.returnTo === "string" && appState.returnTo
                ? appState.returnTo
                : "/";
        navigate(isAuthenticated ? returnTo : "/", { replace: true });
    }, [isLoading, isAuthenticated, appState, bootstrapError, navigate]);
    if (bootstrapError) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-background px-4">
                <div className="flex max-w-sm flex-col items-center gap-2 text-center">
                    <p className="text-sm font-medium text-red-600">
                        Sign-in isn&apos;t working right now.
                    </p>
                    <p className="text-sm text-muted-foreground">
                        Please try again in a moment, or contact support if this keeps happening.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen w-screen items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-sm">Signing you in…</p>
            </div>
        </div>
    );
}
