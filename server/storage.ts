// Preconfigured storage helpers for Manus WebDev templates.
//
// When `BUILT_IN_FORGE_API_URL` + `BUILT_IN_FORGE_API_KEY` are set, uses
// the Biz-provided storage proxy (Authorization: Bearer <token>).
// Otherwise falls back to a local filesystem store under
// `LOCAL_STORAGE_ROOT` (default `/tmp/themison-storage`), served by
// Express on `/local-storage/*`. The fallback lets the FE run outside
// the Manus platform (e.g., local docker compose) without needing
// access to the Forge storage proxy.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ENV } from "./_core/env";

type StorageConfig = { baseUrl: string; apiKey: string };

/**
 * Root for the local-filesystem fallback. `/tmp/...` keeps the data
 * outside the bind-mounted source tree (so it doesn't pollute the repo)
 * and outside the node_modules anonymous volume.
 */
const LOCAL_STORAGE_ROOT =
  process.env.LOCAL_STORAGE_ROOT ?? "/tmp/themison-storage";

/**
 * URL prefix the FE serves the local store under. `server/_core/index.ts`
 * registers a static-file middleware at this path when the fallback is
 * active. Browsers + the PDF parser inside the container both reach it
 * via `http://localhost:3000`.
 */
const LOCAL_STORAGE_ROUTE = "/local-storage";

function getPublicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
}

export function isUsingLocalStorage(): boolean {
  return !ENV.forgeApiUrl || !ENV.forgeApiKey;
}

export function getLocalStorageRoot(): string {
  return LOCAL_STORAGE_ROOT;
}

export function getLocalStorageRoute(): string {
  return LOCAL_STORAGE_ROUTE;
}

function getStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;
  if (!baseUrl || !apiKey) {
    // Unreachable: callers should have checked isUsingLocalStorage()
    // before reaching here. Guarded anyway for clarity.
    throw new Error(
      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl)
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
  });
  return (await response.json()).url;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

// ---------------------------------------------------------------------
// Local-filesystem fallback
// ---------------------------------------------------------------------

async function localStoragePut(
  relKey: string,
  data: Buffer | Uint8Array | string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const filePath = path.join(LOCAL_STORAGE_ROOT, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload =
    typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
  await fs.writeFile(filePath, payload);
  const url = `${getPublicBaseUrl()}${LOCAL_STORAGE_ROUTE}/${encodeURIComponent(key)
    .replace(/%2F/g, "/")}`;
  return { key, url };
}

function localStorageGet(relKey: string): { key: string; url: string } {
  const key = normalizeKey(relKey);
  const url = `${getPublicBaseUrl()}${LOCAL_STORAGE_ROUTE}/${encodeURIComponent(key)
    .replace(/%2F/g, "/")}`;
  return { key, url };
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  if (isUsingLocalStorage()) {
    return localStoragePut(relKey, data);
  }

  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const url = (await response.json()).url;
  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  if (isUsingLocalStorage()) {
    return localStorageGet(relKey);
  }
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  return {
    key,
    url: await buildDownloadUrl(baseUrl, key, apiKey),
  };
}

/**
 * Read the raw bytes for a stored object. Use this when a downstream
 * consumer (e.g. pdf-parse) needs the buffer in-process and you want to
 * skip the public-URL round-trip that `storageGet` -> HTTP fetch would
 * otherwise require.
 *
 * - Local fallback: reads directly from `LOCAL_STORAGE_ROOT`.
 * - Forge proxy: fetches the signed download URL once and returns the body.
 */
export async function storageReadBytes(relKey: string): Promise<Buffer> {
  const key = normalizeKey(relKey);
  if (isUsingLocalStorage()) {
    const filePath = path.join(LOCAL_STORAGE_ROOT, key);
    return fs.readFile(filePath);
  }
  const { baseUrl, apiKey } = getStorageConfig();
  const downloadUrl = await buildDownloadUrl(baseUrl, key, apiKey);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(
      `storageReadBytes: failed to fetch ${key} (${response.status} ${response.statusText})`
    );
  }
  return Buffer.from(await response.arrayBuffer());
}
