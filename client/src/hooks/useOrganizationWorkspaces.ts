import { useCallback, useMemo, useState } from "react";
import { getOrganizationInitial, type OrganizationProfile } from "./useOrganizationProfile";

type OrganizationWorkspace = {
  id: string;
  name: string;
  location: string;
  initial: string;
  createdAt: string;
  updatedAt: string;
};

type OrganizationRegistry = {
  activeOrgId: string;
  organizations: OrganizationWorkspace[];
};

const REGISTRY_STORAGE_KEY = "themison-organization-registry:v1";
const SNAPSHOT_STORAGE_PREFIX = "themison-organization-snapshot:v1:";
const PROFILE_STORAGE_KEY = "themison-organization-profile:v1";

// Keep auth/session/theme separate and only move organization-scoped data.
const ORG_SCOPED_STORAGE_PREFIXES = [
  "themison-demo-state",
  "themison-collab-demo-inbox-",
  "themison-collab-demo-conversations-",
  "themison-collab-demo-threads-",
  "themison-chat-sessions",
  "themison-active-chat",
  "themison-organization-profile",
  "trial-team:",
  "trial-active-tab:",
  "trial-integrations-deferred:",
  "themison-worksheet-drafts",
  "themison-response-archive",
  "themison-inbox-triage-settings",
  "ui:collab_card_bottom_gap_px",
  "themison:quick-conversation-intent",
];

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

type Snapshot = Record<string, string>;

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const snapshotStorageKey = (orgId: string) => `${SNAPSHOT_STORAGE_PREFIX}${orgId}`;

const isOrgScopedStorageKey = (key: string) =>
  ORG_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const createUniqueOrgId = (name: string, existingIds: string[]) => {
  const base = `org-${slugify(name) || "workspace"}`;
  const existing = new Set(existingIds);
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
};

const parseProfile = (raw: string | null): OrganizationProfile => {
  if (!raw) return FALLBACK_PROFILE;
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return FALLBACK_PROFILE;
    return {
      ...FALLBACK_PROFILE,
      ...parsed,
      name: String(parsed.name || FALLBACK_PROFILE.name),
      legalName: String(parsed.legalName || parsed.name || FALLBACK_PROFILE.legalName),
      location: String(parsed.location || FALLBACK_PROFILE.location),
      address: String(parsed.address || FALLBACK_PROFILE.address),
      website: String(parsed.website || FALLBACK_PROFILE.website),
      contactEmail: String(parsed.contactEmail || FALLBACK_PROFILE.contactEmail),
      contactPhone: String(parsed.contactPhone || FALLBACK_PROFILE.contactPhone),
      description: String(parsed.description || FALLBACK_PROFILE.description),
      logoDataUrl: typeof parsed.logoDataUrl === "string" ? parsed.logoDataUrl : null,
    };
  } catch {
    return FALLBACK_PROFILE;
  }
};

const readCurrentProfile = (): OrganizationProfile => {
  if (!isBrowser()) return FALLBACK_PROFILE;
  return parseProfile(window.localStorage.getItem(PROFILE_STORAGE_KEY));
};

const readSnapshotProfile = (snapshot: Snapshot): OrganizationProfile =>
  parseProfile(snapshot[PROFILE_STORAGE_KEY] || null);

const toWorkspace = (
  profile: OrganizationProfile,
  id: string,
  createdAt: string,
  updatedAt: string
): OrganizationWorkspace => {
  const name = String(profile.name || "").trim() || "Organization";
  const location = String(profile.location || "").trim();
  return {
    id,
    name,
    location,
    initial: getOrganizationInitial(name),
    createdAt,
    updatedAt,
  };
};

