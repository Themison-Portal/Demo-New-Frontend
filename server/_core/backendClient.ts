import { ENV } from "./env";
import type { User } from "../../drizzle/schema";

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  user?: User | null;
};

export async function callBackend<T = any>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const method = options.method ?? "GET";
  const baseUrl = ENV.fastapiBackendUrl.replace(/\/$/, "");
  const cleanPath = path.replace(/^\//, "");
  
  // Format query parameters
  let url = `${baseUrl}/${cleanPath}`;
  if (options.query) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  // Construct headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Attach trusted proxy headers based on tRPC user context
  const email = options.user?.email || "test@themison.com";
  const name = options.user?.name || "Demo User";
  
  headers["x-user-email"] = email;
  headers["x-user-name"] = name;

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (options.body !== undefined && method !== "GET") {
    fetchOptions.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (error) {
    // A network-level failure (DNS, connection refused, unreachable host)
    // throws a bare "fetch failed" with no URL. Surface the target so a
    // misconfigured backend URL is obvious instead of cryptic.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach core-backend at ${url} (${message}). ` +
        `Check NEXT_PUBLIC_API_URL points at a reachable backend.`
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(`[Backend Client] Request to ${url} failed with status ${response.status}:`, errorText);
    throw new Error(
      `Backend request failed (${response.status} ${response.statusText}): ${errorText || "No response body"}`
    );
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}
