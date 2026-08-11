import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

export interface OrganizationProfile {
    name: string;
    legalName: string;
    location: string;
    address: string;
    website: string;
    contactEmail: string;
    contactPhone: string;
    description: string;
    logoDataUrl: string | null;
}

const FALLBACK_PROFILE: OrganizationProfile = {
    name: "Organization",
    legalName: "Organization",
    location: "",
    address: "",
    website: "",
    contactEmail: "",
    contactPhone: "",
    description: "",
    logoDataUrl: null,
};

export function getOrganizationInitial(name: string) {
    const normalized = String(name || "").trim();
    if (!normalized) return "O";
    return normalized.charAt(0).toUpperCase();
}

/**
 * Real organization profile for the authenticated member, proxied from
 * GET /api/organizations/me (and PUT for saves) on the FastAPI backend.
 * Replaces the old localStorage-based fake org profile.
 *
 * NOTE: the backend Organization model currently only stores `name` (plus
 * onboarding/support flags) — location/address/website/contactEmail/
 * contactPhone/description/logoDataUrl are not persisted server-side yet.
 * `replaceProfile` only sends `name` through; the rest of the fields on
 * the Organization Overview form will not actually save until the backend
 * model is extended.
 */
export function useOrganizationProfile() {
    const { data, isLoading } = trpc.organization.getMine.useQuery();
    const utils = trpc.useUtils();
    const updateMutation = trpc.organization.update.useMutation({
        onSuccess: () => utils.organization.getMine.invalidate(),
    });

    const profile: OrganizationProfile = useMemo(() => {
        if (!data) return FALLBACK_PROFILE;
        return {
            ...FALLBACK_PROFILE,
            name: data.name || FALLBACK_PROFILE.name,
            legalName: data.name || FALLBACK_PROFILE.legalName,
        };
    }, [data]);

    const organizationInitial = useMemo(() => getOrganizationInitial(profile.name), [profile.name]);

    const replaceProfile = async (next: OrganizationProfile) => {
        await updateMutation.mutateAsync({ name: next.name });
    };

    return {
        profile,
        isLoading,
        organizationInitial,
        replaceProfile,
        defaults: FALLBACK_PROFILE,
    };
}