const readRegistry = (): OrganizationRegistry | null => {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(REGISTRY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OrganizationRegistry>;
    if (!parsed || typeof parsed.activeOrgId !== "string" || !Array.isArray(parsed.organizations)) return null;

    const organizations = parsed.organizations
      .filter((org): org is OrganizationWorkspace => isObject(org) && typeof org.id === "string")
      .map((org) => ({
        id: String(org.id),
        name: String(org.name || "Organization"),
        location: String(org.location || ""),
        initial: String(org.initial || getOrganizationInitial(String(org.name || ""))),
        createdAt: String(org.createdAt || new Date().toISOString()),
        updatedAt: String(org.updatedAt || new Date().toISOString()),
      }));

    if (!organizations.length) return null;
    const activeOrgId = organizations.some((org) => org.id === parsed.activeOrgId)
      ? parsed.activeOrgId
      : organizations[0].id;
    return { activeOrgId, organizations };
  } catch {
    return null;
  }
};

const writeRegistry = (registry: OrganizationRegistry) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(registry));
};

const captureOrgScopedSnapshot = (): Snapshot => {
  if (!isBrowser()) return {};
  const snapshot: Snapshot = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !isOrgScopedStorageKey(key)) continue;
    const value = window.localStorage.getItem(key);
    if (value == null) continue;
    snapshot[key] = value;
  }
  return snapshot;
};

const readSnapshot = (orgId: string): Snapshot | null => {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(snapshotStorageKey(orgId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return null;
    const snapshot: Snapshot = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (typeof value === "string") {
        snapshot[key] = value;
      }
    });
    return snapshot;
  } catch {
    return null;
  }
};

const writeSnapshot = (orgId: string, snapshot: Snapshot) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(snapshotStorageKey(orgId), JSON.stringify(snapshot));
};

const clearOrgScopedStorage = () => {
  if (!isBrowser()) return;
  const keysToDelete: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !isOrgScopedStorageKey(key)) continue;
    keysToDelete.push(key);
  }
  keysToDelete.forEach((key) => window.localStorage.removeItem(key));
};

const applySnapshot = (snapshot: Snapshot) => {
  if (!isBrowser()) return;
  clearOrgScopedStorage();
  Object.entries(snapshot).forEach(([key, value]) => {
    window.localStorage.setItem(key, value);
  });
};

const upsertWorkspace = (organizations: OrganizationWorkspace[], next: OrganizationWorkspace) => {
  const existingIndex = organizations.findIndex((org) => org.id === next.id);
  if (existingIndex === -1) {
    return [...organizations, next];
  }
  const copy = [...organizations];
  copy[existingIndex] = next;
  return copy;
};

