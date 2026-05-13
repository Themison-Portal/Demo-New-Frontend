import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import {
  Auth0Provider,
  getAuth0Client,
  triggerAuth0Login,
} from "./auth/auth0Provider";
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
 * Trpc client is constructed **once** at module scope. The Auth0 token
 * is fetched per-request via the module-level singleton (`getAuth0Client`)
 * — this avoids recreating the client on every Auth0 state change, which
 * would invalidate every active useQuery and cause a refetch loop.
 *
 * `credentials: "include"` is preserved so the existing OAuth-portal
 * cookie flow keeps working for non-RAG procedures during the
 * transition. Requests carry both Cookie + Authorization headers; the
 * server picks whichever the procedure needs.
 */
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async fetch(input, init) {
        const headers = new Headers(init?.headers ?? {});
        const auth0 = getAuth0Client();
        if (auth0) {
          try {
            const authed = await auth0.isAuthenticated();
            if (authed) {
              const token = await auth0.getTokenSilently();
              if (token) headers.set("Authorization", `Bearer ${token}`);
            }
          } catch (err) {
            // Silent token-fetch failure — the request still goes out
            // without auth and the server returns 401 if needed.
            console.warn("[Auth0] getTokenSilently failed; sending request unauthenticated", err);
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
});

async function bootstrapApp() {
  await applyBundledBrowserStateHandoffSnapshot();

  createRoot(document.getElementById("root")!).render(
    <Auth0Provider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </trpc.Provider>
    </Auth0Provider>,
  );
}

void bootstrapApp();
