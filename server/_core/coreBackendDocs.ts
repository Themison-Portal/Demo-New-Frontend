/**
 * Shared helpers for talking to the BE's trial-documents API from the BFF.
 *
 * Documents are owned by the BE (`trial_documents` in Postgres); the FE
 * `protocols` table is retired. Trials are BE-owned too and identified by their
 * UUID — there is no slug resolution, so these document paths don't touch FE
 * MySQL at all.
 */

import { getDb } from "../db";
import { type DemoMode } from "./demoMode";
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
 * Validate a client trial id. Trials are identified solely by their BE UUID
 * now (slugs are gone), so this is an identity check: a well-formed UUID
 * resolves to itself; anything else returns null so read paths return an empty
 * list rather than calling the BE with a bad id. `mode` is retained in the
 * signature for the ~11 callers but is no longer used for resolution.
 */
export async function resolveBeTrialIdForRead(
    _mode: DemoMode,
    trialId: string
): Promise<string | null> {
    if (UUID_RE.test(trialId)) return trialId;
    console.warn(
        `[coreBackendDocs] Non-UUID trial id "${trialId}" — trials are UUID-only now; ignoring.`
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
