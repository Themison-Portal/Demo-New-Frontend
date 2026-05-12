import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { useMemo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { Auth0Provider, triggerAuth0Login, useAuth0 } from "./auth/auth0Provider";
import { applyBundledBrowserStateHandoffSnapshot } from "./lib/browserStateHandoff";
import "./index.css";

const queryClient = new QueryClient();

/**
 * On unauthorised tRPC errors, trigger Auth0's hosted-login redirect.
 * Auth0Provider sets the module-level singleton on first React mount;
 * we use the singleton so this handler (registered at module scope) can
 * reach it without needing useAuth0().
 *
 * If the singleton isn't ready yet (e.g., the very first request fires
 * before Auth0Provider's effect runs), `triggerAuth0Login` logs a
 * warning and no-ops; the next failed request will retrigger. The
 * legacy OAuth-portal redirect (`getLoginUrl()`) has been removed —
 * Auth0 is now the sole auth path.
 */
const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  void triggerAuth0Login({
    appState: { returnTo: window.location.pathname + window.location.search },
  });
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

/**
 * Trpc client must be constructed inside the React tree so it can call
 * useAuth0() and inject a fresh Auth0 Bearer token on every outbound
 * request. The token is read at fetch-time (not at client-creation
 * time) so silent token refresh from @auth0/auth0-spa-js stays
 * effective without recreating the client.
 *
 * `credentials: "include"` is preserved so the existing OAuth-portal
 * cookie flow keeps working for non-RAG procedures during the
 * transition. Requests carry both Cookie + Authorization headers; the
 * server picks whichever the procedure needs.
 */
function TrpcWithAuthProvider({ children }: { children: ReactNode }) {
  const { getAccessToken, isAuthenticated } = useAuth0();
  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        links: [
          httpBatchLink({
            url: "/api/trpc",
            transformer: superjson,
            async fetch(input, init) {
              const headers = new Headers(init?.headers ?? {});
              if (isAuthenticated) {
                try {
                  const token = await getAccessToken();
                  if (token) headers.set("Authorization", `Bearer ${token}`);
                } catch {
                  // Silent failure — the request still goes out and
                  // the server returns 401 if the procedure requires
                  // auth. Better than failing the fetch outright.
                }
              }
              return globalThis.fetch(input, {
                ...(init ?? {}),
                headers,
                credentials: "include",
              });
            },
          }),
        ],
      }),
    [getAccessToken, isAuthenticated],
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      {children}
    </trpc.Provider>
  );
}

async function bootstrapApp() {
  await applyBundledBrowserStateHandoffSnapshot();

  createRoot(document.getElementById("root")!).render(
    <Auth0Provider>
      <TrpcWithAuthProvider>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </TrpcWithAuthProvider>
    </Auth0Provider>,
  );
}

void bootstrapApp();
