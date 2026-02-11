import { useCallback, useEffect, useMemo, useState } from "react";

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

const STORAGE_KEY = "themison-organization-profile:v1";
const UPDATE_EVENT = "themison:organization-profile-updated";

const DEFAULT_PROFILE: OrganizationProfile = {
  name: "Themison Research",
  legalName: "Themison Research, Inc.",
  location: "Copenhagen, Denmark",
  address: "Kongens Nytorv 1, 1050 Copenhagen, Denmark",
  website: "https://themison.com",
  contactEmail: "ops@themison.com",
  contactPhone: "+45 70 12 34 56",
  description: "Clinical operations organization focused on modern trial execution.",
  logoDataUrl: null,
};

function readStoredProfile(): OrganizationProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw) as Partial<OrganizationProfile>;
    return {
      ...DEFAULT_PROFILE,
      ...parsed,
      name: String(parsed?.name || DEFAULT_PROFILE.name),
      legalName: String(parsed?.legalName || DEFAULT_PROFILE.legalName),
      location: String(parsed?.location || DEFAULT_PROFILE.location),
      address: String(parsed?.address || DEFAULT_PROFILE.address),
      website: String(parsed?.website || DEFAULT_PROFILE.website),
      contactEmail: String(parsed?.contactEmail || DEFAULT_PROFILE.contactEmail),
      contactPhone: String(parsed?.contactPhone || DEFAULT_PROFILE.contactPhone),
      description: String(parsed?.description || DEFAULT_PROFILE.description),
      logoDataUrl: typeof parsed?.logoDataUrl === "string" ? parsed.logoDataUrl : null,
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

function writeStoredProfile(profile: OrganizationProfile) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new CustomEvent<OrganizationProfile>(UPDATE_EVENT, { detail: profile }));
}

export function getOrganizationInitial(name: string) {
  const normalized = String(name || "").trim();
  if (!normalized) return "O";
  return normalized.charAt(0).toUpperCase();
}

export function useOrganizationProfile() {
  const [profile, setProfile] = useState<OrganizationProfile>(() => readStoredProfile());

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== STORAGE_KEY) return;
      setProfile(readStoredProfile());
    };
    const onCustomUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<OrganizationProfile>;
      if (!customEvent.detail) {
        setProfile(readStoredProfile());
        return;
      }
      setProfile({ ...DEFAULT_PROFILE, ...customEvent.detail });
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(UPDATE_EVENT, onCustomUpdate as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(UPDATE_EVENT, onCustomUpdate as EventListener);
    };
  }, []);

  const updateProfile = useCallback((updates: Partial<OrganizationProfile>) => {
    setProfile((prev) => {
      const next = {
        ...prev,
        ...updates,
      };
      writeStoredProfile(next);
      return next;
    });
  }, []);

  const replaceProfile = useCallback((next: OrganizationProfile) => {
    const merged = { ...DEFAULT_PROFILE, ...next };
    setProfile(merged);
    writeStoredProfile(merged);
  }, []);

  const resetProfile = useCallback(() => {
    setProfile(DEFAULT_PROFILE);
    writeStoredProfile(DEFAULT_PROFILE);
  }, []);

  const organizationInitial = useMemo(() => getOrganizationInitial(profile.name), [profile.name]);

  return {
    profile,
    updateProfile,
    replaceProfile,
    resetProfile,
    organizationInitial,
    defaults: DEFAULT_PROFILE,
  };
}
