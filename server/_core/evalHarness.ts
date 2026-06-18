import { getStructuredEligibilityCriteria, getStructuredScheduleOfActivities } from "./protocolContext";
import { runUnifiedQueryDiagnostics, type UnifiedRoute } from "./unifiedQuery";

export type EvalCaseKind =
  | "criteria"
  | "schedule"
  | "general"
  | "visit_procedures"
  | "scheduling"
  | "special_requirements"
  | "eligibility"
  | "safety"
  | "dosing"
  | "cross_document"
  | "abstention";

export type EvalCaseInput = {
  id: string;
  query: string;
  kind: EvalCaseKind;
  category?: string;
  mustContain?: string[];
  mustNotContain?: string[];
  mustCite?: boolean | string[];
  mustReference?: string;
  mustStartWithYesOrNo?: boolean;
  mustContainNumber?: boolean;
  mustContainTimeframe?: boolean;
  expectedCount?: number;
  useStructuredExpectedCount?: boolean;
  mustListAll?: boolean;
  retrievalMustContain?: string[];
  mustNotHallucinate?: boolean;
  shouldAbstain?: boolean;
};

export type EvalCaseResult = {
  id: string;
  query: string;
  kind: EvalCaseKind;
  category: string;
  route: UnifiedRoute;
  retrievalQualityScore: number;
  retrievalHit: number;
  answerCorrectness: number;
  citationOk: boolean;
  citationPresent: number;
  noHallucination: number;
  expectedListItems: number | null;
  observedListItems: number;
  completenessRatio: number | null;
  abstained: boolean;
  notes: string[];
};

export type EvalHarnessReport = {
  generatedAt: string;
  trialId: string | null;
  protocolIds: string[];
  totals: {
    cases: number;
    passed: number;
    failed: number;
    abstained: number;
  };
  metrics: {
    retrievalPrecisionAtKProxy: number;
    criteriaCompleteness: number | null;
    scheduleCompleteness: number | null;
    citationCorrectness: number;
    retrievalHitRate: number;
    answerCorrectness: number;
    citationRate: number;
    hallucinationRate: number;
    listCompleteness: number | null;
  };
  targets: {
    retrievalHitRate: number;
    answerCorrectness: number;
    citationRate: number;
    hallucinationRateMax: number;
    listCompleteness: number;
  };
  cases: EvalCaseResult[];
};

const DEFAULT_EVAL_CASES: EvalCaseInput[] = [
  {
    id: "visit.procedures_v3",
    query: "What procedures are required at Visit 3?",
    kind: "visit_procedures",
    category: "visit_procedures",
    mustContain: ["visit"],
    mustCite: true,
    mustContainNumber: true,
    mustListAll: true,
    useStructuredExpectedCount: true,
    retrievalMustContain: ["visit 3", "schedule"],
  },
  {
    id: "visit.screening_blood_tests",
    query: "What blood tests are done at screening?",
    kind: "visit_procedures",
    category: "visit_procedures",
    mustContain: ["screening"],
    mustCite: true,
    mustNotContain: ["usually", "typically", "generally"],
    retrievalMustContain: ["screening", "blood"],
  },
  {
    id: "schedule.visit_window_v3",
    query: "What is the visit window for Visit 3?",
    kind: "scheduling",
    category: "scheduling",
    mustContain: ["visit 3"],
    mustCite: true,
    mustContainNumber: true,
    retrievalMustContain: ["visit window", "visit 3"],
  },
  {
    id: "schedule.days_between",
    query: "How many days between Visit 2 and Visit 3?",
    kind: "scheduling",
    category: "scheduling",
    mustContainNumber: true,
    mustCite: true,
    retrievalMustContain: ["visit 2", "visit 3"],
  },
  {
    id: "special.fasting_v3",
    query: "Does the patient need to fast before Visit 3?",
    kind: "special_requirements",
    category: "special_requirements",
    mustStartWithYesOrNo: true,
    mustContain: ["fast"],
    mustCite: true,
    retrievalMustContain: ["fast", "visit 3"],
  },
  {
    id: "eligibility.inclusion",
    query: "What are the inclusion criteria?",
    kind: "eligibility",
    category: "eligibility",
    mustCite: true,
    mustListAll: true,
    useStructuredExpectedCount: true,
    retrievalMustContain: ["inclusion", "criteria"],
  },
  {
    id: "eligibility.seizure_history",
    query: "Can a patient with a history of seizures participate?",
    kind: "eligibility",
    category: "eligibility",
    mustReference: "exclusion",
    mustCite: true,
    retrievalMustContain: ["seizure", "exclusion"],
  },
  {
    id: "safety.sae_reporting",
    query: "How quickly must a serious adverse event be reported?",
    kind: "safety",
    category: "safety",
    mustContainTimeframe: true,
    mustCite: true,
    retrievalMustContain: ["serious adverse event", "report"],
  },
  {
    id: "dosing.schedule",
    query: "What is the dosing schedule for the study drug?",
    kind: "dosing",
    category: "dosing",
    mustContain: ["dose"],
    mustCite: true,
    retrievalMustContain: ["dosing", "study drug"],
  },
  {
    id: "cross_document.cbc_tube",
    query: "What tube type is needed for CBC at Visit 3?",
    kind: "cross_document",
    category: "cross_document",
    mustNotContain: ["i don't have enough information", "insufficient evidence"],
    mustCite: true,
    retrievalMustContain: ["cbc", "visit 3"],
  },
  {
    id: "abstention.parking",
    query: "What is the site's parking situation?",
    kind: "abstention",
    category: "abstention",
    shouldAbstain: true,
    mustNotHallucinate: true,
  },
  {
    id: "abstention.pi_phone",
    query: "What is the investigator's phone number?",
    kind: "abstention",
    category: "abstention",
    shouldAbstain: true,
    mustNotHallucinate: true,
  },
];

