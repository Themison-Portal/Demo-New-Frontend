import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { protocols } from "../../drizzle/schema";
import type { TrialIntelligenceSnapshot } from "./aiIntelligence";
import { computeTrialIntelligenceSnapshot } from "./aiIntelligence";
import { runUnifiedQuery, type UnifiedQueryResult } from "./unifiedQuery";

export type AgentType =
  | "study_setup"
  | "visit_prep"
  | "deviation_prevention"
  | "amendment_impact"
  | "coordination"
  | "query_resolution";

export type AgentAction = {
  action: string;
  label: string;
  target: "overview" | "document-hub" | "study-setup-wizard" | "tasks" | "assistant";
  priority: "high" | "medium" | "low";
};

export type AgentRunStatus = "completed" | "pending_approval";

export type AgentRunResult = {
  runId: string;
  agentType: AgentType;
  trialId: string;
  status: AgentRunStatus;
  summary: string;
  findings: string[];
  actions: AgentAction[];
  confidence: number;
  requiresApproval: boolean;
  approvalId: string | null;
  output: Record<string, unknown>;
  createdAt: string;
};

export type AgentApprovalRecord = {
  approvalId: string;
  requestedBy: string;
  requestedAt: string;
  trialId: string;
  agentType: AgentType;
  result: AgentRunResult;
  input: {
    query: string | null;
    documentIds: string[];
    payload: Record<string, unknown>;
  };
};

const pendingApprovals = new Map<string, AgentApprovalRecord>();

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toAction(
  action: string,
  label: string,
  target: AgentAction["target"],
  priority: AgentAction["priority"]
): AgentAction {
  return { action, label, target, priority };
}

function buildSignalsFromSnapshot(snapshot: TrialIntelligenceSnapshot) {
  const signals: Array<{
    id: string;
    severity: "high" | "medium" | "low";
    title: string;
    description: string;
    action: AgentAction;
    confidence: number;
  }> = [];

  if (snapshot.documents.total === 0) {
    signals.push({
      id: "documents.missing_protocol",
      severity: "high",
      title: "Protocol is missing",
      description: "Upload a protocol in Document Hub to enable extraction, task generation, and source citations.",
      action: toAction("open_document_hub", "Open Document Hub", "document-hub", "high"),
      confidence: 0.99,
    });
  } else if (snapshot.documents.processing > 0) {
    signals.push({
      id: "documents.processing",
      severity: "high",
      title: `${snapshot.documents.processing} document(s) still indexing`,
      description: "Wait for indexing to complete before generating execution plans or asking comprehensive questions.",
      action: toAction("open_document_hub", "Review indexing status", "document-hub", "high"),
      confidence: 0.95,
    });
  }

  if (snapshot.execution.taskTotal === 0 && snapshot.documents.indexed > 0) {
    signals.push({
      id: "execution.map_missing",
      severity: "high",
      title: "Execution map not generated",
      description: "Run Study Setup Agent to create phases, tasks, and dependencies from protocol evidence.",
      action: toAction("open_study_setup", "Run Study Setup Agent", "study-setup-wizard", "high"),
      confidence: 0.97,
    });
  }

  if (!snapshot.trial.startDate || !snapshot.trial.endDate) {
    signals.push({
      id: "timeline.missing_dates",
      severity: "medium",
      title: "Trial timeline incomplete",
      description: "Set both start and end dates so timeline risk checks and scheduling signals can run.",
      action: toAction("set_trial_dates", "Set dates in Overview", "overview", "medium"),
      confidence: 0.93,
    });
  }

  if (snapshot.execution.taskBlocked > 0) {
    signals.push({
      id: "execution.blocked_tasks",
      severity: "high",
      title: `${snapshot.execution.taskBlocked} blocked task(s)`,
      description: "Blocked tasks are currently the highest execution risk and should be resolved first.",
      action: toAction("open_tasks", "Review blocked tasks", "tasks", "high"),
      confidence: 0.9,
    });
  }

  if (snapshot.telemetry.eventsLast7Days === 0) {
    signals.push({
      id: "telemetry.low_activity",
      severity: "low",
      title: "No telemetry activity in the last 7 days",
      description: "Themison AI improves as your team logs execution activity and AI feedback.",
      action: toAction("open_assistant", "Ask Themison AI", "assistant", "low"),
      confidence: 0.72,
    });
  }

  return signals;
}

