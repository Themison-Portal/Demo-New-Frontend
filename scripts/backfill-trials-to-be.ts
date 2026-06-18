/**
 * One-time backfill: copy the FE MySQL `trials` rows into the BE so trials
 * become BE-owned (Phase E step 2 of the trials migration).
 *
 * For each FE trial it derives `slug` (the bare id) + `demo_mode` (the id
 * prefix), maps every FE field onto the BE trial, and:
 *   - PUTs onto the existing BE trial when the FE row already has a
 *     `coreBackendTrialId` (or one is found by slug), OR
 *   - POSTs a new BE trial and writes its UUID back to `trials.coreBackendTrialId`.
 *
 * Idempotent / re-runnable. Must run BEFORE deploying the Phase B FE code
 * (otherwise the BE has no demo_mode trials and the list shows empty).
 *
 * Run from the FE repo:
 *   corepack pnpm exec tsx scripts/backfill-trials-to-be.ts
 * Requires env: DATABASE_URL (FE MySQL) + CORE_BACKEND_API_URL / FASTAPI_BACKEND_URL
 * (the BE, which must be on the new schema with demo_mode/slug + AUTH_DISABLED=true).
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { trials } from "../drizzle/schema";
import { callBackend } from "../server/_core/backendClient";

// FE UI statuses -> BE CHECK (planning|active|completed|paused|cancelled).
const FE_TO_BE_STATUS: Record<string, string> = {
  "not-started": "planning",
  recruiting: "active",
  "on-hold": "paused",
  terminated: "cancelled",
};
function beStatus(s: string | null | undefined): string {
  if (!s) return "planning";
  return FE_TO_BE_STATUS[s] ?? s;
}

function parseId(id: string): { slug: string; demoMode: string | null } {
  const i = id.indexOf(":");
  if (i < 0) return { slug: id, demoMode: null };
  return { demoMode: id.slice(0, i), slug: id.slice(i + 1) };
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  try {
    return new Date(v as any).toISOString();
  } catch {
    return null;
  }
}

function feTrialToBeBody(t: any, slug: string, demoMode: string | null) {
  return {
    slug,
    demo_mode: demoMode,
    name: t.title || "Untitled Trial",
    phase: t.phase || "Phase I",
    location: t.location || "",
    sponsor: t.sponsor || "",
    status: beStatus(t.status),
    description: t.description ?? null,
    indication: t.indication ?? null,
    study_start: toIso(t.startDate),
    estimated_close_out: toIso(t.endDate),
    protocol_number: t.protocolNumber ?? null,
    investigational_product: t.investigationalProduct ?? null,
    nct_number: t.nctNumber ?? null,
    current_version: t.currentVersion ?? null,
    amendment_version: t.amendmentVersion ?? null,
    release_date: t.releaseDate ?? null,
    sample_size: t.sampleSize ?? null,
    number_of_sites: t.numberOfSites ?? null,
    study_duration: t.studyDuration ?? null,
    study_design_type: t.studyDesignType ?? null,
    primary_objective: t.primaryObjective ?? null,
    primary_endpoint: t.primaryEndpoint ?? null,
    principal_investigator: t.principalInvestigator ?? null,
    enrolled_patients: t.enrolledPatients ?? null,
    target_patients: t.targetPatients ?? null,
    completion_percentage: t.completionPercentage ?? null,
  };
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("FE DB not available — set DATABASE_URL");

  const rows = await db.select().from(trials);
  console.log(`[backfill-trials] ${rows.length} FE trial(s) to process.`);

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const t of rows as any[]) {
    const { slug, demoMode } = parseId(String(t.id));
    const body = feTrialToBeBody(t, slug, demoMode);
    try {
      // Resolve an existing BE trial: explicit mapping wins, else look up by slug
      // (covers a prior partial run that created the trial but didn't persist cb).
      let beId: string | null = t.coreBackendTrialId ?? null;
      if (!beId) {
        try {
          const found: any = await callBackend(`/api/trials/by-slug`, {
            query: { slug, demo_mode: demoMode ?? undefined },
          });
          if (found?.id) beId = found.id;
        } catch {
          /* not found — will create */
        }
      }

      if (beId) {
        await callBackend(`/api/trials/${beId}`, { method: "PUT", body });
        if (!t.coreBackendTrialId) {
          await db.update(trials).set({ coreBackendTrialId: beId }).where(eq(trials.id, t.id));
        }
        updated++;
        console.log(`  ↻ ${t.id}  (slug=${slug} mode=${demoMode ?? "—"}) -> ${beId}`);
      } else {
        const beTrial: any = await callBackend(`/api/trials/with-assignments`, {
          method: "POST",
          body: { ...body, members: [], pending_members: [] },
        });
        await db
          .update(trials)
          .set({ coreBackendTrialId: beTrial.id })
          .where(eq(trials.id, t.id));
        created++;
        console.log(`  + ${t.id}  (slug=${slug} mode=${demoMode ?? "—"}) -> ${beTrial.id}`);
      }
    } catch (e: any) {
      failed++;
      console.error(`  ✗ ${t.id} (slug=${slug} mode=${demoMode ?? "—"}): ${e?.message || e}`);
    }
  }

  console.log(
    `[backfill-trials] Done. created=${created} updated=${updated} failed=${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[backfill-trials] fatal:", e);
  process.exit(1);
});