type EvalStructuredCache = {
  criteria: Array<Awaited<ReturnType<typeof getStructuredEligibilityCriteria>>>;
  schedules: Array<Awaited<ReturnType<typeof getStructuredScheduleOfActivities>>>;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function countListItems(text: string) {
  const numbered = text.match(/^\s*\d+[\).]\s+/gm)?.length ?? 0;
  const bullets = text.match(/^\s*[-•]\s+/gm)?.length ?? 0;
  return Math.max(numbered, bullets);
}

function hasDocumentCitation(text: string) {
  return /\[Source:\s*[^,\]]+,\s*(p|pp)\./i.test(text);
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toCategory(testCase: EvalCaseInput) {
  return testCase.category || testCase.kind;
}

function normalize(value: string) {
  return String(value || "").toLowerCase();
}

function extractVisitIntentKey(query: string) {
  const raw = normalize(query);
  const visitMatch = raw.match(/\bvisit\s*(\d+)\b/);
  if (visitMatch?.[1]) return `visit ${visitMatch[1]}`;
  if (/\bscreening\b/.test(raw)) return "screening";
  if (/\bbaseline\b/.test(raw)) return "baseline";
  if (/\bfollow[\s-]?up\b/.test(raw)) return "follow up";
  if (/\bend of treatment\b|\beot\b/.test(raw)) return "end of treatment";
  return null;
}

function inferExpectedVisitProcedureCount(
  query: string,
  schedules: Array<Awaited<ReturnType<typeof getStructuredScheduleOfActivities>>>
) {
  const visitNeedle = extractVisitIntentKey(query);
  if (!visitNeedle) return null;
  let best = 0;
  for (const schedule of schedules) {
    if (!schedule) continue;
    const visitLabels = schedule.visits.map((visit) => `${visit.name}${visit.day ? ` (${visit.day})` : ""}`);
    const matchingVisits = new Set(
      visitLabels.filter((label) => {
        const hay = normalize(label);
        return hay.includes(visitNeedle) || visitNeedle.includes(hay);
      })
    );
    if (matchingVisits.size === 0) continue;
    const count = schedule.entries.filter(
      (entry) =>
        entry.required &&
        Array.from(matchingVisits).some((label) => {
          const hay = normalize(entry.visit);
          const needle = normalize(label);
          return hay.includes(needle) || needle.includes(hay);
        })
    ).length;
    best = Math.max(best, count);
  }
  return best > 0 ? best : null;
}

function inferExpectedListSize(
  testCase: EvalCaseInput,
  cache: EvalStructuredCache
) {
  if (typeof testCase.expectedCount === "number" && testCase.expectedCount > 0) {
    return testCase.expectedCount;
  }
  if (!testCase.useStructuredExpectedCount) return null;

  if (testCase.kind === "criteria" || testCase.kind === "eligibility") {
    const rows = cache.criteria.filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (rows.length === 0) return null;
    const wantsInclusion = /\binclusion\b/i.test(testCase.query);
    const wantsExclusion = /\bexclusion\b/i.test(testCase.query);
    if (wantsInclusion) return Math.max(...rows.map((row) => row.inclusion.length), 0);
    if (wantsExclusion) return Math.max(...rows.map((row) => row.exclusion.length), 0);
    return Math.max(...rows.map((row) => row.inclusion.length + row.exclusion.length), 0);
  }

  if (
    testCase.kind === "schedule" ||
    testCase.kind === "visit_procedures" ||
    testCase.kind === "scheduling" ||
    testCase.kind === "special_requirements"
  ) {
    const schedules = cache.schedules.filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (schedules.length === 0) return null;
    const visitSpecific = inferExpectedVisitProcedureCount(testCase.query, schedules);
    if (visitSpecific) return visitSpecific;
    return Math.min(Math.max(...schedules.map((row) => row.entries.length), 0), 32);
  }

  return null;
}

function containsAny(text: string, terms: string[]) {
  const hay = normalize(text);
  return terms.some((term) => hay.includes(normalize(term)));
}

function containsAll(text: string, terms: string[]) {
  const hay = normalize(text);
  return terms.every((term) => hay.includes(normalize(term)));
}

function resolveRetrievalTerms(testCase: EvalCaseInput) {
  if (testCase.retrievalMustContain && testCase.retrievalMustContain.length > 0) {
    return testCase.retrievalMustContain;
  }
  if (testCase.mustContain && testCase.mustContain.length > 0) {
    return testCase.mustContain.slice(0, 3);
  }
  const rawTokens = normalize(testCase.query)
    .split(/\s+/)
    .filter((token) => token.length > 3)
    .filter(
      (token) =>
        ![
          "what",
          "which",
          "when",
          "where",
          "with",
          "from",
          "that",
          "this",
          "does",
          "need",
          "must",
          "have",
          "list",
        ].includes(token)
    );
  return Array.from(new Set(rawTokens)).slice(0, 3);
}

function computeRetrievalHit(testCase: EvalCaseInput, candidates: Array<{ excerpt: string; sectionTitle: string | null; chunkType: string | null }>) {
  if (candidates.length === 0) return 0;
  const terms = resolveRetrievalTerms(testCase);
  if (terms.length === 0) return 1;
  const hayByCandidate = candidates.map((candidate) =>
    normalize(`${candidate.excerpt} ${candidate.sectionTitle || ""} ${candidate.chunkType || ""}`)
  );
  const hit = terms.every((term) => hayByCandidate.some((hay) => hay.includes(normalize(term))));
  return hit ? 1 : 0;
}

function evaluateAnswer(testCase: EvalCaseInput, answerText: string, expectedListItems: number | null, docEvidenceExists: boolean) {
  const notes: string[] = [];
  const checks: boolean[] = [];

  const mustContain = testCase.mustContain || [];
  for (const term of mustContain) {
    const ok = containsAll(answerText, [term]);
    checks.push(ok);
    if (!ok) notes.push(`Missing required term: "${term}".`);
  }

  const mustNotContain = testCase.mustNotContain || [];
  for (const term of mustNotContain) {
    const ok = !containsAny(answerText, [term]);
    checks.push(ok);
    if (!ok) notes.push(`Contains forbidden term: "${term}".`);
  }

  if (testCase.mustReference) {
    const ok = containsAll(answerText, [testCase.mustReference]);
    checks.push(ok);
    if (!ok) notes.push(`Missing required reference: "${testCase.mustReference}".`);
  }

  if (testCase.mustStartWithYesOrNo) {
    const ok = /^\s*(yes|no)\b/i.test(answerText);
    checks.push(ok);
    if (!ok) notes.push("Answer does not start with Yes/No.");
  }

  if (testCase.mustContainNumber) {
    const ok = /\b\d+\b/.test(answerText);
    checks.push(ok);
    if (!ok) notes.push("Expected at least one numeric value in answer.");
  }

  if (testCase.mustContainTimeframe) {
    const ok = /\b(within\s+\d+\s*(hours?|days?)|\d+\s*(hours?|days?)|24\s*hours?)\b/i.test(answerText);
    checks.push(ok);
    if (!ok) notes.push("Expected timeframe language (e.g., 'within 24 hours').");
  }

  const citationRequired =
    typeof testCase.mustCite === "boolean" ? testCase.mustCite : Array.isArray(testCase.mustCite) ? true : docEvidenceExists;
  const citationPresent = citationRequired ? hasDocumentCitation(answerText) : true;
  if (!citationPresent) notes.push("Missing required document citation format.");

  if (Array.isArray(testCase.mustCite) && testCase.mustCite.length > 0) {
    const phrasesOk = testCase.mustCite.every((phrase) => containsAll(answerText, [phrase]));
    checks.push(phrasesOk);
    if (!phrasesOk) notes.push("Missing required cited context phrase(s).");
  }

  const abstainLanguage =
    /could not find|not found|not available|not specified|insufficient evidence|cannot determine|do not have enough evidence/i;
  const shouldAbstain = Boolean(testCase.shouldAbstain);
  if (shouldAbstain) {
    const ok = abstainLanguage.test(answerText);
    checks.push(ok);
    if (!ok) notes.push("Expected abstention language for negative test.");
  }

  const observedListItems = countListItems(answerText);
  let completenessRatio: number | null = null;
  if (expectedListItems && expectedListItems > 0) {
    completenessRatio = clamp01(observedListItems / expectedListItems);
    if (testCase.mustListAll && observedListItems < expectedListItems) {
      notes.push(`Incomplete list: expected ${expectedListItems}, observed ${observedListItems}.`);
    }
  }

  const hedgingPatterns = /\btypically\b|\busually\b|\bgenerally\b|\bin most protocols\b|\bcommon practice\b|\bit is likely\b/i;
  const noHallucination =
    !hedgingPatterns.test(answerText) &&
    mustNotContain.every((term) => !containsAny(answerText, [term])) &&
    (!shouldAbstain || abstainLanguage.test(answerText));
  if (!noHallucination && testCase.mustNotHallucinate) {
    notes.push("Potential hallucination indicators detected.");
  }

  const answerCorrectness =
    checks.length > 0 ? Number((checks.filter(Boolean).length / checks.length).toFixed(4)) : 1;

  return {
    notes,
    answerCorrectness,
    citationPresent: citationPresent ? 1 : 0,
    citationOk: citationPresent,
    noHallucination: noHallucination ? 1 : 0,
    observedListItems,
    completenessRatio,
  };
}

function asLegacyKind(kind: EvalCaseKind): "criteria" | "schedule" | "general" {
  if (kind === "criteria" || kind === "eligibility") return "criteria";
  if (kind === "schedule" || kind === "visit_procedures" || kind === "scheduling" || kind === "special_requirements") {
    return "schedule";
  }
  return "general";
}

export async function runUnifiedEvalHarness(params: {
  db: any;
  trialId?: string;
  protocolIds: string[];
  cases?: EvalCaseInput[];
}) {
  const cases = params.cases && params.cases.length > 0 ? params.cases : DEFAULT_EVAL_CASES;

  const [criteriaRows, scheduleRows] = await Promise.all([
    Promise.all(params.protocolIds.map((protocolId) => getStructuredEligibilityCriteria(protocolId).catch(() => null))),
    Promise.all(params.protocolIds.map((protocolId) => getStructuredScheduleOfActivities(protocolId).catch(() => null))),
  ]);
  const cache: EvalStructuredCache = {
    criteria: criteriaRows,
    schedules: scheduleRows,
  };

  const results: EvalCaseResult[] = [];
  for (const testCase of cases) {
    const diagnostics = await runUnifiedQueryDiagnostics({
      db: params.db,
      query: testCase.query,
      protocolIds: params.protocolIds,
      trialId: params.trialId,
      maxDocChunks: 48,
    });

    const answerText = diagnostics.answer.message;
    const expectedListItems = inferExpectedListSize(testCase, cache);
    const retrievalCandidates = diagnostics.retrieval.candidates.slice(0, 10).map((candidate) => ({
      excerpt: candidate.excerpt,
      sectionTitle: candidate.sectionTitle,
      chunkType: candidate.chunkType,
    }));
    const retrievalHit = computeRetrievalHit(testCase, retrievalCandidates);
    const answerEval = evaluateAnswer(
      testCase,
      answerText,
      expectedListItems,
      diagnostics.answer.evidence.document.length > 0
    );

    const notes = [...answerEval.notes];
    if (retrievalHit === 0) {
      notes.push("Top-10 retrieval did not contain expected answer signals.");
    }
    if (diagnostics.answer.abstained && !testCase.shouldAbstain) {
      notes.push(
        `Unexpected abstention${diagnostics.answer.abstainReason ? `: ${diagnostics.answer.abstainReason}` : ""}.`
      );
    }

    results.push({
      id: testCase.id,
      query: testCase.query,
      kind: testCase.kind,
      category: toCategory(testCase),
      route: diagnostics.answer.route,
      retrievalQualityScore: retrievalHit,
      retrievalHit,
      answerCorrectness: answerEval.answerCorrectness,
      citationOk: answerEval.citationOk,
      citationPresent: answerEval.citationPresent,
      noHallucination: answerEval.noHallucination,
      expectedListItems,
      observedListItems: answerEval.observedListItems,
      completenessRatio: answerEval.completenessRatio,
      abstained: diagnostics.answer.abstained,
      notes,
    });
  }

  const retrievalHitRate = average(results.map((item) => item.retrievalHit));
  const answerCorrectness = average(results.map((item) => item.answerCorrectness));
  const citationRate = average(results.map((item) => item.citationPresent));
  const noHallucinationRate = average(results.map((item) => item.noHallucination));
  const hallucinationRate = clamp01(1 - noHallucinationRate);
  const listCompletenessRows = results
    .map((item) => item.completenessRatio)
    .filter((value): value is number => value !== null);
  const listCompleteness = listCompletenessRows.length > 0 ? average(listCompletenessRows) : null;

  const criteriaCompletenessRows = results
    .filter((item) => asLegacyKind(item.kind) === "criteria" && item.completenessRatio !== null)
    .map((item) => item.completenessRatio as number);
  const scheduleCompletenessRows = results
    .filter((item) => asLegacyKind(item.kind) === "schedule" && item.completenessRatio !== null)
    .map((item) => item.completenessRatio as number);

  const passed = results.filter((item) => item.notes.length === 0).length;
  const failed = results.length - passed;
  const abstained = results.filter((item) => item.abstained).length;

  return {
    generatedAt: new Date().toISOString(),
    trialId: params.trialId ?? null,
    protocolIds: params.protocolIds,
    totals: {
      cases: results.length,
      passed,
      failed,
      abstained,
    },
    metrics: {
      retrievalPrecisionAtKProxy: Number(retrievalHitRate.toFixed(4)),
      criteriaCompleteness: criteriaCompletenessRows.length
        ? Number(average(criteriaCompletenessRows).toFixed(4))
        : null,
      scheduleCompleteness: scheduleCompletenessRows.length
        ? Number(average(scheduleCompletenessRows).toFixed(4))
        : null,
      citationCorrectness: Number(citationRate.toFixed(4)),
      retrievalHitRate: Number(retrievalHitRate.toFixed(4)),
      answerCorrectness: Number(answerCorrectness.toFixed(4)),
      citationRate: Number(citationRate.toFixed(4)),
      hallucinationRate: Number(hallucinationRate.toFixed(4)),
      listCompleteness: listCompleteness === null ? null : Number(listCompleteness.toFixed(4)),
    },
    targets: {
      retrievalHitRate: 0.9,
      answerCorrectness: 0.9,
      citationRate: 0.95,
      hallucinationRateMax: 0.05,
      listCompleteness: 0.85,
    },
    cases: results,
  } satisfies EvalHarnessReport;
}
