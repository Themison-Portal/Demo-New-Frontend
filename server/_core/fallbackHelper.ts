import { ENV } from "./env";

let isBackendOnlineCached: boolean | null = null;
let lastCheckTime = 0;

/**
 * Helper to identify connection/network errors when calling the FastAPI backend.
 * Returns true if the backend is offline (connection refused, timed out, etc.).
 */
export function isConnectionError(err: unknown): boolean {
  if (!err) return false;
  const errorObj = err as any;
  const msg = String(errorObj.message || "").toLowerCase();
  const code = String(errorObj.code || errorObj.cause?.code || "").toUpperCase();
  
  return (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("failed to fetch") ||
    msg.includes("network error") ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT"
  );
}

/**
 * Checks if the FastAPI backend is online, with a fast 200ms timeout.
 * Caches the result for 5 seconds to avoid spamming pings on rapid tRPC calls.
 */
export async function checkBackendOnline(): Promise<boolean> {
  const now = Date.now();
  if (isBackendOnlineCached !== null && now - lastCheckTime < 5000) {
    return isBackendOnlineCached;
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 200); // 200ms timeout
    const baseUrl = ENV.fastapiBackendUrl.replace(/\/$/, "");
    
    // Ping the root healthcheck or status of backend
    const res = await fetch(`${baseUrl}/`, { 
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });
    clearTimeout(timeoutId);
    
    isBackendOnlineCached = res.ok || res.status < 500;
  } catch (err) {
    isBackendOnlineCached = false;
  }
  
  lastCheckTime = now;
  return isBackendOnlineCached;
}

/**
 * Marks the backend cache status as offline explicitly.
 * Call this when a real API request fails with a connection error.
 */
export function setBackendOffline(): void {
  isBackendOnlineCached = false;
  lastCheckTime = Date.now();
}
