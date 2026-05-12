/**
 * Lightweight floating banner showing Auth0 login state.
 *
 * - Hidden while Auth0 is still bootstrapping (avoids a flash).
 * - Shows "Sign in" button when not authenticated.
 * - Shows the user's email + a "Sign out" button when authenticated.
 *
 * Mounted at the App root so it appears on every page until login
 * state is integrated into the Sidebar/Topbar properly. This is the
 * minimum viable login surface for development; replace with a proper
 * user menu in a follow-up when the Sidebar is touched.
 */

import { useAuth0 } from "./auth0Provider";

export function AuthBanner() {
  const { isLoading, isAuthenticated, user, loginWithRedirect, logout } = useAuth0();

  if (isLoading) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 9999,
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "6px 12px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.95)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        fontSize: 13,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {isAuthenticated ? (
        <>
          <span style={{ color: "#374151", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.email ?? user?.name ?? "Signed in"}
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "4px 10px",
              background: "white",
              cursor: "pointer",
              fontSize: 12,
              color: "#374151",
            }}
          >
            Sign out
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() =>
            void loginWithRedirect({
              appState: {
                returnTo: window.location.pathname + window.location.search,
              },
            })
          }
          style={{
            border: "1px solid #2563eb",
            borderRadius: 6,
            padding: "4px 14px",
            background: "#2563eb",
            color: "white",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Sign in
        </button>
      )}
    </div>
  );
}
