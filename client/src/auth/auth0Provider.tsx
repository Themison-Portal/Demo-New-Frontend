/**
 * Auth0 React provider — wraps <App> so any descendant can call
 * `useAuth0()` from the @auth0/auth0-spa-js singleton context.
 *
 * Configured against the same Auth0 tenant as the production frontend
 * and core-backend (read from `import.meta.env.VITE_AUTH0_*`). Tokens
 * are kept in memory; refresh tokens go through Auth0's silent-renew
 * flow rather than cookies.
 */

import {
    Auth0Client,
    type Auth0ClientOptions,
    createAuth0Client,
    type GetTokenSilentlyOptions,
    type RedirectLoginOptions,
    type User,
} from "@auth0/auth0-spa-js";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

type Auth0ContextValue = {
    isLoading: boolean;
    isAuthenticated: boolean;
    user: User | undefined;
    appState: Record<string, unknown> | undefined;
    bootstrapError: unknown;
    loginWithRedirect: (opts?: RedirectLoginOptions) => Promise<void>;
    logout: () => Promise<void>;
    getAccessToken: (opts?: GetTokenSilentlyOptions) => Promise<string>;
};

const Auth0Context = createContext<Auth0ContextValue | null>(null);

/**
 * Module-level reference to the Auth0Client created inside the
 * Auth0Provider's useEffect. Lets non-React callers (e.g., the
 * QueryClient subscription handlers in main.tsx that fire on
 * unauthorised tRPC errors) trigger loginWithRedirect without needing
 * useAuth0().
 *
 * Set once on Auth0Provider mount; cleared on full page reload but
 * not on logout (a fresh client is rebuilt on next mount anyway).
 */
let auth0ClientSingleton: Auth0Client | null = null;

export function getAuth0Client(): Auth0Client | null {
    return auth0ClientSingleton;
}

/**
 * Trigger Auth0 login from anywhere — including module-scope code.
 * No-op when the client hasn't initialised yet (rare; happens before
 * the first React render).
 */
export async function triggerAuth0Login(opts?: RedirectLoginOptions): Promise<void> {
    const client = auth0ClientSingleton;
    if (!client) {
        console.warn("[Auth0] Login requested before client initialised; ignoring.");
        return;
    }
    await client.loginWithRedirect(opts);
}

