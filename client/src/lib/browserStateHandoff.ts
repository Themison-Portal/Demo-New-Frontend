const HANDOFF_VERSION = 1;
const HANDOFF_APP = "themison-prototype";
const HANDOFF_FILENAME = "engineer-handoff.json";
const HANDOFF_PUBLIC_PATH = `/${HANDOFF_FILENAME}`;
const HANDOFF_APPLIED_MARKER_KEY = "themison-browser-state-handoff-applied:v1";
const EXCLUDED_STORAGE_KEYS = new Set([HANDOFF_APPLIED_MARKER_KEY]);

const LOCAL_STORAGE_PREFIXES = ["themison-", "ui:"];
const LOCAL_STORAGE_EXACT_KEYS = ["manus-runtime-user-info", "theme"];
const SESSION_STORAGE_PREFIXES = ["themison-"];
const SESSION_STORAGE_EXACT_KEYS: string[] = [];

export interface BrowserStateHandoffSnapshot {
  version: number;
  app: string;
  id: string;
  createdAt: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

function isStorageKeySelected(key: string, exactKeys: string[], prefixes: string[]) {
  if (EXCLUDED_STORAGE_KEYS.has(key)) return false;
  return exactKeys.includes(key) || prefixes.some((prefix) => key.startsWith(prefix));
}

function collectStorageEntries(storage: Storage, exactKeys: string[], prefixes: string[]) {
  const entries: Record<string, string> = {};

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !isStorageKeySelected(key, exactKeys, prefixes)) continue;
    const value = storage.getItem(key);
    if (typeof value !== "string") continue;
    entries[key] = value;
  }

  return entries;
}

function clearSelectedStorageKeys(storage: Storage, exactKeys: string[], prefixes: string[]) {
  const keysToRemove: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !isStorageKeySelected(key, exactKeys, prefixes)) continue;
    keysToRemove.push(key);
  }

  keysToRemove.forEach((key) => storage.removeItem(key));
}

function normalizeStorageEntries(input: unknown) {
  if (!input || typeof input !== "object") return null;

  const nextEntries: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof key !== "string" || typeof value !== "string") return null;
    nextEntries[key] = value;
  }

  return nextEntries;
}

function createSnapshotId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidSnapshot(input: unknown): input is BrowserStateHandoffSnapshot {
  if (!input || typeof input !== "object") return false;

  const candidate = input as Partial<BrowserStateHandoffSnapshot>;
  const localStorage = normalizeStorageEntries(candidate.localStorage);
  const sessionStorage = normalizeStorageEntries(candidate.sessionStorage);

  return (
    candidate.version === HANDOFF_VERSION &&
    candidate.app === HANDOFF_APP &&
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.createdAt === "string" &&
    candidate.createdAt.trim().length > 0 &&
    localStorage !== null &&
    sessionStorage !== null
  );
}

export function createBrowserStateHandoffSnapshot(): BrowserStateHandoffSnapshot | null {
  if (typeof window === "undefined") return null;

  return {
    version: HANDOFF_VERSION,
    app: HANDOFF_APP,
    id: createSnapshotId(),
    createdAt: new Date().toISOString(),
    localStorage: collectStorageEntries(window.localStorage, LOCAL_STORAGE_EXACT_KEYS, LOCAL_STORAGE_PREFIXES),
    sessionStorage: collectStorageEntries(window.sessionStorage, SESSION_STORAGE_EXACT_KEYS, SESSION_STORAGE_PREFIXES),
  };
}

export function downloadBrowserStateHandoffSnapshot() {
  const snapshot = createBrowserStateHandoffSnapshot();
  if (!snapshot || typeof window === "undefined") {
    return { ok: false as const };
  }

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = HANDOFF_FILENAME;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);

  return {
    ok: true as const,
    filename: HANDOFF_FILENAME,
    snapshot,
  };
}

export function applyBrowserStateHandoffSnapshot(snapshot: BrowserStateHandoffSnapshot) {
  if (typeof window === "undefined" || !isValidSnapshot(snapshot)) {
    return { ok: false as const };
  }

  clearSelectedStorageKeys(window.localStorage, LOCAL_STORAGE_EXACT_KEYS, LOCAL_STORAGE_PREFIXES);
  clearSelectedStorageKeys(window.sessionStorage, SESSION_STORAGE_EXACT_KEYS, SESSION_STORAGE_PREFIXES);

  Object.entries(snapshot.localStorage).forEach(([key, value]) => {
    window.localStorage.setItem(key, value);
  });
  Object.entries(snapshot.sessionStorage).forEach(([key, value]) => {
    window.sessionStorage.setItem(key, value);
  });

  return {
    ok: true as const,
    appliedLocalStorageKeys: Object.keys(snapshot.localStorage),
    appliedSessionStorageKeys: Object.keys(snapshot.sessionStorage),
  };
}

export async function applyBundledBrowserStateHandoffSnapshot() {
  if (typeof window === "undefined") {
    return { status: "skipped" as const, reason: "not-browser" as const };
  }

  if (window.location.protocol === "file:") {
    return { status: "skipped" as const, reason: "file-protocol" as const };
  }

  try {
    const response = await fetch(HANDOFF_PUBLIC_PATH, { cache: "no-store" });
    if (response.status === 404) {
      return { status: "skipped" as const, reason: "missing" as const };
    }
    if (!response.ok) {
      return { status: "skipped" as const, reason: "unavailable" as const };
    }

    const parsed = (await response.json()) as unknown;
    if (!isValidSnapshot(parsed)) {
      return { status: "skipped" as const, reason: "invalid" as const };
    }

    const alreadyAppliedId = window.localStorage.getItem(HANDOFF_APPLIED_MARKER_KEY);
    if (alreadyAppliedId === parsed.id) {
      return { status: "skipped" as const, reason: "already-applied" as const };
    }

    const result = applyBrowserStateHandoffSnapshot(parsed);
    if (!result.ok) {
      return { status: "skipped" as const, reason: "apply-failed" as const };
    }

    window.localStorage.setItem(HANDOFF_APPLIED_MARKER_KEY, parsed.id);
    return {
      status: "applied" as const,
      snapshotId: parsed.id,
      appliedLocalStorageKeys: result.appliedLocalStorageKeys,
      appliedSessionStorageKeys: result.appliedSessionStorageKeys,
    };
  } catch {
    return { status: "skipped" as const, reason: "error" as const };
  }
}

export { HANDOFF_FILENAME, HANDOFF_PUBLIC_PATH };
