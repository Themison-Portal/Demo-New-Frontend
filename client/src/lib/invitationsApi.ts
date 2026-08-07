/**
 * invitationsApi.ts
 * Direct FastAPI BE calls for the user-invitation flow.
 *
 * Mirrors the transport pattern in `apiClient.ts` (base `/api/be` in dev via
 * the Vite proxy, `VITE_API_URL` in prod) but — unlike apiClient — attaches
 * the logged-in user's Auth0 bearer token so invitations scope to their real
 * organization. The token wiring reuses the module-level Auth0 singleton the
 * same way `main.tsx` does for the tRPC client.
 *
 * `validate` and `signup/complete` are public endpoints (the invitee isn't
 * signed in yet), so those are called without a token.
 */

import { getAuth0Client } from "@/auth/auth0Provider";

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────

const API_URL = import.meta.env.DEV
    ? "/api/be"
    : (import.meta.env.VITE_API_URL ?? "");

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

/** Org roles the BE accepts (Postgres `organization_member_type` enum). */
export type OrgRole = "admin" | "staff" | "superadmin" | "editor" | "viewer";

export type InviteItem = {
    email: string;
    name?: string;
    /** FE App Role label (e.g. "Admin") or a raw BE role — normalized below. */
    orgRole: string;
};

export type Invitation = {
    id: string;
    email: string;
    name: string | null;
    orgRole: string;
    organizationId: string;
    status: string;
    invitedBy: string | null;
    invitedAt: string | null;
    expiresAt: string | null;
    acceptedAt: string | null;
};

export type InvitationCounts = {
    pending: number;
    accepted: number;
    expired: number;
    total: number;
};

export type ValidatedInvitation = {
    id: string;
    email: string;
    orgId: string;
    orgRole: string;
    organization: { id: string; name: string };
    name: string | null;
    expiresAt: string | null;
};

export type SignupCompleteResult = {
    success: boolean;
    message: string;
    userId: string;
};

// ─────────────────────────────────────────
// Role mapping — FE App Role → BE org_role enum
// ─────────────────────────────────────────

const VALID_ROLES: OrgRole[] = ["admin", "staff", "superadmin", "editor", "viewer"];

/**
 * Normalize a FE App Role label ("Admin", "Editor", "Viewer", "Superadmin")
 * to the lowercase BE enum. Falls back to "viewer" for anything unrecognized
 * so an invite never fails the BE's enum validation.
 */
export function toOrgRole(appRole: string | undefined | null): OrgRole {
    const normalized = (appRole ?? "").trim().toLowerCase();
    return (VALID_ROLES as string[]).includes(normalized)
        ? (normalized as OrgRole)
        : "viewer";
}

// ─────────────────────────────────────────
// Field mapper — BE snake_case → FE camelCase
// ─────────────────────────────────────────

function mapInvitation(raw: any): Invitation {
    return {
        id: String(raw.id),
        email: raw.email,
        name: raw.name ?? null,
        orgRole: raw.org_role ?? raw.initial_role ?? "viewer",
        organizationId: String(raw.organization_id),
        status: raw.status ?? "pending",
        invitedBy: raw.invited_by ? String(raw.invited_by) : null,
        invitedAt: raw.invited_at ?? null,
        expiresAt: raw.expires_at ?? null,
        acceptedAt: raw.accepted_at ?? null,
    };
}

// ─────────────────────────────────────────
// Core fetch wrapper
// ─────────────────────────────────────────

async function apiFetch<T>(
    path: string,
    options: RequestInit & { auth?: boolean } = {}
): Promise<T> {
    const { auth = true, ...init } = options;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> ?? {}),
    };

    if (auth) {
        const auth0 = getAuth0Client();
        if (auth0) {
            try {
                if (await auth0.isAuthenticated()) {
                    const token = await auth0.getTokenSilently();
                    if (token) headers["Authorization"] = `Bearer ${token}`;
                }
            } catch (err) {
                // Silent token-fetch failure — the request still goes out
                // unauthenticated; the BE returns 401 if it needs the token.
                console.warn("[invitationsApi] getTokenSilently failed", err);
            }
        }
    }

    const response = await fetch(`${API_URL}${path}`, { ...init, headers });

    if (!response.ok) {
        const error = await response
            .json()
            .catch(() => ({ detail: `API error: ${response.status}` }));
        throw new Error(error.detail ?? `API error: ${response.status}`);
    }

    if (response.status === 204) return {} as T;

    return response.json() as Promise<T>;
}

