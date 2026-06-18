/**
 * Shared helpers for talking to the BE's trial-documents API from the BFF.
 *
 * Documents are owned by the BE (`trial_documents` in Postgres); the FE
 * `protocols` table is retired. Trials are BE-owned too — the client's slug is
 * resolved to the BE trial UUID via the BE `by-slug` endpoint (no FE MySQL
 * `trials` read), so these document paths no longer touch FE MySQL at all.
 */

import { getDb } from "../db";
import { type DemoMode } from "./demoMode";
import { callBackend } from "./backendClient";
import type { CoreBackendTrialDocument } from "@shared/coreBackendTypes";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Token for the BE's JWT-protected document endpoints. Under AUTH_DISABLED the
 * BE mocks the demo member and never inspects the token, so a placeholder is
 * fine; a real Auth0 token is forwarded when present on the tRPC context.
 */
export function authTokenFrom(ctx: unknown): string {
  const token = (ctx as { authToken?: string } | null)?.authToken;
  return token || "auth-disabled-bypass";
}

/**
 * Resolve the BE trial UUID for a client trial id (bare slug or BE UUID),
 * WITHOUT provisioning a BE trial. Returns null when there is no BE trial, so
 * read paths return an empty list rather than creating one.
 *  - A bare BE UUID resolves to itself.
 *  - Otherwise the slug (+ demo_mode) is resolved via the BE `by-slug` endpoint.
 *  - No BE trial for that slug/mode → null.
 */
export async function resolveBeTrialIdForRead(
  db: Db,
  mode: DemoMode,
  trialId: string
): Promise<string | null> {
  // 1. A bare-UUID trial id already IS the BE trial UUID (wizard docs uploaded
  //    directly under the BE trial UUID).
  if (UUID_RE.test(trialId)) return trialId;
  // 2. Trials are BE-owned: resolve the client's slug (+ demo_mode) via the BE.
  //    This is the primary path for BE-native trials (no FE `trials` row). Try
  //    with the demo_mode first (disambiguates colliding sample/full slugs like
  //    "1"); if that misses (e.g. a caller that didn't pass demoMode), retry on
  //    the slug alone — safe for the unique wizard/building slugs.
  for (const q of [{ slug: trialId, demo_mode: mode }, { slug: trialId }]) {
    try {
      const t = await callBackend<any>(`/api/trials/by-slug`, { query: q });
      if (t?.id) return t.id;
    } catch {
      /* not found for this query — try the next, then the FE mapping */
    }
  }
  // No BE trial for this slug/mode. The FE `trials` table is retired, so there
  // is no further fallback — the trial simply isn't in the BE.
  console.warn(
    `[coreBackendDocs] No BE trial for "${trialId}" (mode=${mode}). ` +
      `Documents for this trial cannot be listed from the BE.`
  );
  return null;
}

/**
 * Map a BE `trial_documents` row to the shape the FE document-hub UI expects
 * (the legacy FE `protocols` row shape + computed index status). `id` is the BE
 * document UUID — the FE document identity post-retirement.
 */
export function mapBeDoc(d: CoreBackendTrialDocument) {
  const ingest = d.ingestion_status;
  const isIndexed = ingest === "ready" || ingest === "complete";
  const indexStatus: "indexed" | "processing" | "failed" = isIndexed
    ? "indexed"
    : ingest === "failed" || ingest === "error"
      ? "failed"
      : "processing";
  return {
    id: d.id,
    coreBackendDocumentId: d.id,
    trialId: d.trial_id,
    filename: d.document_name,
    fileUrl: d.document_url,
    category: d.category ?? d.document_type,
    documentType: d.document_type,
    documentVersion: d.document_version,
    amendmentVersion: d.amendment_version,
    releaseDate: d.release_date,
    isCurrent: d.is_current ?? false,
    archivedAt: d.archived_at,
    sourceType: d.source_type,
    sourceReference: d.source_reference,
    fileSize: d.file_size,
    uploadedBy: d.uploaded_by,
    uploaderName: d.uploaded_by_name || "Unknown",
    description: d.description,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    ingestionStatus: d.ingestion_status,
    isIndexed,
    indexStatus,
    indexFailureReason:
      indexStatus === "failed"
        ? "core-backend ingestion failed. Retry processing."
        : null,
    indexUpdatedAt: d.updated_at,
    contextIndexed: isIndexed,
    contextChunkCount: 0,
  };
}
