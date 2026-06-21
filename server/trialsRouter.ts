import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { callBackend } from "./_core/backendClient";
import { getCoreBackendClient } from "./_core/coreBackendClient";
import { authTokenFrom, resolveBeTrialIdForRead } from "./_core/coreBackendDocs";
import { getDb } from "./db";
import { buildTrialChildAggregates, cleanupTrialChildData } from "./_core/trialContext";
import { logTelemetryEvent } from "./_core/telemetry";
import type { DemoMode } from "./_core/demoMode";

/**
 * Trials are BE-owned (Postgres `trials`, keyed by UUID). The FE client routes
 * by a bare `slug` (e.g. "cardiac-a2b3c", "1") and the demo dataset is a
 * `demo_mode` (sample|full|building). The BFF resolves (slug, demoMode) -> the
 * BE trial via `GET /api/trials/by-slug`, and presents `id = slug` to the
 * client so routing is unchanged. The FE MySQL `trials` table has been retired:
 * trials are BE-only (no FE fallback). FE-owned CHILD aggregates (execution /
 * telemetry) are still computed locally but keyed by the BE trial UUID.
 */

// BE status CHECK is planning|active|completed|paused|cancelled. Map FE<->BE.
const FE_TO_BE_STATUS: Record<string, string> = {
    "not-started": "planning",
    recruiting: "active",
    "on-hold": "paused",
    terminated: "cancelled",
};
const BE_TO_FE_STATUS: Record<string, string> = {
    planning: "not-started",
    paused: "on-hold",
    cancelled: "terminated",
};
export function normalizeStatusForBackend(s: string | undefined | null): string {
    if (!s) return "planning";
    return FE_TO_BE_STATUS[s] ?? s;
}
function mapBackendStatusToClient(s: string | undefined | null): string {
    if (!s) return "not-started";
    return BE_TO_FE_STATUS[s] ?? s;
}

function mapBackendTrialToClient(t: any) {
    return {
        // Present the bare slug to the client (it routes by `id`); fall back to the
        // BE UUID for legacy rows that predate the slug column.
        id: t.slug || t.id,
        coreBackendTrialId: t.id,
        title: t.name,
        protocolNumber: t.protocol_number || "",
        investigationalProduct: t.investigational_product || "",
        indication: t.indication || "",
        description: t.description || "",
        nctNumber: t.nct_number || "",
        currentVersion: t.current_version || "1.0",
        amendmentVersion: t.amendment_version || "",
        releaseDate: t.release_date || "",
        sampleSize: t.sample_size || "",
        numberOfSites: t.number_of_sites || "",
        studyDuration: t.study_duration || "",
        studyDesignType: t.study_design_type || "",
        primaryObjective: t.primary_objective || "",
        primaryEndpoint: t.primary_endpoint || "",
        phase: t.phase || "Phase I",
        sponsor: t.sponsor || "",
        status: mapBackendStatusToClient(t.status),
        imageUrl: t.image_url || null,
        location: t.location || "",
        studyStart: t.study_start || null,
        estimatedCloseOut: t.estimated_close_out || null,
        startDate: t.study_start || null,
        endDate: t.estimated_close_out || null,
        principalInvestigator: t.principal_investigator || null,
        completionPercentage: t.completion_percentage ?? 0,
        enrolledPatients: t.enrolled_patients ?? 0,
        targetPatients: t.target_patients ?? null,
        createdAt: t.created_at || new Date().toISOString(),
        updatedAt: t.updated_at || new Date().toISOString(),
    };
}

function normalizeDemoMode(mode: any): "sample" | "full" | "building" | undefined {
    if (mode === "sample" || mode === "full" || mode === "building") return mode;
    return undefined;
}

/** Resolve the client's slug (+ demoMode) to the BE trial row. Throws on 404. */
async function resolveBeTrial(slug: string, demoMode: string | undefined, ctx: any) {
    return callBackend<any>(`/api/trials/by-slug`, {
        query: { slug, demo_mode: demoMode },
        user: ctx.user,
    });
}