async function buildAgentOutput(params: {
  db: any;
  trialId: string;
  agentType: AgentType;
  query: string | null;
  documentIds: string[];
  payload: Record<string, unknown>;
}) {
  const snapshot = await computeTrialIntelligenceSnapshot(params.db, params.trialId);
  if (!snapshot) {
    throw new Error("Trial snapshot unavailable.");
  }

  const baseSignals = buildSignalsFromSnapshot(snapshot);
  const output: Record<string, unknown> = {
    snapshotDate: snapshot.snapshotDate,
    readinessScore: snapshot.scores.readinessScore,
    riskScore: snapshot.scores.riskScore,
    aiCoverageScore: snapshot.scores.aiCoverageScore,
  };

  if (params.agentType === "query_resolution") {
    if (!params.query || params.query.trim().length < 2) {
      return {
        summary: "Query Resolution Agent requires a question.",
        findings: ["No query text was provided."],
        actions: [toAction("ask_question", "Ask a protocol or operational question", "assistant", "high")],
        confidence: 0.2,
        output,
      };
    }
    const result = await runUnifiedQuery({
      db: params.db,
      query: params.query,
      trialId: params.trialId,
      protocolIds: params.documentIds.length > 0 ? params.documentIds : undefined,
      maxDocChunks: 40,
    });
    return {
      summary: result.abstained
        ? "Query Resolution Agent abstained due to incomplete evidence."
        : "Query Resolution Agent produced a source-grounded answer.",
      findings: result.abstained
        ? [result.abstainReason ?? "Evidence or citation guard failed."]
        : [`Route: ${result.route}`, `Citations used: ${result.sources.filter((s) => s.sourceType === "document").length}`],
      actions: result.abstained
        ? [
            toAction("review_documents", "Review document coverage", "document-hub", "high"),
            toAction("retry_query", "Retry after indexing", "assistant", "medium"),
          ]
        : [toAction("open_answer", "Open answer in Themison AI", "assistant", "medium")],
      confidence: result.confidence,
      output: {
        ...output,
        query: params.query,
        response: result.message,
        route: result.route,
        abstained: result.abstained,
        abstainReason: result.abstainReason ?? null,
        sources: result.sources,
      },
    };
  }

  if (params.agentType === "study_setup") {
    const summary =
      snapshot.execution.taskTotal > 0
        ? "Study Setup Agent found an existing execution plan."
        : "Study Setup Agent is ready to generate an execution plan.";
    const findings = [
      `Current tasks: ${snapshot.execution.taskTotal}`,
      `Indexed documents: ${snapshot.documents.indexed}/${snapshot.documents.active}`,
      `Protocol docs: ${snapshot.documents.protocolCount}`,
    ];
    const actions =
      snapshot.execution.taskTotal > 0
        ? [
            toAction("review_existing_plan", "Review task scaffold", "study-setup-wizard", "medium"),
            toAction("launch_if_ready", "Confirm & launch when ready", "study-setup-wizard", "medium"),
          ]
        : [toAction("generate_plan", "Generate execution plan", "study-setup-wizard", "high")];
    return {
      summary,
      findings,
      actions,
      confidence: clamp01(snapshot.documents.indexed > 0 ? 0.9 : 0.55),
      output: {
        ...output,
        signals: baseSignals,
      },
    };
  }

  if (params.agentType === "visit_prep") {
    return {
      summary: "Visit Prep Agent generated readiness guidance from current execution signals.",
      findings: [
        `Due today tasks: ${snapshot.execution.taskDueToday}`,
        `Blocked tasks: ${snapshot.execution.taskBlocked}`,
        `Pending tasks: ${snapshot.execution.taskPending}`,
      ],
      actions: [
        toAction("review_due_today", "Review due-today checklist", "tasks", "high"),
        toAction("resolve_blockers", "Resolve blockers before visit", "tasks", "high"),
      ],
      confidence: clamp01(0.7 + (snapshot.execution.taskDueToday > 0 ? 0.1 : 0)),
      output: {
        ...output,
        dueToday: snapshot.execution.taskDueToday,
      },
    };
  }

  if (params.agentType === "deviation_prevention") {
    return {
      summary: "Deviation Prevention Agent completed a risk scan.",
      findings: [
        `Risk score: ${snapshot.scores.riskScore}`,
        `Blocked tasks: ${snapshot.execution.taskBlocked}`,
        `Timeline complete: ${Boolean(snapshot.trial.startDate && snapshot.trial.endDate) ? "yes" : "no"}`,
      ],
      actions: [
        toAction("review_risk_signals", "Review high-risk signals", "overview", "high"),
        toAction("set_timeline", "Set timeline anchors", "overview", "medium"),
      ],
      confidence: clamp01(0.65 + snapshot.scores.riskScore / 300),
      output,
    };
  }

  if (params.agentType === "amendment_impact") {
    const docs = await params.db
      .select({
        id: protocols.id,
        category: protocols.category,
        filename: protocols.filename,
        createdAt: protocols.createdAt,
      })
      .from(protocols)
      .where(eq(protocols.trialId, params.trialId));

    const amendments = docs.filter((doc: { category: string | null }) =>
      String(doc.category || "").toLowerCase().includes("amendment")
    );
    return {
      summary: amendments.length
        ? `Amendment Impact Agent found ${amendments.length} amendment document(s) for analysis.`
        : "No amendment documents detected yet.",
      findings: [
        `Protocol-related documents: ${docs.length}`,
        `Amendments: ${amendments.length}`,
      ],
      actions: amendments.length
        ? [toAction("run_amendment_diff", "Review amendment impact", "study-setup-wizard", "high")]
        : [toAction("upload_amendment", "Upload amendment document", "document-hub", "medium")],
      confidence: clamp01(amendments.length > 0 ? 0.86 : 0.45),
      output: {
        ...output,
        amendmentIds: amendments.map((doc: { id: number }) => doc.id),
      },
    };
  }

  return {
    summary: "Coordination Agent reviewed assignment and execution status.",
    findings: [
      `Pending tasks: ${snapshot.execution.taskPending}`,
      `Blocked tasks: ${snapshot.execution.taskBlocked}`,
      `Team telemetry events (7d): ${snapshot.telemetry.eventsLast7Days}`,
    ],
    actions: [
      toAction("rebalance_assignments", "Review assignment balance", "tasks", "medium"),
      toAction("review_blockers", "Unblock critical work", "tasks", "high"),
    ],
    confidence: clamp01(0.68 + (snapshot.execution.taskPending > 0 ? 0.08 : 0)),
    output,
  };
}