const initializeRegistry = (): OrganizationRegistry => {
  if (!isBrowser()) {
    return {
      activeOrgId: "org-default",
      organizations: [
        {
          id: "org-default",
          name: "Organization",
          location: "",
          initial: "O",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
  }

  const now = new Date().toISOString();
  const profile = readCurrentProfile();
  const currentSnapshot = captureOrgScopedSnapshot();
  const storedRegistry = readRegistry();

  let registry: OrganizationRegistry;
  if (!storedRegistry) {
    const orgId = createUniqueOrgId(profile.name || "Organization", []);
    registry = {
      activeOrgId: orgId,
      organizations: [toWorkspace(profile, orgId, now, now)],
    };
    writeSnapshot(orgId, currentSnapshot);
  } else {
    registry = storedRegistry;
    const activeWorkspace = registry.organizations.find((org) => org.id === registry.activeOrgId);
    const createdAt = activeWorkspace?.createdAt || now;
    const refreshedActiveWorkspace = toWorkspace(profile, registry.activeOrgId, createdAt, now);
    registry = {
      ...registry,
      organizations: upsertWorkspace(registry.organizations, refreshedActiveWorkspace),
    };
    if (!readSnapshot(registry.activeOrgId)) {
      writeSnapshot(registry.activeOrgId, currentSnapshot);
    }
  }

  // Seed one copy automatically so users can switch immediately.
  if (registry.organizations.length === 1) {
    const existingIds = registry.organizations.map((org) => org.id);
    const cloneName = `${profile.name || "Organization"} Copy`;
    const cloneId = createUniqueOrgId(cloneName, existingIds);
    const cloneProfile: OrganizationProfile = {
      ...profile,
      name: cloneName,
      legalName: cloneName,
    };
    const cloneSnapshot: Snapshot = {
      ...currentSnapshot,
      [PROFILE_STORAGE_KEY]: JSON.stringify(cloneProfile),
    };
    writeSnapshot(cloneId, cloneSnapshot);
    registry = {
      ...registry,
      organizations: [...registry.organizations, toWorkspace(cloneProfile, cloneId, now, now)],
    };
  }

  writeRegistry(registry);
  return registry;
};

export function useOrganizationWorkspaces() {
  const [registry, setRegistry] = useState<OrganizationRegistry>(() => initializeRegistry());

  const activeOrganization = useMemo(
    () => registry.organizations.find((org) => org.id === registry.activeOrgId) || registry.organizations[0],
    [registry]
  );

  const otherOrganizations = useMemo(
    () => registry.organizations.filter((org) => org.id !== registry.activeOrgId),
    [registry]
  );

  const cloneCurrentOrganization = useCallback((nameOverride?: string) => {
    if (!isBrowser()) return null;
    const now = new Date().toISOString();
    const sourceOrgId = registry.activeOrgId;
    const sourceWorkspace = registry.organizations.find((org) => org.id === sourceOrgId);
    if (!sourceWorkspace) return null;

    const sourceSnapshot = captureOrgScopedSnapshot();
    writeSnapshot(sourceOrgId, sourceSnapshot);

    const currentProfile = readCurrentProfile();
    const cloneName = String(nameOverride || "").trim() || `${currentProfile.name || sourceWorkspace.name} Copy`;
    const cloneProfile: OrganizationProfile = {
      ...currentProfile,
      name: cloneName,
      legalName: cloneName,
    };
    const cloneId = createUniqueOrgId(cloneName, registry.organizations.map((org) => org.id));
    const cloneSnapshot: Snapshot = {
      ...sourceSnapshot,
      [PROFILE_STORAGE_KEY]: JSON.stringify(cloneProfile),
    };
    writeSnapshot(cloneId, cloneSnapshot);

    const sourceUpdated = toWorkspace(currentProfile, sourceOrgId, sourceWorkspace.createdAt, now);
    const cloneWorkspace = toWorkspace(cloneProfile, cloneId, now, now);
    const nextRegistry: OrganizationRegistry = {
      ...registry,
      organizations: [...upsertWorkspace(registry.organizations, sourceUpdated), cloneWorkspace],
    };

    writeRegistry(nextRegistry);
    setRegistry(nextRegistry);
    return cloneId;
  }, [registry]);

  const switchOrganization = useCallback((organizationId: string) => {
    if (!isBrowser()) return false;
    if (!organizationId || organizationId === registry.activeOrgId) return false;
    const target = registry.organizations.find((org) => org.id === organizationId);
    const source = registry.organizations.find((org) => org.id === registry.activeOrgId);
    if (!target || !source) return false;

    const now = new Date().toISOString();
    const sourceSnapshot = captureOrgScopedSnapshot();
    const sourceProfile = readCurrentProfile();
    writeSnapshot(source.id, sourceSnapshot);

    const targetSnapshot = readSnapshot(organizationId);
    if (!targetSnapshot) return false;
    const targetProfile = readSnapshotProfile(targetSnapshot);

    const nextRegistry: OrganizationRegistry = {
      activeOrgId: organizationId,
      organizations: registry.organizations.map((org) => {
        if (org.id === source.id) {
          return toWorkspace(sourceProfile, source.id, org.createdAt, now);
        }
        if (org.id === target.id) {
          return toWorkspace(targetProfile, target.id, org.createdAt, now);
        }
        return org;
      }),
    };

    writeRegistry(nextRegistry);
    setRegistry(nextRegistry);
    applySnapshot(targetSnapshot);
    window.location.reload();
    return true;
  }, [registry]);

  return {
    organizations: registry.organizations,
    activeOrganization,
    otherOrganizations,
    cloneCurrentOrganization,
    switchOrganization,
  };
}