/** Live enrolled-patient count for a BE trial UUID. */
async function enrolledCount(beUuid: string, ctx: any): Promise<number> {
    try {
        const enr = await callBackend<any[]>(`/api/trial-patients`, {
            query: { trial_id: beUuid },
            user: ctx.user,
        });
        return Array.isArray(enr) ? enr.length : 0;
    } catch {
        return 0;
    }
}

/** Document-hub aggregate computed from the BE documents (the local aggregator
 * reads the retired `protocols` table, so getContext overrides it with this). */
async function computeDocsAggregate(beUuid: string, ctx: any) {
    let docs: any[] = [];
    try {
        docs = await getCoreBackendClient().listTrialDocuments(beUuid, authTokenFrom(ctx));
    } catch {
        docs = [];
    }
    const isReady = (s: any) => s === "ready" || s === "complete";
    const active = docs.filter((d) => !d.archived_at);
    const indexed = active.filter((d) => isReady(d.ingestion_status));
    const processing = active.filter(
        (d) => d.ingestion_status && !isReady(d.ingestion_status) && d.ingestion_status !== "failed"
    );
    const protocols = active.filter((d) =>
        String(d.category ?? d.document_type ?? "").toLowerCase().includes("protocol")
    );
    const amendments = active.filter((d) =>
        String(d.category ?? "").toLowerCase().includes("amend")
    );
    const current = protocols.find((d) => d.is_current) ?? protocols[0] ?? null;
    const categories: Record<string, number> = {};
    for (const d of active) {
        const c = d.category ?? d.document_type ?? "Other";
        categories[c] = (categories[c] ?? 0) + 1;
    }
    const latestUploadedAt = active.reduce<string | null>(
        (m, d) => (!m || new Date(d.created_at) > new Date(m) ? d.created_at : m),
        null
    );
    return {
        total: docs.length,
        active: active.length,
        archived: docs.length - active.length,
        indexed: indexed.length,
        processing: processing.length,
        categories,
        latestUploadedAt,
        currentProtocol: current
            ? {
                id: current.id,
                filename: current.document_name,
                documentVersion:
                    current.document_version ?? current.current_version ?? null,
                releaseDate: current.release_date ?? null,
            }
            : null,
        latestProtocolIndexed: current ? isReady(current.ingestion_status) : false,
        protocolCount: protocols.length,
        amendmentCount: amendments.length,
    };
}

/** Client input -> BE trial body (snake_case). `slug`/`demo_mode` set explicitly. */
function buildTrialBody(input: any): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    const set = (k: string, v: unknown) => {
        if (v !== undefined) b[k] = v;
    };
    set("name", input.title);
    set("sponsor", input.sponsor);
    set("phase", input.phase);
    set("location", input.location);
    if (input.status !== undefined) b.status = normalizeStatusForBackend(input.status);
    if (input.studyStart !== undefined) b.study_start = input.studyStart;
    if (input.startDate !== undefined) b.study_start = input.startDate;
    if (input.estimatedCloseOut !== undefined) b.estimated_close_out = input.estimatedCloseOut;
    if (input.endDate !== undefined) b.estimated_close_out = input.endDate;
    set("description", input.description);
    set("indication", input.indication);
    set("protocol_number", input.protocolNumber);
    set("investigational_product", input.investigationalProduct);
    set("nct_number", input.nctNumber);
    set("current_version", input.currentVersion);
    set("amendment_version", input.amendmentVersion);
    set("release_date", input.releaseDate);
    set("sample_size", input.sampleSize);
    set("number_of_sites", input.numberOfSites);
    set("study_duration", input.studyDuration);
    set("study_design_type", input.studyDesignType);
    set("primary_objective", input.primaryObjective);
    set("primary_endpoint", input.primaryEndpoint);
    set("principal_investigator", input.principalInvestigator);
    set("enrolled_patients", input.enrolledPatients);
    set("target_patients", input.targetPatients);
    set("completion_percentage", input.completionPercentage);
    return b;
}