export async function runOrchestratedAgent(params: {
  db: any;
  trialId: string;
  agentType: AgentType;
  requestedBy: string;
  requireApproval: boolean;
  query: string | null;
  documentIds: string[];
  payload: Record<string, unknown>;
}) {
  const generated = await buildAgentOutput({
    db: params.db,
    trialId: params.trialId,
    agentType: params.agentType,
    query: params.query,
    documentIds: params.documentIds,
    payload: params.payload,
  });

  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const approvalId = params.requireApproval ? randomUUID() : null;
  const result: AgentRunResult = {
    runId,
    agentType: params.agentType,
    trialId: params.trialId,
    status: params.requireApproval ? "pending_approval" : "completed",
    summary: generated.summary,
    findings: generated.findings,
    actions: generated.actions,
    confidence: clamp01(generated.confidence),
    requiresApproval: params.requireApproval,
    approvalId,
    output: generated.output,
    createdAt,
  };

  if (approvalId) {
    pendingApprovals.set(approvalId, {
      approvalId,
      requestedBy: params.requestedBy,
      requestedAt: createdAt,
      trialId: params.trialId,
      agentType: params.agentType,
      result,
      input: {
        query: params.query,
        documentIds: params.documentIds,
        payload: params.payload,
      },
    });
  }

  return result;
}

export function listPendingApprovals(params?: { trialId?: string; requestedBy?: string }) {
  const rows = Array.from(pendingApprovals.values());
  return rows
    .filter((row) => (params?.trialId ? row.trialId === params.trialId : true))
    .filter((row) => (params?.requestedBy ? row.requestedBy === params.requestedBy : true))
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
}

export function resolveApproval(params: {
  approvalId: string;
  approved: boolean;
  modifications?: Record<string, unknown> | null;
}) {
  const approval = pendingApprovals.get(params.approvalId);
  if (!approval) {
    throw new Error("Approval request not found or already resolved.");
  }

  pendingApprovals.delete(params.approvalId);
  const modifications = params.modifications ?? null;

  const resolvedResult: AgentRunResult = {
    ...approval.result,
    status: "completed",
    requiresApproval: false,
    approvalId: null,
    summary: params.approved
      ? approval.result.summary
      : `Rejected: ${approval.result.summary}`,
    output: {
      ...approval.result.output,
      approval: {
        approved: params.approved,
        approvedAt: new Date().toISOString(),
        modifications,
      },
    },
  };

  return {
    approval,
    approved: params.approved,
    modifications,
    result: resolvedResult,
  };
}

export async function getTelemetryDrivenSignals(params: {
  db: any;
  trialId: string;
}) {
  const snapshot = await computeTrialIntelligenceSnapshot(params.db, params.trialId);
  if (!snapshot) return null;
  const signals = buildSignalsFromSnapshot(snapshot);
  return {
    trialId: params.trialId,
    generatedAt: new Date().toISOString(),
    snapshot,
    signals,
  };
}

export type QueryResolutionOutput = UnifiedQueryResult;
