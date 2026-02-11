import { getDb } from "../server/db";
import { runUnifiedQueryDiagnostics } from "../server/_core/unifiedQuery";

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function parseIntArg(flag: string) {
  const value = readArg(flag);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main() {
  const query = readArg("--query");
  const trialId = readArg("--trialId");
  const protocolId = parseIntArg("--protocolId");
  const pretty = readArg("--pretty") !== "false";

  if (!query) {
    console.error("Missing --query");
    process.exit(1);
  }
  if (!trialId && !protocolId) {
    console.error("Provide either --trialId or --protocolId");
    process.exit(1);
  }

  const db = await getDb();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }

  const diagnostics = await runUnifiedQueryDiagnostics({
    db,
    query,
    trialId,
    protocolIds: protocolId ? [protocolId] : undefined,
  });

  const output = {
    query: diagnostics.query,
    plan: diagnostics.plan,
    route: diagnostics.route,
    protocols: diagnostics.protocols.map((row) => ({
      protocolId: row.protocolId,
      filename: row.filename,
      category: row.category,
      isCurrent: row.isCurrent,
    })),
    retrieval: {
      hints: diagnostics.retrieval.hints,
      candidateCount: diagnostics.retrieval.candidateCount,
      selectedCount: diagnostics.retrieval.selectedCount,
      topCandidates: diagnostics.retrieval.candidates.slice(0, 20),
    },
    parserPages: diagnostics.parserPages,
    chunkCoverage: diagnostics.chunkCoverage.slice(0, 20),
    deterministicPreview: diagnostics.deterministicPreview,
    answer: {
      confidence: diagnostics.answer.confidence,
      abstained: diagnostics.answer.abstained,
      abstainReason: diagnostics.answer.abstainReason,
      message: diagnostics.answer.message,
    },
  };

  console.log(JSON.stringify(output, null, pretty ? 2 : 0));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
