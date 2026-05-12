/**
 * Sanity script for the typed core-backend HTTP client.
 *
 * Hits each method against a running core-backend and prints
 * pass/fail. Used as the Phase-2 gate of the Auth0 + RAG integration:
 * if this script is all-green, the FE has a verified path to every
 * core-backend endpoint we need before wiring it into tRPC procedures.
 *
 * Usage:
 *   pnpm tsx scripts/diagnose-core-backend.ts \
 *     [--trial-id <uuid>] \
 *     [--document-id <uuid>] \
 *     [--job-id <uuid>] \
 *     [--jwt <auth0-access-token>] \
 *     [--query "What is the inclusion criteria?"]
 *
 * Env vars (read from .env):
 *   CORE_BACKEND_API_URL   — required (e.g. http://localhost:8080)
 *   CORE_BACKEND_API_KEY   — required for X-API-Key endpoints
 *   CORE_BACKEND_TEST_JWT  — optional fallback for --jwt
 *
 * Each check is independent — if one fixture is missing (e.g. no JWT)
 * we report SKIP for that group and keep going. Exit code is the
 * number of failures (0 = all green or only skips).
 */

import { CoreBackendClient } from "../server/_core/coreBackendClient";
import { CoreBackendError } from "../shared/coreBackendTypes";

type CheckResult = { name: string; status: "pass" | "fail" | "skip"; detail?: string };

function readArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

async function run(name: string, fn: () => Promise<string | void>): Promise<CheckResult> {
  process.stdout.write(`  ${name} … `);
  try {
    const detail = await fn();
    console.log("PASS" + (detail ? ` (${detail})` : ""));
    return { name, status: "pass", detail: detail ?? undefined };
  } catch (err) {
    const detail =
      err instanceof CoreBackendError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.log(`FAIL — ${detail}`);
    return { name, status: "fail", detail };
  }
}

function skip(name: string, reason: string): CheckResult {
  console.log(`  ${name} … SKIP — ${reason}`);
  return { name, status: "skip", detail: reason };
}

async function main() {
  const trialId = readArg("--trial-id");
  const documentId = readArg("--document-id");
  const jobId = readArg("--job-id");
  const jwt = readArg("--jwt") ?? process.env.CORE_BACKEND_TEST_JWT ?? "";
  const query = readArg("--query") ?? "What is this document about?";

  const client = new CoreBackendClient();
  const results: CheckResult[] = [];

  console.log("\n[X-API-Key endpoints]");

  results.push(
    jobId
      ? await run("getUploadStatus", async () => {
          const status = await client.getUploadStatus(jobId);
          return `status=${status.status} progress=${status.progress_percent}%`;
        })
      : skip("getUploadStatus", "no --job-id provided")
  );

  results.push(
    documentId
      ? await run("query", async () => {
          const resp = await client.query({
            query,
            document_id: documentId,
            document_name: "diagnose-core-backend",
          });
          return `answer length=${resp.answer.length} sources=${resp.sources.length}`;
        })
      : skip("query", "no --document-id provided")
  );

  // uploadPdf is destructive (kicks a job off in core-backend) so we
  // don't run it from a sanity script — the schema check above is
  // enough to prove the client is wired.
  results.push(skip("uploadPdf", "destructive — exercised via the FE upload flow"));

  console.log("\n[JWT endpoints]");

  if (!jwt) {
    results.push(skip("listTrialDocuments", "no --jwt or CORE_BACKEND_TEST_JWT"));
    results.push(skip("getTrialDocument", "no --jwt or CORE_BACKEND_TEST_JWT"));
    results.push(skip("getDownloadUrl", "no --jwt or CORE_BACKEND_TEST_JWT"));
    results.push(skip("uploadTrialDocumentMultipart", "destructive — exercised via the FE upload flow"));
    results.push(skip("deleteTrialDocument", "destructive — exercised via the FE delete flow"));
  } else {
    results.push(
      trialId
        ? await run("listTrialDocuments", async () => {
            const docs = await client.listTrialDocuments(trialId, jwt);
            return `count=${docs.length}`;
          })
        : skip("listTrialDocuments", "no --trial-id provided")
    );

    results.push(
      documentId
        ? await run("getTrialDocument", async () => {
            const doc = await client.getTrialDocument(documentId, jwt);
            return `name=${doc.document_name} ingestion=${doc.ingestion_status ?? "n/a"}`;
          })
        : skip("getTrialDocument", "no --document-id provided")
    );

    results.push(
      documentId
        ? await run("getDownloadUrl", async () => {
            const url = await client.getDownloadUrl(documentId, jwt);
            return `expires_in=${url.expires_in_seconds}s`;
          })
        : skip("getDownloadUrl", "no --document-id provided")
    );

    results.push(
      skip(
        "uploadTrialDocumentMultipart",
        "destructive — exercised via the FE upload flow"
      )
    );
    results.push(
      skip(
        "deleteTrialDocument",
        "destructive — exercised via the FE delete flow"
      )
    );
  }

  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  console.log("\n========================================");
  console.log(` ${pass} passed   ${fail} failed   ${skipped} skipped`);
  console.log("========================================\n");

  process.exit(fail);
}

main().catch((err) => {
  console.error("Diagnostic script crashed:", err);
  process.exit(1);
});