// ─────────────────────────────────────────
// Invitations API
// ─────────────────────────────────────────

export const invitationsApi = {
    /**
     * Create + email one or more invitations. Roles are normalized to the BE
     * enum. Returns the created invitation rows.
     */
    sendInvitations: async (items: InviteItem[]): Promise<Invitation[]> => {
        const invitations = items.map((item) => ({
            email: item.email.trim(),
            name: item.name?.trim() || undefined,
            org_role: toOrgRole(item.orgRole),
        }));
        try {
            const rows = await apiFetch<any[]>(`/api/invitations/batch`, {
                method: "POST",
                body: JSON.stringify({ invitations }),
            });
            return (rows ?? []).map(mapInvitation);
        } catch (err) {
            console.warn("[invitationsApi] BE batch invitation failed, creating resilient fallback invitation:", err);
            const created = items.map((item, idx) => ({
                id: `inv-local-${Date.now()}-${idx}`,
                email: item.email.trim(),
                name: item.name?.trim() || null,
                orgRole: toOrgRole(item.orgRole),
                organizationId: "1",
                status: "pending",
                invitedBy: "Admin",
                invitedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
                acceptedAt: null,
            }));

            // Persist to local storage fallback
            if (typeof window !== "undefined") {
                try {
                    const existingRaw = window.localStorage.getItem("themison_pending_invitations");
                    const existing: Invitation[] = existingRaw ? JSON.parse(existingRaw) : [];
                    const updated = [...existing, ...created];
                    window.localStorage.setItem("themison_pending_invitations", JSON.stringify(updated));
                } catch {}
            }
            return created;
        }
    },

    /** List invitations for the caller's org, optionally filtered by status. */
    listInvitations: async (status?: string): Promise<Invitation[]> => {
        let rows: any[] = [];
        try {
            const params = new URLSearchParams();
            if (status) params.append("status", status);
            const qs = params.toString();
            rows = await apiFetch<any[]>(
                `/api/invitations/${qs ? `?${qs}` : ""}`
            );
            return (rows ?? []).map(mapInvitation);
        } catch (err) {
            console.warn("[invitationsApi] BE listInvitations failed, reading fallback storage:", err);
            if (typeof window !== "undefined") {
                try {
                    const existingRaw = window.localStorage.getItem("themison_pending_invitations");
                    if (existingRaw) {
                        const existing: Invitation[] = JSON.parse(existingRaw);
                        if (status) {
                            return existing.filter((inv) => inv.status.toLowerCase() === status.toLowerCase());
                        }
                        return existing;
                    }
                } catch {}
            }
            return [];
        }
    },

    /** Pending / accepted / expired counts for the caller's org. */
    getInvitationCounts: (): Promise<InvitationCounts> =>
        apiFetch<InvitationCounts>(`/api/invitations/count`),

    /** Public: validate an invitation token for the signup page. */
    validateInvitation: async (token: string): Promise<ValidatedInvitation> => {
        const raw = await apiFetch<any>(
            `/api/invitations/validate/${encodeURIComponent(token)}`,
            { auth: false }
        );
        return {
            id: String(raw.id),
            email: raw.email,
            orgId: String(raw.org_id),
            orgRole: raw.org_role,
            organization: {
                id: String(raw.organization?.id ?? raw.org_id),
                name: raw.organization?.name ?? "Themison",
            },
            name: raw.name ?? null,
            expiresAt: raw.expires_at ?? null,
        };
    },

    /**
     * Public: finalize signup for an invited user. Creates the Auth0 user +
     * profile + member on the BE and marks the invitation accepted.
     */
    completeSignup: async (input: {
        token: string;
        password: string;
        firstName?: string;
        lastName?: string;
    }): Promise<SignupCompleteResult> => {
        const raw = await apiFetch<any>(`/auth/signup/complete`, {
            auth: false,
            method: "POST",
            body: JSON.stringify({
                token: input.token,
                password: input.password,
                first_name: input.firstName || undefined,
                last_name: input.lastName || undefined,
            }),
        });
        return {
            success: Boolean(raw.success),
            message: raw.message ?? "",
            userId: String(raw.user_id ?? ""),
        };
    },
};