// Shared create/update input fields.
const trialWriteFields = {
    title: z.string().optional(),
    protocolNumber: z.string().optional(),
    investigationalProduct: z.string().optional(),
    indication: z.string().optional(),
    description: z.string().optional(),
    nctNumber: z.string().optional(),
    currentVersion: z.string().optional(),
    amendmentVersion: z.string().optional(),
    releaseDate: z.string().optional(),
    phase: z.string().optional(),
    status: z.string().optional(),
    sponsor: z.string().optional(),
    location: z.string().optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    studyStart: z.string().nullable().optional(),
    estimatedCloseOut: z.string().nullable().optional(),
    sampleSize: z.string().optional(),
    numberOfSites: z.string().optional(),
    studyDuration: z.string().optional(),
    studyDesignType: z.string().optional(),
    primaryObjective: z.string().optional(),
    primaryEndpoint: z.string().optional(),
    principalInvestigator: z.string().nullable().optional(),
    enrolledPatients: z.number().optional(),
    targetPatients: z.number().optional(),
    completionPercentage: z.number().optional(),
    demoMode: z.any().optional(),
};

export const trialsRouter = router({
    getById: publicProcedure
        .input(z.object({ id: z.string(), demoMode: z.any().optional() }))
        .query(async ({ input, ctx }) => {
            const demoMode = normalizeDemoMode(input.demoMode);
            try {
                console.log(`[trialsRouter] getById called with id=${input.id} demoMode=${demoMode}`);
                const t = await resolveBeTrial(input.id, demoMode, ctx);
                console.log(`[trialsRouter] resolveBeTrial result:`, t);
                const enrolled = await enrolledCount(t.id, ctx);
                return { ...mapBackendTrialToClient(t), enrolledPatients: enrolled };
            } catch (err) {
                console.error(`Error getting trial ${input.id}:`, err);
                return null;
            }
        }),

    getContext: publicProcedure
        .input(
            z.object({
                id: z.string(),
                demoMode: z.any().optional(),
                include: z.any().optional(),
                pageContext: z.string().optional(),
                emitTelemetry: z.boolean().optional(),
            })
        )
        .query(async ({ input, ctx }) => {
            const demoMode = normalizeDemoMode(input.demoMode);
            const includeList = Array.isArray(input.include) ? input.include : undefined;
            const include = new Set(
                includeList ?? ["trial", "documents", "telemetry", "execution", "suggestions", "insights"]
            );

            let beTrial: any;
            try {
                beTrial = await resolveBeTrial(input.id, demoMode, ctx);
            } catch (err) {
                console.error("Error in getContext:", err);
                return null;
            }

            const trial = {
                ...mapBackendTrialToClient(beTrial),
                enrolledPatients: await enrolledCount(beTrial.id, ctx),
            };

            // FE-owned child aggregates (execution/telemetry) are keyed by the BE
            // trial UUID. Documents come from the BE document hub. Both degrade to
            // empty/typed defaults rather than throwing.
            const mode = (demoMode ?? "sample") as DemoMode;
            let beTrialUuid: string | null = null;
            try {
                const db = await getDb();
                beTrialUuid = db ? await resolveBeTrialIdForRead(db, mode, input.id) : null;
            } catch {
                beTrialUuid = beTrial?.id ?? null;
            }
            if (!beTrialUuid) beTrialUuid = beTrial?.id ?? null;

            const [documents, childAggregates] = await Promise.all([
                computeDocsAggregate(beTrial.id, ctx),
                (async () => {
                    try {
                        const db = await getDb();
                        if (!db) return null;
                        return await buildTrialChildAggregates(db, beTrialUuid);
                    } catch {
                        return null;
                    }
                })(),
            ]);

            const telemetryStats = childAggregates?.telemetry ?? {
                totalEvents: 0,
                eventsLast7Days: 0,
                aiInvolvedEvents: 0,
                aiUsageRate: 0,
                byEventType: {} as Record<string, number>,
                byAction: {} as Record<string, number>,
                byEntityType: {} as Record<string, number>,
                lastEventAt: null as Date | null,
                recent: [] as any[],
            };
            const executionStats = childAggregates?.execution ?? {
                scaffolds: 0,
                phases: 0,
                visitLikePhases: 0,
                tasks: {
                    total: 0,
                    pending: 0,
                    inProgress: 0,
                    completed: 0,
                    blocked: 0,
                    unassigned: 0,
                    dueToday: 0,
                    dueSoon: 0,
                    overdue: 0,
                    progressPercent: 0,
                },
            };

            const documentStats = documents;
            let suggestions: any = undefined;
            let insights: any = undefined;

            if (include.has("suggestions") || include.has("insights")) {
                const draftSuggestions: Array<{
                    id: string;
                    category: "documents" | "execution" | "timeline" | "readiness" | "telemetry";
                    priority: "high" | "medium" | "low";
                    title: string;
                    description: string;
                    actionLabel: string;
                    actionTarget: "overview" | "document-hub" | "study-setup-wizard" | "assistant";
                    confidence: number;
                }> = [];

                if (documentStats.total === 0) {
                    draftSuggestions.push({
                        id: "upload_protocol",
                        category: "documents",
                        priority: "high",
                        title: "Protocol missing in Document Hub",
                        description: "Upload the protocol to enable retrieval, extraction traceability, and AI context.",
                        actionLabel: "Open Document Hub",
                        actionTarget: "document-hub",
                        confidence: 0.99,
                    });
                } else if (documentStats.processing > 0) {
                    draftSuggestions.push({
                        id: "wait_for_indexing",
                        category: "documents",
                        priority: "high",
                        title: `${documentStats.processing} document(s) still indexing`,
                        description: "Themison AI will provide stronger guidance after indexing finishes.",
                        actionLabel: "Review Documents",
                        actionTarget: "document-hub",
                        confidence: 0.95,
                    });
                }

                const protocolDocCount = documentStats.protocolCount ?? 0;
                if (documentStats.total > 0 && protocolDocCount === 0) {
                    draftSuggestions.push({
                        id: "missing_protocol_category",
                        category: "documents",
                        priority: "high",
                        title: "No protocol document categorized",
                        description: "Tag at least one document as Protocol so task generation and citations stay traceable.",
                        actionLabel: "Review Document Categories",
                        actionTarget: "document-hub",
                        confidence: 0.93,
                    });
                }

                if (documentStats.currentProtocol && !documentStats.latestProtocolIndexed) {
                    draftSuggestions.push({
                        id: "current_protocol_not_indexed",
                        category: "documents",
                        priority: "high",
                        title: "Current protocol is not indexed yet",
                        description: "Wait for indexing or retry processing to ensure complete AI retrieval and citations.",
                        actionLabel: "Open Document Hub",
                        actionTarget: "document-hub",
                        confidence: 0.94,
                    });
                }

                if (executionStats.tasks.total === 0 && documentStats.total > 0) {
                    draftSuggestions.push({
                        id: "generate_study_setup",
                        category: "execution",
                        priority: "high",
                        title: "No execution plan generated yet",
                        description: "Run Study Setup Agent to convert protocol sections into actionable tasks.",
                        actionLabel: "Open Study Setup Agent",
                        actionTarget: "study-setup-wizard",
                        confidence: 0.97,
                    });
                }

                if (!trial.startDate || !trial.endDate) {
                    draftSuggestions.push({
                        id: "set_trial_timeline",
                        category: "timeline",
                        priority: "medium",
                        title: "Timeline is incomplete",
                        description: "Set both start and end dates to activate schedule-based planning and alerts.",
                        actionLabel: "Set Dates in Overview",
                        actionTarget: "overview",
                        confidence: 0.92,
                    });
                }

                if (trial.startDate && trial.endDate) {
                    const startMs = new Date(trial.startDate).getTime();
                    const endMs = new Date(trial.endDate).getTime();
                    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs < startMs) {
                        draftSuggestions.push({
                            id: "timeline_invalid_range",
                            category: "timeline",
                            priority: "high",
                            title: "Timeline date range is invalid",
                            description: "End date is earlier than start date. Correct timeline dates to avoid schedule errors.",
                            actionLabel: "Fix Dates in Overview",
                            actionTarget: "overview",
                            confidence: 0.98,
                        });
                    }
                }

                if ((trial.status || "not-started") === "not-started" && executionStats.tasks.total > 0) {
                    draftSuggestions.push({
                        id: "activate_trial",
                        category: "readiness",
                        priority: "medium",
                        title: "Trial is still not started",
                        description: "Activate when onboarding and core setup are complete to begin active tracking.",
                        actionLabel: "Review Trial Status",
                        actionTarget: "overview",
                        confidence: 0.82,
                    });
                }

                if (executionStats.tasks.blocked > 0) {
                    draftSuggestions.push({
                        id: "blocked_tasks",
                        category: "execution",
                        priority: "high",
                        title: `${executionStats.tasks.blocked} blocked task(s) detected`,
                        description: "Resolve blockers first to protect visit timelines and downstream dependencies.",
                        actionLabel: "Open Study Setup Agent",
                        actionTarget: "study-setup-wizard",
                        confidence: 0.88,
                    });
                }

                if (executionStats.tasks.overdue > 0) {
                    draftSuggestions.push({
                        id: "overdue_tasks",
                        category: "execution",
                        priority: "high",
                        title: `${executionStats.tasks.overdue} overdue task(s)`,
                        description: "Overdue tasks may impact near-term visits. Review and re-sequence immediately.",
                        actionLabel: "Open Study Setup Agent",
                        actionTarget: "study-setup-wizard",
                        confidence: 0.91,
                    });
                }

                if (executionStats.tasks.unassigned > 0) {
                    draftSuggestions.push({
                        id: "unassigned_tasks",
                        category: "execution",
                        priority: "medium",
                        title: `${executionStats.tasks.unassigned} task(s) are unassigned`,
                        description: "Assign owners to improve execution accountability and reduce delays.",
                        actionLabel: "Open Study Setup Agent",
                        actionTarget: "study-setup-wizard",
                        confidence: 0.84,
                    });
                }

                if (executionStats.tasks.dueToday > 0) {
                    draftSuggestions.push({
                        id: "high_due_today_load",
                        category: "execution",
                        priority: executionStats.tasks.dueToday >= 5 ? "high" : "medium",
                        title: `${executionStats.tasks.dueToday} task(s) due today`,
                        description:
                            executionStats.tasks.dueToday >= 5
                                ? "Today’s workload is high. Prioritize critical-path items and confirm owners now."
                                : "Review today’s due tasks and confirm ownership to protect protocol timelines.",
                        actionLabel: "Open Study Setup Agent",
                        actionTarget: "study-setup-wizard",
                        confidence: 0.8,
                    });
                }

                if (executionStats.tasks.dueSoon > 0) {
                    draftSuggestions.push({
                        id: "due_soon_tasks",
                        category: "execution",
                        priority: "medium",
                        title: `${executionStats.tasks.dueSoon} task(s) due within 72 hours`,
                        description:
                            "Near-term task deadlines are approaching. Sequence work now to avoid overdue spillover.",
                        actionLabel: "Open Study Setup Agent",
                        actionTarget: "study-setup-wizard",
                        confidence: 0.83,
                    });
                }

                if (telemetryStats.eventsLast7Days === 0) {
                    const isActiveLike =
                        (trial.status || "not-started") === "active" ||
                        (trial.status || "not-started") === "recruiting";
                    draftSuggestions.push({
                        id: "low_recent_activity",
                        category: "telemetry",
                        priority: isActiveLike ? "medium" : "low",
                        title: isActiveLike
                            ? "No recent activity detected on an active trial"
                            : "No recent operational activity detected",
                        description: isActiveLike
                            ? "Log current trial activity to keep risk detection and signals current."
                            : "As the team uses tasks and documents, Themison AI recommendations become more precise.",
                        actionLabel: "Open Themison AI",
                        actionTarget: "assistant",
                        confidence: 0.76,
                    });
                }

                if (telemetryStats.totalEvents >= 10 && telemetryStats.aiUsageRate < 0.08) {
                    draftSuggestions.push({
                        id: "low_ai_utilization",
                        category: "telemetry",
                        priority: "low",
                        title: "Low AI utilization in recent workflow",
                        description: "Use Themison AI for task clarifications and protocol Q&A to improve decision speed and consistency.",
                        actionLabel: "Ask Themison AI",
                        actionTarget: "assistant",
                        confidence: 0.67,
                    });
                }

                const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
                const rankedSuggestions = draftSuggestions.sort(
                    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.confidence - a.confidence
                );
                const normalizedPageContext = String(input.pageContext || "").toLowerCase();
                const pageCategoryFilters: Record<string, Array<"documents" | "execution" | "timeline" | "readiness" | "telemetry">> = {
                    overview: ["documents", "execution", "timeline", "readiness", "telemetry"],
                    "document-hub": ["documents"],
                    "study-setup-wizard": ["execution", "readiness", "documents"],
                };
                const allowedCategories = pageCategoryFilters[normalizedPageContext];
                suggestions = (allowedCategories
                    ? rankedSuggestions.filter((signal) => allowedCategories.includes(signal.category))
                    : rankedSuggestions).slice(0, 12);

                const readinessParts = [
                    documentStats.total > 0,
                    documentStats.indexed > 0,
                    executionStats.tasks.total > 0,
                    Boolean(trial.startDate && trial.endDate),
                    (trial.status || "not-started") !== "not-started",
                ];
                const readinessScore = Math.round(
                    (readinessParts.filter(Boolean).length / readinessParts.length) * 100
                );
                const aiCoverageScore =
                    documentStats.active > 0
                        ? Math.round((documentStats.indexed / documentStats.active) * 100)
                        : 0;

                insights = {
                    readinessScore,
                    aiCoverageScore,
                    blockedTaskRisk: executionStats.tasks.blocked > 0 ? "high" : "low",
                    pendingTaskLoad: executionStats.tasks.pending,
                    dueTodayTasks: executionStats.tasks.dueToday,
                    dueSoonTasks: executionStats.tasks.dueSoon,
                    totalSignals: suggestions.length,
                };
            }

            if (input.emitTelemetry) {
                try {
                    await logTelemetryEvent({
                        eventType: "trial_context_viewed",
                        action: "viewed",
                        userId: ctx.user ? String(ctx.user.id) : null,
                        entityType: "trial",
                        entityId: beTrialUuid ?? beTrial.id,
                        payload: {
                            pageContext: input.pageContext ?? null,
                            include: Array.from(include),
                            suggestionCount: Array.isArray(suggestions) ? suggestions.length : 0,
                            documentTotal: documentStats.total,
                            executionTaskTotal: executionStats.tasks.total,
                            demoMode: mode,
                        },
                    });
                } catch {
                    /* telemetry is best-effort */
                }
            }

            return {
                trial: include.has("trial") ? trial : undefined,
                documents: include.has("documents") ? documents : undefined,
                telemetry: include.has("telemetry") ? telemetryStats : undefined,
                execution: include.has("execution") ? executionStats : undefined,
                suggestions: include.has("suggestions") ? suggestions ?? [] : undefined,
                insights:
                    include.has("insights")
                        ? insights ?? {
                            readinessScore: 0,
                            aiCoverageScore: 0,
                            blockedTaskRisk: "low",
                            pendingTaskLoad: 0,
                            dueTodayTasks: 0,
                            dueSoonTasks: 0,
                            totalSignals: 0,
                        }
                        : undefined,
                pageContext: input.pageContext ?? null,
                generatedAt: new Date().toISOString(),
                contextVersion: "v2",
            };
        }),

    list: publicProcedure
        .input(z.object({ demoMode: z.any().optional() }).optional())
        .query(async ({ input, ctx }) => {
            const demoMode = normalizeDemoMode(input?.demoMode);
            try {
                const trials = await callBackend<any[]>(`/api/trials`, {
                    query: { demo_mode: demoMode },
                    user: ctx.user,
                });
                return await Promise.all(
                    (trials ?? []).map(async (t) => ({
                        ...mapBackendTrialToClient(t),
                        enrolledPatients: await enrolledCount(t.id, ctx),
                    }))
                );
            } catch (err) {
                console.error("Error listing trials:", err);
                return [];
            }
        }),

    create: protectedProcedure
        .input(z.object({ id: z.string().optional(), ...trialWriteFields, title: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const demoMode = normalizeDemoMode(input.demoMode);
            const slug =
                input.id || `trial-${Math.random().toString(36).substring(2, 9)}`;
            const body = {
                ...buildTrialBody(input),
                slug,
                demo_mode: demoMode,
                // BE-required fields with defaults.
                name: input.title,
                phase: input.phase || "Phase I",
                location: input.location || "San Francisco, CA",
                sponsor: input.sponsor || "",
                status: normalizeStatusForBackend(input.status),
                members: [],
                pending_members: [],
            };
            try {
                const created = await callBackend<any>(`/api/trials/with-assignments`, {
                    method: "POST",
                    body,
                    user: ctx.user,
                });
                return mapBackendTrialToClient(created);
            } catch (err) {
                console.error("Error creating trial:", err);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to create trial on backend",
                });
            }
        }),

    update: protectedProcedure
        .input(z.object({ id: z.string(), ...trialWriteFields }))
        .mutation(async ({ input, ctx }) => {
            const demoMode = normalizeDemoMode(input.demoMode);
            try {
                const beTrial = await resolveBeTrial(input.id, demoMode, ctx);
                const updated = await callBackend<any>(`/api/trials/${beTrial.id}`, {
                    method: "PUT",
                    body: buildTrialBody(input),
                    user: ctx.user,
                });
                return mapBackendTrialToClient(updated);
            } catch (err) {
                console.error("Error updating trial:", err);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to update trial on backend",
                });
            }
        }),

    delete: protectedProcedure
        .input(z.object({ id: z.string(), demoMode: z.any().optional() }))
        .mutation(async ({ input, ctx }) => {
            const demoMode = normalizeDemoMode(input.demoMode);
            const mode = (demoMode ?? "sample") as DemoMode;
            try {
                const beTrial = await resolveBeTrial(input.id, demoMode, ctx);
                await callBackend(`/api/trials/${beTrial.id}`, {
                    method: "DELETE",
                    user: ctx.user,
                });
                // Best-effort cascade of FE-owned child data, keyed by the BE trial UUID.
                try {
                    const db = await getDb();
                    if (db) {
                        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.id);
                        await cleanupTrialChildData(db, beTrialUuid ?? beTrial.id);
                    }
                } catch {
                    /* FE child cleanup best-effort */
                }
                return { success: true };
            } catch (err) {
                console.error("Error deleting trial:", err);
                return { success: true };
            }
        }),
});