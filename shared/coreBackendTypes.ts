/**
 * Type definitions for Themison core-backend's REST API.
 *
 * These mirror the Pydantic contracts in
 * `core-backend.V4/app/contracts/document.py` and the route response
 * shapes in `app/api/routes/upload.py` and `app/api/routes/query.py`.
 *
 * Keep this file in sync when core-backend's contracts change. Treat
 * any drift here as a build error — the consequence is silent runtime
 * mismatches with no schema-level enforcement.
 */

// ---------------------------------------------------------------------------
// Document — mirrors `DocumentResponse` from app/contracts/document.py
// ---------------------------------------------------------------------------

export type IngestionStatus = "queued" | "processing" | "ready" | "failed" | null;

export interface CoreBackendTrialDocument {
  id: string;                            // UUID
  document_name: string;
  document_type: string;                 // enum: 'protocol' | 'icf' | etc.
  document_url: string;                  // GCS blob path (NOT a download URL — call /download-url)
  trial_id: string | null;               // UUID
  uploaded_by: string | null;            // UUID (member_id)
  status: string | null;                 // 'active' | 'archived' | etc.
  ingestion_status: IngestionStatus;     // RAG pipeline state
  file_size: number | null;
  mime_type: string | null;
  version: number | null;
  amendment_number: number | null;
  is_latest: boolean | null;
  description: string | null;
  tags: string[] | null;
  warning: boolean | null;
  created_at: string;                    // ISO timestamp
  updated_at: string | null;             // ISO timestamp
}

// ---------------------------------------------------------------------------
// /query — mirrors POST /query response shape
// ---------------------------------------------------------------------------

export interface CoreBackendQueryRequest {
  query: string;
  document_id: string;
  document_name: string;
}

/**
 * Loose type for the source citation. Core-backend's RAG service emits
 * highlighted-bbox metadata; we type the structurally-known fields and
 * leave the rest open. Refine as the FE consumes more of it.
 */
export interface CoreBackendQuerySource {
  name: string;
  page: number;
  section?: string;
  /**
   * Verbatim quote from the chunk. Core-backend returns it as camelCase
   * `exactText` (the LLM is instructed to emit JSON with that exact
   * field name; see core-backend `rag_generation_service.py` SYSTEM_PROMPT).
   */
  exactText?: string;
  bboxes?: number[][];
  relevance?: "high" | "medium" | "low" | string;
  [key: string]: unknown;
}

export interface CoreBackendQueryResponse {
  /**
   * The generated answer text. Core-backend returns this as `response`
   * (NOT `answer`) — the field name comes from the JSON schema the
   * Claude SYSTEM_PROMPT pins in `rag_generation_service.py` and the
   * `DoclingRagStructuredResponse` Pydantic model.
   */
  response: string;
  sources: CoreBackendQuerySource[];
  // Other fields the response may include (timing, metadata) — leave open.
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// /upload/upload-pdf — mirrors UploadJobResponse
// ---------------------------------------------------------------------------

export interface CoreBackendUploadPdfRequest {
  document_url: string;                  // GCS blob path or absolute HTTP(S) URL
  document_id: string;                   // must already exist in trial_documents
  chunk_size?: number;                   // default 750
}

export interface CoreBackendUploadJobResponse {
  job_id: string;
  document_id: string;
  status: "queued" | string;
  message: string;
}

// ---------------------------------------------------------------------------
// /upload/status/{job_id} — mirrors JobStatusResponse
// ---------------------------------------------------------------------------

export type CoreBackendJobStatusValue =
  | "queued"
  | "processing"
  | "complete"
  | "error"
  | string;

export interface CoreBackendJobStatus {
  job_id: string;
  document_id: string;
  status: CoreBackendJobStatusValue;
  progress_percent: number;
  current_stage: string;                 // e.g. 'parsing', 'embedding', 'storing'
  message: string;
  result: Record<string, unknown> | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// /api/trial-documents/{id}/download-url — mirrors DocumentDownloadUrlResponse
// ---------------------------------------------------------------------------

export interface CoreBackendDownloadUrl {
  url: string;
  expires_in_seconds: number;
}

// ---------------------------------------------------------------------------
// Multipart upload to /api/trial-documents/upload — JWT-protected
// ---------------------------------------------------------------------------

export interface CoreBackendMultipartUploadInput {
  /** PDF bytes. Either a Buffer (Node) or a Blob/File (browser). */
  file: Blob | Uint8Array | Buffer;
  /** Filename used for the multipart `file` field. */
  filename: string;
  trial_id: string;                      // UUID
  document_name: string;
  document_type?: string;                // default 'other' on the BE side
  description?: string;
}

// ---------------------------------------------------------------------------
// Standardised client errors
// ---------------------------------------------------------------------------

export class CoreBackendError extends Error {
  readonly status: number;
  readonly path: string;
  readonly detail: unknown;

  constructor(path: string, status: number, detail: unknown) {
    const message = typeof detail === "string"
      ? detail
      : (detail && typeof detail === "object" && "detail" in detail
          ? String((detail as { detail: unknown }).detail)
          : `core-backend ${path} returned ${status}`);
    super(message);
    this.name = "CoreBackendError";
    this.status = status;
    this.path = path;
    this.detail = detail;
  }
}
