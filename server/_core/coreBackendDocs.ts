/**
 * Shared helpers for talking to the BE's trial-documents API from the BFF.
 *
 * Documents are owned by the BE (`trial_documents` in Postgres); the FE
 * `protocols` table is retired. Trials stay FE-owned, so resolving an FE trial
 * id to the BE trial UUID (`trials.coreBackendTrialId`) is the one MySQL read
 * the document paths still need.
 */

import { eq } from "drizzle-orm";
import { trials } from "../../drizzle/schema";
import { getDb } from "../db";
import { resolveTrialId, type DemoMode } from "./demoMode";
import type { CoreBackendTrialDocument } from "@shared/coreBackendTypes";

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
 * Resolve the BE trial UUID for a (demo-prefixed or real) FE trial id, WITHOUT
 * provisioning a BE trial. Returns null when there is no BE trial yet, so read
 * paths return an empty list rather than creating one.
 *  - An explicit `trials.coreBackendTrialId` mapping always wins.
 *  - A real (non-demo) trial's `resolvedTrialId` already IS the BE UUID.
 *  - Demo/building trials with no mapping yet → null.
 */
export async function resolveBeTrialIdForRead(
  db: Db,
  mode: DemoMode,
  trialId: string
): Promise<string | null> {
  const resolvedTrialId = await resolveTrialId(db, mode, trialId, mode !== "building");
  const [row] = await db
    .select({ cb: trials.coreBackendTrialId })
    .from(trials)
    .where(eq(trials.id, resolvedTrialId))
    .limit(1);
  if (row?.cb) return row.cb;
  // A bare-UUID trial id IS the BE trial UUID for a real trial — use it
  // REGARDLESS of demo mode, whether or not a FE mirror row exists or has the
  // mapping populated. This crucially covers wizard ("building") mode, where the
  // FE passes the BE trial UUID directly but `resolveTrialId` prefixes it to
  // "building:<uuid>" (no FE row) — so we must prefer the bare INPUT id. (The
  // previous version excluded building mode and checked the prefixed resolved id,
  // so a real trial's BE documents silently vanished from the Hub.)
  const UUID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (UUID_RE.test(trialId)) return trialId;
  if (!resolvedTrialId.includes(":") && UUID_RE.test(resolvedTrialId)) {
    return resolvedTrialId;
  }
  console.warn(
    `[coreBackendDocs] No BE trial mapping for FE trial "${trialId}" ` +
      `(mode=${mode}, resolved=${resolvedTrialId}, hasRow=${!!row}, cb=${row?.cb ?? null}). ` +
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