const buildClientOptions = (): Auth0ClientOptions => {
    const domain = (import.meta.env.VITE_AUTH0_DOMAIN || import.meta.env.AUTH0_DOMAIN) as string | undefined;
    const clientId = (import.meta.env.VITE_AUTH0_CLIENT_ID || import.meta.env.AUTH0_CLIENT_ID) as string | undefined;
    const audience = (import.meta.env.VITE_AUTH0_AUDIENCE || import.meta.env.AUTH0_AUDIENCE) as string | undefined;
    const redirectUri =
        (import.meta.env.VITE_AUTH0_REDIRECT_URI || import.meta.env.AUTH0_REDIRECT_URI) as string | undefined ??
        `${window.location.origin}/callback`;

    if (!domain || !clientId) {
        // Soft-fail: log loudly but don't crash the app. Pages that don't
        // need Auth0 (e.g., public marketing pages) keep rendering;
        // anything that calls getAccessToken() will reject clearly.
        console.warn(
            "[Auth0] VITE_AUTH0_DOMAIN or VITE_AUTH0_CLIENT_ID is missing. " +
            "Auth-protected features (RAG, document upload) will not work. " +
            "Populate them in the new FE's env.",
        );
    }

    return {
        domain: domain ?? "",
        clientId: clientId ?? "",
        authorizationParams: {
            redirect_uri: redirectUri,
            ...(audience ? { audience } : {}),
        },
        // localstorage cache so the session survives full page reloads.
        // `memory` would drop the access token on every refresh, silently
        // logging the user out and breaking any Bearer-token-dependent flow
        // (notably the FE→core-backend upload proxy). Refresh tokens are
        // still used for silent renewal; localstorage just persists them.
        cacheLocation: "localstorage",
        useRefreshTokens: true,
    };
};
const REDIRECT_GUARD_KEY = "auth0_redirect_attempts";
const MAX_REDIRECT_ATTEMPTS = 2;
export function Auth0Provider({ children }: { children: ReactNode }) {
    const [client, setClient] = useState<Auth0Client | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState<User | undefined>(undefined);
    const [appState, setAppState] = useState<Record<string, unknown> | undefined>(undefined);
    const [bootstrapError, setBootstrapError] = useState<unknown>(null);

    // One-shot bootstrap: build the Auth0 client, finish any in-progress
    // redirect callback, hydrate the auth state.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const next = await createAuth0Client(buildClientOptions());

                // Complete redirect-callback handling if we just came back from
                // Auth0's hosted login page.
                const hasAuthCode = window.location.search.includes("code=");
                const hasState = window.location.search.includes("state=");
                if (hasAuthCode && hasState) {
                    // await next.handleRedirectCallback();
                    // // Strip the query string so a refresh doesn't re-trigger
                    // // handleRedirectCallback.
                    // window.history.replaceState({}, document.title, window.location.pathname);
                    try {
                        const result = await next.handleRedirectCallback();
                        if (!cancelled) setAppState(result.appState);
                        sessionStorage.removeItem(REDIRECT_GUARD_KEY);
                    } catch (callbackErr) {
                        console.error("[Auth0] handleRedirectCallback failed", callbackErr);
                        const attempts =
                            Number(sessionStorage.getItem(REDIRECT_GUARD_KEY) ?? "0") + 1;
                        sessionStorage.setItem(REDIRECT_GUARD_KEY, String(attempts));
                        if (attempts > MAX_REDIRECT_ATTEMPTS && !cancelled) {
                            setBootstrapError(callbackErr);
                        }
                    } finally {
                        window.history.replaceState({}, document.title, window.location.pathname);
                    }
                }

                const authed = await next.isAuthenticated();
                const u = authed ? await next.getUser() : undefined;

                if (cancelled) return;
                // Stash on the module-level ref so non-React callers (e.g.,
                // the queryClient subscription handler in main.tsx) can
                // trigger login without needing useAuth0().
                auth0ClientSingleton = next;
                setClient(next);
                setIsAuthenticated(authed);
                setUser(u);
            } catch (err) {
                console.error("[Auth0] Bootstrap failed", err);
                if (!cancelled) setBootstrapError(err);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const loginWithRedirect = useCallback(
        async (opts?: RedirectLoginOptions) => {
            if (!client) {
                throw new Error("[Auth0] Client not initialised yet");
            }
            await client.loginWithRedirect(opts);
        },
        [client],
    );

    const logout = useCallback(async () => {
        if (!client) return;
        await client.logout({
            logoutParams: {
                returnTo: window.location.origin,
            },
        });
        setIsAuthenticated(false);
        setUser(undefined);
    }, [client]);

    const getAccessToken = useCallback(
        async (opts?: GetTokenSilentlyOptions) => {
            if (!client) {
                throw new Error("[Auth0] Client not initialised yet");
            }
            return client.getTokenSilently(opts);
        },
        [client],
    );

    const value = useMemo<Auth0ContextValue>(
        () => ({
            isLoading,
            isAuthenticated,
            user,
            appState,
            bootstrapError,
            loginWithRedirect,
            logout,
            getAccessToken,
        }),
        [isLoading, isAuthenticated, user, appState, bootstrapError, loginWithRedirect, logout, getAccessToken],
    );

    return <Auth0Context.Provider value={value}>{children}</Auth0Context.Provider>;
}

export function useAuth0() {
    const ctx = useContext(Auth0Context);
    if (!ctx) {
        throw new Error("useAuth0 must be called inside <Auth0Provider>");
    }
    return ctx;
}
