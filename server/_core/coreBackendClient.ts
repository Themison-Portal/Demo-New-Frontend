/**
 * Typed HTTP client for Themison core-backend.
 *
 * Two auth modes, picked per endpoint to match what core-backend
 * actually requires:
 *   - X-API-Key (server-to-server) for `/query`, `/upload/upload-pdf`,
 *     `/upload/status/{job_id}`. The key is `CORE_BACKEND_API_KEY` in
 *     the FE's env; same value as core-backend's `UPLOAD_API_KEY`.
 *   - Bearer JWT (per-user) for `/api/trial-documents/*`. The token is
 *     forwarded from the React client via tRPC context.authToken — we
 *     never mint or validate it here; core-backend validates against
 *     its configured AUTH0_DOMAIN/AUTH0_AUDIENCE.
 *
 * On non-2xx responses we throw `CoreBackendError` carrying the upstream
 * status + parsed body so callers (and tRPC error formatting) can
 * surface a useful message.
 */

import { Buffer } from "node:buffer";
import {
  CoreBackendError,
  type CoreBackendDocumentUpdate,
  type CoreBackendDownloadUrl,
  type CoreBackendJobStatus,
  type CoreBackendMultipartUploadInput,
  type CoreBackendQueryRequest,
  type CoreBackendQueryResponse,
  type CoreBackendTrialDocument,
  type CoreBackendUploadJobResponse,
  type CoreBackendUploadPdfRequest,
} from "@shared/coreBackendTypes";
import { ENV } from "./env";

interface ClientOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Per-request fetch timeout. Defaults to 30s. */
  timeoutMs?: number;
}

type AuthMode =
  | { kind: "apiKey" }
  | { kind: "jwt"; token: string };

const DEFAULT_TIMEOUT_MS = 30_000;

export class CoreBackendClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions = {}) {
    const baseUrl = (opts.baseUrl ?? ENV.coreBackendApiUrl ?? "").replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error(
        "CORE_BACKEND_API_URL is not configured — set it in the FE's .env to point at core-backend (e.g. http://localhost:8080)"
      );
    }
    this.baseUrl = baseUrl;
    this.apiKey = opts.apiKey ?? ENV.coreBackendApiKey ?? "";
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // X-API-Key endpoints
  // -------------------------------------------------------------------------

  async query(input: CoreBackendQueryRequest): Promise<CoreBackendQueryResponse> {
    return this.requestJson<CoreBackendQueryResponse>("POST", "/query", {
      auth: { kind: "apiKey" },
      body: input,
    });
  }

  async uploadPdf(
    input: CoreBackendUploadPdfRequest
  ): Promise<CoreBackendUploadJobResponse> {
    return this.requestJson<CoreBackendUploadJobResponse>(
      "POST",
      "/upload/upload-pdf",
      {
        auth: { kind: "apiKey" },
        body: input,
      }
    );
  }

  async getUploadStatus(jobId: string): Promise<CoreBackendJobStatus> {
    return this.requestJson<CoreBackendJobStatus>(
      "GET",
      `/upload/status/${encodeURIComponent(jobId)}`,
      { auth: { kind: "apiKey" } }
    );
  }

  // -------------------------------------------------------------------------
  // JWT endpoints (Auth0)
  // -------------------------------------------------------------------------

  async listTrialDocuments(
    trialId: string,
    jwt: string
  ): Promise<CoreBackendTrialDocument[]> {
    const path = `/api/trial-documents/?trial_id=${encodeURIComponent(trialId)}`;
    return this.requestJson<CoreBackendTrialDocument[]>("GET", path, {
      auth: { kind: "jwt", token: jwt },
    });
  }

  async getTrialDocument(
    documentId: string,
    jwt: string
  ): Promise<CoreBackendTrialDocument> {
    return this.requestJson<CoreBackendTrialDocument>(
      "GET",
      `/api/trial-documents/${encodeURIComponent(documentId)}`,
      { auth: { kind: "jwt", token: jwt } }
    );
  }

  async uploadTrialDocumentMultipart(
    input: CoreBackendMultipartUploadInput,
    jwt: string
  ): Promise<CoreBackendTrialDocument> {
    const form = new FormData();
    form.append("file", toBlob(input.file), input.filename);
    form.append("trial_id", input.trial_id);
    form.append("document_name", input.document_name);
    if (input.document_type) form.append("document_type", input.document_type);
    if (input.description) form.append("description", input.description);
    if (input.category) form.append("category", input.category);
    if (input.document_version)
      form.append("document_version", input.document_version);
    if (input.amendment_version)
      form.append("amendment_version", input.amendment_version);
    if (input.release_date) form.append("release_date", input.release_date);
    if (input.is_current !== undefined)
      form.append("is_current", String(input.is_current));
    if (input.source_type) form.append("source_type", input.source_type);
    if (input.source_reference)
      form.append("source_reference", input.source_reference);

    return this.requestJson<CoreBackendTrialDocument>(
      "POST",
      "/api/trial-documents/upload",
      {
        auth: { kind: "jwt", token: jwt },
        body: form,
      }
    );
  }

  async updateTrialDocument(
    documentId: string,
    body: CoreBackendDocumentUpdate,
    jwt: string
  ): Promise<CoreBackendTrialDocument> {
    return this.requestJson<CoreBackendTrialDocument>(
      "PUT",
      `/api/trial-documents/${encodeURIComponent(documentId)}`,
      { auth: { kind: "jwt", token: jwt }, body }
    );
  }

  async getDownloadUrl(
    documentId: string,
    jwt: string
  ): Promise<CoreBackendDownloadUrl> {
    return this.requestJson<CoreBackendDownloadUrl>(
      "GET",
      `/api/trial-documents/${encodeURIComponent(documentId)}/download-url`,
      { auth: { kind: "jwt", token: jwt } }
    );
  }

  async deleteTrialDocument(documentId: string, jwt: string): Promise<void> {
    await this.requestRaw(
      "DELETE",
      `/api/trial-documents/${encodeURIComponent(documentId)}`,
      { auth: { kind: "jwt", token: jwt } }
    );
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async requestJson<T>(
    method: string,
    path: string,
    opts: { auth: AuthMode; body?: unknown }
  ): Promise<T> {
    const res = await this.requestRaw(method, path, opts);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CoreBackendError(
        path,
        res.status,
        `core-backend ${path} returned non-JSON body: ${text.slice(0, 200)}`
      );
    }
  }

  private async requestRaw(
    method: string,
    path: string,
    opts: { auth: AuthMode; body?: unknown }
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers();

    if (opts.auth.kind === "apiKey") {
      if (!this.apiKey) {
        throw new Error(
          `CORE_BACKEND_API_KEY is not configured — required for ${method} ${path}`
        );
      }
      headers.set("X-API-Key", this.apiKey);
    } else {
      if (!opts.auth.token) {
        throw new CoreBackendError(
          path,
          401,
          "No Auth0 access token forwarded — user is not signed in"
        );
      }
      headers.set("Authorization", `Bearer ${opts.auth.token}`);
    }

    let body: BodyInit | undefined;
    if (opts.body instanceof FormData) {
      body = opts.body;
      // Let fetch set the multipart boundary.
    } else if (opts.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: controller.signal });
    } catch (err) {
      const reason =
        err instanceof Error && err.name === "AbortError"
          ? `timed out after ${this.timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err);
      throw new CoreBackendError(path, 0, `fetch failed: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const detail = await safeReadJson(res);
      throw new CoreBackendError(path, res.status, detail);
    }
    return res;
  }
}

async function safeReadJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

function toBlob(file: Blob | Uint8Array | Buffer): Blob {
  if (file instanceof Blob) return file;
  // Copy into a fresh ArrayBuffer-backed Uint8Array so the BlobPart
  // type accepts it across Node/DOM lib variants (some typings narrow
  // BlobPart to exclude SharedArrayBuffer-backed views).
  const copy = new Uint8Array(file.byteLength);
  copy.set(file);
  return new Blob([copy.buffer], { type: "application/pdf" });
}

let singleton: CoreBackendClient | null = null;

/** Lazily-constructed singleton. Call instead of `new CoreBackendClient()`. */
export function getCoreBackendClient(): CoreBackendClient {
  if (!singleton) singleton = new CoreBackendClient();
  return singleton;
}
