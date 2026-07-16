import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  collabTelemetryEvents,
  conversationParticipants,
  conversations,
  crossReferences,
  emailChains,
  messages,
  threadAnchors,
  threadParticipants,
  threads,
  trialInboxes,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { getProtocolContextChunks, type ProtocolContextChunk } from "./_core/protocolContext";
import { getCoreBackendClient } from "./_core/coreBackendClient";
import { callBackend } from "./_core/backendClient";
import { resolveBeTrialIdForRead } from "./_core/coreBackendDocs";
import type { DemoMode } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";
import { protectedProcedure, router } from "./_core/trpc";

const demoModeSchema = z.enum(["sample", "full", "building"]);

const layerSchema = z.enum(["messages", "threads", "inbox"]);
const threadCategorySchema = z.enum([
  "question",
  "decision",
  "issue",
  "action_required",
  "approval",
  "clarification",
]);
const threadStatusSchema = z.enum(["open", "pending", "resolved", "closed"]);
const anchorTypeSchema = z.enum([
  "document_section",
  "task",
  "visit",
  "trial_wide",
  "therapeutic_area",
  "team_member",
]);
const emailFolderSchema = z.enum(["inbox", "sent", "drafts", "archived"]);
const emailPrioritySchema = z.enum(["high", "medium", "low"]);
const messageContentTypeSchema = z.enum([
  "text",
  "protocol_snippet",
  "task_card",
  "ai_response",
  "email",
]);
const crossRefEntityTypeSchema = z.enum(["message", "thread", "email_chain", "task"]);
const crossRefTypeSchema = z.enum(["manual", "ai_suggested", "spawned_from"]);

const senderTypeSchema = z.enum(["user", "ai", "system", "email_external"]);

const collabIntentSchema = z.enum([
  "protocol_question",
  "task_request",
  "snippet_request",
  "schedule_question",
  "clarification",
  "action_question",
  "email_draft",
  "email_triage",
  "general_question",
  "conversational",
]);

type CollabIntent = z.infer<typeof collabIntentSchema>;

type CollabLayer = z.infer<typeof layerSchema>;
type ThreadCategory = z.infer<typeof threadCategorySchema>;

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function normalizeText(value: string) {
  return String(value || "").trim().toLowerCase();
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((entry) => String(entry)).filter(Boolean);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function classifyIntentHeuristic(content: string): CollabIntent {
  const text = normalizeText(content);
  if (!text) return "conversational";

  if (/^(thanks|thank you|got it|ok|okay|noted|sounds good|great)\b/.test(text)) {
    return "conversational";
  }
  if (/\b(draft|reply|email response|write an email)\b/.test(text)) return "email_draft";
  if (/\b(triage|label|priority)\b/.test(text)) return "email_triage";
  if (/\b(create|make|add)\b.*\btask\b/.test(text)) return "task_request";
  if (/\b(show|share|snippet|section)\b.*\b(protocol|amendment|document)\b/.test(text)) {
    return "snippet_request";
  }
  if (/\b(visit|window|schedule|timing|soa|assessment)\b/.test(text) && text.includes("?")) {
    return "schedule_question";
  }
  if (/\b(what should i do|next step|action|required|how should)\b/.test(text)) {
    return "action_question";
  }
  if (/\b(protocol|amendment|section|eligibility|criteria|deviation|sponsor|monitor)\b/.test(text)) {
    return "protocol_question";
  }
  if (text.includes("?") || text.startsWith("how") || text.startsWith("what") || text.startsWith("when")) {
    return "general_question";
  }
  return "conversational";
}

function shouldInvokeAI(content: string, forceForThread = false) {
  const text = normalizeText(content);
  if (!text) return false;
  if (forceForThread && text.includes("?")) return true;
  if (text.includes("@themison") || text.includes("@themison ai")) return true;
  const intent = classifyIntentHeuristic(text);
  return intent !== "conversational";
}

async function getTrialContext(db: DbClient, trialId: string, mode: DemoMode = "sample") {
  // Trials are BE-owned and identified by UUID. Validate the id, then read the
  // trial's metadata from the BE by UUID.
  const beTrialId = await resolveBeTrialIdForRead(db, mode, trialId);
  if (!beTrialId) return null;
  let t: any;
  try {
    t = await callBackend<any>(`/api/trials/${beTrialId}`, {});
  } catch {
    return null;
  }
  if (!t?.id) return null;
  return {
    id: t.id,
    name: t.name ?? null,
    protocolNumber: t.protocol_number ?? null,
    phase: t.phase ?? null,
    therapeuticArea: t.indication ?? null,
    status: t.status ?? null,
  };
}

async function getPrimaryUserContext(db: DbClient, userId: number) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}

async function getProtocolChunksForTrial(
  db: DbClient,
  trialId: string,
  query: string,
  mode: DemoMode = "sample"
) {
  // Documents are BE-owned (the FE `protocols` table is retired). Trials are
  // also BE-owned, so resolve the BE trial UUID via the BE (no FE `trials`
  // read) and take its top documents (current first, then newest).
  const beTrialId = await resolveBeTrialIdForRead(db, mode, trialId);
  if (!beTrialId) return [];

  let beDocs;
  try {
    beDocs = await getCoreBackendClient().listTrialDocuments(beTrialId, "auth-disabled-bypass");
  } catch {
    return [];
  }
  const topDocs = beDocs
    .sort(
      (a, b) =>
        Number(b.is_current ?? false) - Number(a.is_current ?? false) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 3);

  const chunkSets = await Promise.all(
    topDocs.map(async (doc) => {
      const chunks = await getProtocolContextChunks({
        protocolId: doc.id,
        query,
        limit: 4,
        comprehensive: true,
      });
      return chunks;
    })
  );

  const merged = chunkSets.flat();
  const dedup = new Map<number, ProtocolContextChunk>();
  for (const chunk of merged) {
    if (!dedup.has(chunk.id)) dedup.set(chunk.id, chunk);
  }

  return Array.from(dedup.values())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 6);
}

function formatSourceCitations(chunks: ProtocolContextChunk[]) {
  return chunks
    .map((chunk, index) => {
      const section = chunk.sectionTitle || chunk.sectionType || "Section";
      const quote = chunk.chunkText.slice(0, 260).replace(/\s+/g, " ").trim();
      return `${index + 1}. [Source: ${chunk.citation.filename}, ${section}] ${quote}`;
    })
    .join("\n");
}

function buildSuggestedActions(intent: CollabIntent) {
  if (intent === "task_request") {
    return [
      {
        type: "create_task",
        label: "Create task draft",
        data: { source: "ai" },
      },
    ];
  }
  if (intent === "protocol_question" || intent === "snippet_request") {
    return [
      {
        type: "view_document",
        label: "View source document",
        data: {},
      },
      {
        type: "start_thread",
        label: "Start thread",
        data: {},
      },
    ];
  }
  return [] as Array<{ type: string; label: string; data: Record<string, unknown> }>;
}

async function generateAIResponse(options: {
  db: DbClient;
  trialId: string;
  userId: number;
  layer: CollabLayer;
  question: string;
  recentMessages?: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const { db, trialId, userId, question, layer, recentMessages = [] } = options;
  const trial = await getTrialContext(db, trialId);
  const user = await getPrimaryUserContext(db, userId);
  const intent = classifyIntentHeuristic(question);

  if (intent === "conversational") {
    return {
      intent,
      text: "",
      sources: [] as ProtocolContextChunk[],
      confidence: 0,
      latencyMs: 0,
      model: null as string | null,
      suggestedActions: [] as Array<{ type: string; label: string; data: Record<string, unknown> }>,
    };
  }

  const startedAt = Date.now();
  const chunks = await getProtocolChunksForTrial(db, trialId, question);
  const sourceContext = formatSourceCitations(chunks);

  // Prompt + system instructions live on BE (/api/collaboration/ai/respond).
  // FE ships the trial/user metadata + pre-formatted source citations; BE
  // assembles the prompt and calls the RAG service.
  const response = await callBackend<{
    text: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
  }>("/api/collaboration/ai/respond", {
    method: "POST",
    body: {
      trialId,
      trialName: trial?.name ?? null,
      trialProtocolNumber: trial?.protocolNumber ?? null,
      userName: user?.name ?? `User ${userId}`,
      userRole: user?.role ?? "user",
      layer,
      question,
      sourceContext: sourceContext || null,
      recentMessages,
    },
  });

  const text =
    response.text.trim() ||
    "I am not certain from the available context. Please verify with the protocol team or PI.";

  const usedCitations = /\[Source:/.test(text);
  const finalText = !usedCitations && chunks.length > 0
    ? `${text}\n\n${chunks
        .slice(0, 2)
        .map((chunk) => `[Source: ${chunk.citation.filename}, ${chunk.sectionTitle || chunk.sectionType}]`)
        .join(" ")}`
    : text;

  const latencyMs = Date.now() - startedAt;
  const confidence = chunks.length === 0 ? 0.32 : clamp(0.55 + chunks.length * 0.07, 0.55, 0.92);

  return {
    intent,
    text: finalText,
    sources: chunks,
    confidence,
    latencyMs,
    model: "gpt-4-turbo",
    suggestedActions: buildSuggestedActions(intent),
  };
}

async function logCollabEvent(db: DbClient, params: {
  trialId: string;
  userId: number | null;
  eventType: string;
  layer: CollabLayer;
  eventData?: Record<string, unknown>;
  aiInvolved?: boolean;
  aiModel?: string | null;
  aiLatencyMs?: number | null;
  aiAccepted?: boolean | null;
}) {
  const eventId = randomUUID();
  await db.insert(collabTelemetryEvents).values({
    id: eventId,
    trialId: params.trialId,
    userId: params.userId,
    eventType: params.eventType,
    eventData: params.eventData ?? {},
    layer: params.layer,
    aiInvolved: params.aiInvolved ?? false,
    aiModel: params.aiModel ?? null,
    aiLatencyMs: params.aiLatencyMs ?? null,
    aiAccepted: params.aiAccepted ?? null,
    createdAt: new Date(),
  });

  await logTelemetryEvent({
    eventType: params.eventType,
    action: "completed",
    userId: params.userId ? String(params.userId) : null,
    entityType: "trial",
    entityId: params.trialId,
    payload: params.eventData ?? {},
    aiInvolved: params.aiInvolved ?? false,
    aiOutput: null,
    aiSources: null,
  });
}

function toThreadCreationEventType(category: ThreadCategory): "question_created" | "action_created" | null {
  if (category === "question" || category === "clarification") return "question_created";
  if (category === "action_required") return "action_created";
  return null;
}

async function logThreadCreationEntityEvent(params: {
  trialId: string;
  userId: number | null;
  threadId: string;
  category: ThreadCategory;
  source: "manual" | "from_message" | "from_email";
}) {
  const eventType = toThreadCreationEventType(params.category);
  if (!eventType) return;

  await logTelemetryEvent({
    eventType,
    action: "created",
    userId: params.userId ? String(params.userId) : null,
    entityType: eventType === "question_created" ? "question" : "action",
    entityId: params.threadId,
    payload: {
      trialId: params.trialId,
      category: params.category,
      source: params.source,
      threadId: params.threadId,
    },
  });
}

async function getTrialIdForMessageEntity(db: DbClient, record: {
  conversationId: string | null;
  threadId: string | null;
  emailChainId: string | null;
}) {
  if (record.conversationId) {
    const [conversation] = await db
      .select({ trialId: conversations.trialId })
      .from(conversations)
      .where(eq(conversations.id, record.conversationId))
      .limit(1);
    if (conversation) return conversation.trialId;
  }

  if (record.threadId) {
    const [thread] = await db
      .select({ trialId: threads.trialId })
      .from(threads)
      .where(eq(threads.id, record.threadId))
      .limit(1);
    if (thread) return thread.trialId;
  }

  if (record.emailChainId) {
    const [chain] = await db
      .select({ trialId: trialInboxes.trialId })
      .from(emailChains)
      .innerJoin(trialInboxes, eq(emailChains.inboxId, trialInboxes.id))
      .where(eq(emailChains.id, record.emailChainId))
      .limit(1);
    if (chain) return chain.trialId;
  }

  return null;
}

async function ensureTrialInbox(db: DbClient, trialId: string) {
  const [existing] = await db.select().from(trialInboxes).where(eq(trialInboxes.trialId, trialId)).limit(1);
  if (existing) return existing;

  const id = randomUUID();
  const safeTrial = trialId.replace(/[^a-zA-Z0-9-]/g, "-").slice(-48);
  const emailAddress = `${safeTrial}@inbox.themison.local`;
  await db.insert(trialInboxes).values({
    id,
    trialId,
    emailAddress,
    isActive: true,
    createdAt: new Date(),
  });

  return {
    id,
    trialId,
    emailAddress,
    isActive: true,
    createdAt: new Date(),
  };
}

function buildTaskCardFromPrompt(content: string) {
  const trimmed = content.replace(/\s+/g, " ").trim();
  const title = trimmed
    .replace(/^.*?\b(task|todo)\b[:\-]?\s*/i, "")
    .slice(0, 120) || "Follow up task";

  return {
    type: "task_card",
    task_id: `proposal-${randomUUID()}`,
    title,
    assignee_id: null,
    assignee_name: "Unassigned",
    due_date: null,
    status: "proposed",
  };
}

async function createAiMessage(options: {
  db: DbClient;
  trialId: string;
  userId: number;
  layer: CollabLayer;
  question: string;
  conversationId?: string;
  threadId?: string;
  emailChainId?: string;
}) {
  const intentHint = classifyIntentHeuristic(options.question);
  await logCollabEvent(options.db, {
    trialId: options.trialId,
    userId: options.userId,
    eventType: "ai_query_submitted",
    layer: options.layer,
    aiInvolved: true,
    eventData: {
      question: options.question,
      questionLength: options.question.length,
      intentHint,
      conversationId: options.conversationId ?? null,
      threadId: options.threadId ?? null,
      emailChainId: options.emailChainId ?? null,
    },
  });

  const response = await generateAIResponse({
    db: options.db,
    trialId: options.trialId,
    userId: options.userId,
    layer: options.layer,
    question: options.question,
  });

  if (!response.text) {
    return { response, messageId: null as string | null };
  }

  const messageId = randomUUID();
  const contentType = response.intent === "snippet_request" ? "protocol_snippet" : "ai_response";

  const embeddedContent = {
    type: "ai_response",
    sources: response.sources.map((source) => ({
      document_id: String(source.protocolId),
      document_name: source.citation.filename,
      section_ref: source.sectionTitle || source.sectionType,
      quoted_text: source.chunkText.slice(0, 320),
      page_number: source.pageStart ?? source.pageEnd ?? null,
    })),
    confidence: response.confidence,
    query_intent: response.intent,
    suggested_actions: response.suggestedActions,
  };

  await options.db.insert(messages).values({
    id: messageId,
    conversationId: options.conversationId ?? null,
    threadId: options.threadId ?? null,
    emailChainId: options.emailChainId ?? null,
    senderId: null,
    senderType: "ai",
    senderName: "Themison AI",
    senderEmail: null,
    content: response.text,
    contentType,
    embeddedContent,
    isAiGenerated: true,
    aiModel: response.model,
    aiLatencyMs: response.latencyMs,
    editedAt: null,
    createdAt: new Date(),
  });

  await logCollabEvent(options.db, {
    trialId: options.trialId,
    userId: options.userId,
    eventType: "ai_response_generated",
    layer: options.layer,
    aiInvolved: true,
    aiModel: response.model,
    aiLatencyMs: response.latencyMs,
    eventData: {
      intent: response.intent,
      sourceCount: response.sources.length,
    },
  });

  return { response, messageId };
}

async function draftEmailWithAI(
  db: DbClient,
  options: { chainId: string; instructions?: string; userId: number }
) {
  const [chainWithTrial] = await db
    .select({
      trialId: trialInboxes.trialId,
      subject: emailChains.subject,
      fromName: emailChains.fromName,
      fromAddress: emailChains.fromAddress,
      aiSummary: emailChains.aiSummary,
      linkedThreadId: emailChains.linkedThreadId,
    })
    .from(emailChains)
    .innerJoin(trialInboxes, eq(emailChains.inboxId, trialInboxes.id))
    .where(eq(emailChains.id, options.chainId))
    .limit(1);
  if (!chainWithTrial) throw new Error("Email chain not found");

  const recentMessages = await db
    .select({ senderName: messages.senderName, senderType: messages.senderType, content: messages.content })
    .from(messages)
    .where(eq(messages.emailChainId, options.chainId))
    .orderBy(desc(messages.createdAt))
    .limit(6);

  const chunks = await getProtocolChunksForTrial(
    db,
    chainWithTrial.trialId,
    `${chainWithTrial.subject} ${options.instructions || ""}`
  );

  const recentMessagesFormatted = recentMessages
    .reverse()
    .map((row) => `${row.senderType === "ai" ? "Themison AI" : row.senderName || "Sender"}: ${row.content}`)
    .join("\n");

  const protocolContextFormatted = chunks
    .slice(0, 3)
    .map(
      (chunk) =>
        `[${chunk.citation.filename}, ${chunk.sectionTitle || chunk.sectionType}] ${chunk.chunkText.slice(0, 300)}`
    )
    .join("\n\n");

  // BE assembles the prompt + JSON schema; FE just ships pre-formatted
  // chain history + protocol context.
  const response = await callBackend<{
    draft: { subject: string; body: string; protocol_refs: Array<{ section?: string; quoted_text?: string }> };
    model: string;
    promptTokens: number;
    completionTokens: number;
  }>("/api/collaboration/ai/draft-email", {
    method: "POST",
    body: {
      subject: chainWithTrial.subject,
      fromName: chainWithTrial.fromName || null,
      fromAddress: chainWithTrial.fromAddress || null,
      aiSummary: chainWithTrial.aiSummary || null,
      instructions: options.instructions || null,
      recentMessagesFormatted,
      protocolContextFormatted: protocolContextFormatted || null,
    },
  });

  const result = {
    subject: response.draft.subject || `Re: ${chainWithTrial.subject}`,
    body: response.draft.body || "[VERIFY] Draft content unavailable.",
    protocol_refs: Array.isArray(response.draft.protocol_refs) ? response.draft.protocol_refs : [],
  };

  await logCollabEvent(db, {
    trialId: chainWithTrial.trialId,
    userId: options.userId,
    layer: "inbox",
    eventType: "ai_draft_generated",
    aiInvolved: true,
    aiModel: "gpt-4-turbo",
    aiLatencyMs: null,
    eventData: {
      chainId: options.chainId,
      protocolRefsCount: result.protocol_refs.length,
      hasInstructions: Boolean(options.instructions),
    },
  });

  return result;
}

export const collaborationRouter = router({
  conversations: router({
    list: protectedProcedure
      .input(z.object({ trialId: z.string().min(1), demoMode: demoModeSchema.optional() }))
      .query(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) return [];

        const items = await db
          .select()
          .from(conversations)
          .where(eq(conversations.trialId, beTrialUuid))
          .orderBy(desc(conversations.updatedAt));

        if (!items.length) return [];

        const conversationIds = items.map((item) => item.id);
        const participants = await db
          .select()
          .from(conversationParticipants)
          .where(inArray(conversationParticipants.conversationId, conversationIds));

        const userIds = Array.from(new Set(participants.map((participant) => participant.userId)));
        const participantUsers = userIds.length
          ? await db
              .select({ id: users.id, name: users.name, email: users.email })
              .from(users)
              .where(inArray(users.id, userIds))
          : [];
        const userById = new Map(participantUsers.map((user) => [user.id, user]));

        const messageRows = await db
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            content: messages.content,
            contentType: messages.contentType,
            senderType: messages.senderType,
            senderName: messages.senderName,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(inArray(messages.conversationId, conversationIds))
          .orderBy(desc(messages.createdAt));

        const lastByConversation = new Map<string, (typeof messageRows)[number]>();
        for (const row of messageRows) {
          if (!row.conversationId) continue;
          if (!lastByConversation.has(row.conversationId)) {
            lastByConversation.set(row.conversationId, row);
          }
        }

        return items.map((conversation) => {
          const participantsForConversation = participants
            .filter((participant) => participant.conversationId === conversation.id)
            .map((participant) => ({
              ...participant,
              user: userById.get(participant.userId) ?? null,
            }));

          const myParticipant = participantsForConversation.find(
            (participant) => participant.userId === ctx.user.id
          );
          const lastMessage = lastByConversation.get(conversation.id) ?? null;
          const unreadCount =
            lastMessage && myParticipant && myParticipant.lastReadAt
              ? Number(lastMessage.createdAt > myParticipant.lastReadAt)
              : lastMessage
              ? 1
              : 0;

          return {
            ...conversation,
            participants: participantsForConversation,
            lastMessage,
            unreadCount,
          };
        });
      }),

    create: protectedProcedure
      .input(
        z.object({
          trialId: z.string().min(1),
          demoMode: demoModeSchema.optional(),
          type: z.enum(["direct", "group"]),
          name: z.string().max(255).optional(),
          participantUserIds: z.array(z.number().int().positive()).default([]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) throw new Error("No backend trial found for this trial id");

        const conversationId = randomUUID();
        await db.insert(conversations).values({
          id: conversationId,
          trialId: beTrialUuid,
          type: input.type,
          name: input.type === "group" ? input.name ?? "Untitled Group" : null,
          createdBy: ctx.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const participantIds = Array.from(new Set([ctx.user.id, ...input.participantUserIds]));
        if (participantIds.length) {
          await db.insert(conversationParticipants).values(
            participantIds.map((userId) => ({
              id: randomUUID(),
              conversationId,
              userId,
              joinedAt: new Date(),
              lastReadAt: null,
            }))
          );
        }

        await logCollabEvent(db, {
          trialId: beTrialUuid,
          userId: ctx.user.id,
          layer: "messages",
          eventType: "conversation_created",
          eventData: {
            type: input.type,
            participantCount: participantIds.length,
          },
        });

        return { id: conversationId };
      }),

    getMessages: protectedProcedure
      .input(
        z.object({
          conversationId: z.string().min(1),
          limit: z.number().int().min(1).max(200).default(80),
        })
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const rows = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, input.conversationId))
          .orderBy(desc(messages.createdAt))
          .limit(input.limit);

        return rows.reverse();
      }),

    sendMessage: protectedProcedure
      .input(
        z.object({
          conversationId: z.string().min(1),
          content: z.string().min(1).max(12000),
          contentType: messageContentTypeSchema.default("text"),
          embeddedContent: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [conversation] = await db
          .select({ id: conversations.id, trialId: conversations.trialId })
          .from(conversations)
          .where(eq(conversations.id, input.conversationId))
          .limit(1);
        if (!conversation) throw new Error("Conversation not found");

        const messageId = randomUUID();
        await db.insert(messages).values({
          id: messageId,
          conversationId: input.conversationId,
          threadId: null,
          emailChainId: null,
          senderId: ctx.user.id,
          senderType: "user",
          senderName: ctx.user.name,
          senderEmail: ctx.user.email,
          content: input.content,
          contentType: input.contentType,
          embeddedContent: input.embeddedContent ?? null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        });

        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, input.conversationId));

        await logCollabEvent(db, {
          trialId: conversation.trialId,
          userId: ctx.user.id,
          layer: "messages",
          eventType: "message_sent",
          eventData: {
            conversationId: input.conversationId,
            contentType: input.contentType,
          },
        });

        let aiMessageId: string | null = null;
        if (shouldInvokeAI(input.content, false)) {
          const aiResult = await createAiMessage({
            db,
            trialId: conversation.trialId,
            userId: ctx.user.id,
            layer: "messages",
            question: input.content,
            conversationId: input.conversationId,
          });
          aiMessageId = aiResult.messageId;

          if (aiMessageId) {
            await db
              .update(conversations)
              .set({ updatedAt: new Date() })
              .where(eq(conversations.id, input.conversationId));
          }
        }

        return { messageId, aiMessageId };
      }),

    markRead: protectedProcedure
      .input(z.object({ conversationId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [conversation] = await db
          .select({ trialId: conversations.trialId })
          .from(conversations)
          .where(eq(conversations.id, input.conversationId))
          .limit(1);
        if (!conversation) throw new Error("Conversation not found");

        await db
          .update(conversationParticipants)
          .set({ lastReadAt: new Date() })
          .where(
            and(
              eq(conversationParticipants.conversationId, input.conversationId),
              eq(conversationParticipants.userId, ctx.user.id)
            )
          );

        await logCollabEvent(db, {
          trialId: conversation.trialId,
          userId: ctx.user.id,
          layer: "messages",
          eventType: "conversation_read",
          eventData: { conversationId: input.conversationId },
        });

        return { success: true } as const;
      }),
  }),

  threads: router({
    list: protectedProcedure
      .input(
        z.object({
          trialId: z.string().min(1),
          demoMode: demoModeSchema.optional(),
          category: threadCategorySchema.optional(),
          status: threadStatusSchema.optional(),
        })
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) return [];

        const filters = [eq(threads.trialId, beTrialUuid)];
        if (input.category) filters.push(eq(threads.category, input.category));
        if (input.status) filters.push(eq(threads.status, input.status));

        const list = await db
          .select()
          .from(threads)
          .where(and(...filters))
          .orderBy(desc(threads.updatedAt));

        if (!list.length) return [];

        const threadIds = list.map((item) => item.id);
        const anchors = await db
          .select()
          .from(threadAnchors)
          .where(inArray(threadAnchors.threadId, threadIds));

        const replies = await db
          .select({ threadId: messages.threadId, count: sql<number>`count(*)` })
          .from(messages)
          .where(inArray(messages.threadId, threadIds))
          .groupBy(messages.threadId);
        const replyMap = new Map(replies.filter((row) => row.threadId).map((row) => [row.threadId as string, row.count]));

        return list.map((thread) => ({
          ...thread,
          anchors: anchors.filter((anchor) => anchor.threadId === thread.id),
          replyCount: replyMap.get(thread.id) ?? 0,
        }));
      }),

    create: protectedProcedure
      .input(
        z.object({
          trialId: z.string().min(1),
          demoMode: demoModeSchema.optional(),
          title: z.string().min(2).max(500),
          category: threadCategorySchema,
          anchors: z
            .array(
              z.object({
                anchorType: anchorTypeSchema,
                anchorLabel: z.string().min(1).max(255),
                anchorRefId: z.string().max(64).optional(),
                anchorRefType: z.string().max(64).optional(),
              })
            )
            .default([]),
          participantUserIds: z.array(z.number().int().positive()).default([]),
          initialMessage: z.string().max(12000).optional(),
          source: z.enum(["manual", "from_message", "from_email"]).default("manual"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) throw new Error("No backend trial found for this trial id");

        const threadId = randomUUID();
        await db.insert(threads).values({
          id: threadId,
          trialId: beTrialUuid,
          title: input.title,
          category: input.category,
          status: "open",
          resolvedBy: null,
          resolvedAt: null,
          resolutionSummary: null,
          aiContributed: false,
          aiResolutionSuggested: false,
          createdBy: ctx.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        if (input.anchors.length) {
          await db.insert(threadAnchors).values(
            input.anchors.map((anchor) => ({
              id: randomUUID(),
              threadId,
              anchorType: anchor.anchorType,
              anchorLabel: anchor.anchorLabel,
              anchorRefId: anchor.anchorRefId ?? null,
              anchorRefType: anchor.anchorRefType ?? null,
              createdAt: new Date(),
            }))
          );
        }

        const participantIds = Array.from(new Set([ctx.user.id, ...input.participantUserIds]));
        if (participantIds.length) {
          await db.insert(threadParticipants).values(
            participantIds.map((userId) => ({
              id: randomUUID(),
              threadId,
              userId,
              joinedAt: new Date(),
              lastReadAt: null,
            }))
          );
        }

        if (input.initialMessage?.trim()) {
          await db.insert(messages).values({
            id: randomUUID(),
            conversationId: null,
            threadId,
            emailChainId: null,
            senderId: ctx.user.id,
            senderType: "user",
            senderName: ctx.user.name,
            senderEmail: ctx.user.email,
            content: input.initialMessage.trim(),
            contentType: "text",
            embeddedContent: null,
            isAiGenerated: false,
            aiModel: null,
            aiLatencyMs: null,
            editedAt: null,
            createdAt: new Date(),
          });
        }

        await logCollabEvent(db, {
          trialId: beTrialUuid,
          userId: ctx.user.id,
          layer: "threads",
          eventType: "thread_created",
          eventData: {
            threadId,
            category: input.category,
            source: input.source,
          },
        });

        await logThreadCreationEntityEvent({
          trialId: beTrialUuid,
          userId: ctx.user.id,
          threadId,
          category: input.category,
          source: input.source,
        });

        return { id: threadId };
      }),

    get: protectedProcedure
      .input(z.object({ threadId: z.string().min(1) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [thread] = await db.select().from(threads).where(eq(threads.id, input.threadId)).limit(1);
        if (!thread) return null;

        const [anchors, participants, threadMessages] = await Promise.all([
          db.select().from(threadAnchors).where(eq(threadAnchors.threadId, input.threadId)),
          db.select().from(threadParticipants).where(eq(threadParticipants.threadId, input.threadId)),
          db
            .select()
            .from(messages)
            .where(eq(messages.threadId, input.threadId))
            .orderBy(asc(messages.createdAt)),
        ]);

        return {
          ...thread,
          anchors,
          participants,
          messages: threadMessages,
        };
      }),

    addMessage: protectedProcedure
      .input(
        z.object({
          threadId: z.string().min(1),
          content: z.string().min(1).max(12000),
          contentType: messageContentTypeSchema.default("text"),
          embeddedContent: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [thread] = await db
          .select({ id: threads.id, trialId: threads.trialId })
          .from(threads)
          .where(eq(threads.id, input.threadId))
          .limit(1);
        if (!thread) throw new Error("Thread not found");

        const messageId = randomUUID();
        await db.insert(messages).values({
          id: messageId,
          conversationId: null,
          threadId: input.threadId,
          emailChainId: null,
          senderId: ctx.user.id,
          senderType: "user",
          senderName: ctx.user.name,
          senderEmail: ctx.user.email,
          content: input.content,
          contentType: input.contentType,
          embeddedContent: input.embeddedContent ?? null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        });

        await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, input.threadId));

        await logCollabEvent(db, {
          trialId: thread.trialId,
          userId: ctx.user.id,
          layer: "threads",
          eventType: "thread_message_sent",
          eventData: {
            threadId: input.threadId,
            contentType: input.contentType,
          },
        });

        let aiMessageId: string | null = null;
        if (shouldInvokeAI(input.content, true)) {
          const aiResult = await createAiMessage({
            db,
            trialId: thread.trialId,
            userId: ctx.user.id,
            layer: "threads",
            question: input.content,
            threadId: input.threadId,
          });
          aiMessageId = aiResult.messageId;

          if (aiMessageId) {
            await db
              .update(threads)
              .set({ updatedAt: new Date(), aiContributed: true })
              .where(eq(threads.id, input.threadId));
          }
        }

        return { messageId, aiMessageId };
      }),

    resolve: protectedProcedure
      .input(
        z.object({
          threadId: z.string().min(1),
          summary: z.string().max(5000).optional(),
          useAiSummary: z.boolean().default(false),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [thread] = await db.select().from(threads).where(eq(threads.id, input.threadId)).limit(1);
        if (!thread) throw new Error("Thread not found");

        let summary = input.summary?.trim() || null;
        if (input.useAiSummary) {
          const rows = await db
            .select({ senderName: messages.senderName, senderType: messages.senderType, content: messages.content })
            .from(messages)
            .where(eq(messages.threadId, input.threadId))
            .orderBy(asc(messages.createdAt))
            .limit(40);

          const messagesFormatted = rows
            .map((row) => `${row.senderType === "ai" ? "Themison AI" : row.senderName || "Team"}: ${row.content}`)
            .join("\n");

          const summarizeResponse = await callBackend<{
            summary: string;
            model: string;
            promptTokens: number;
            completionTokens: number;
          }>("/api/collaboration/ai/summarize-thread", {
            method: "POST",
            body: { messagesFormatted },
            user: ctx.user,
          });

          const drafted = summarizeResponse.summary.trim();
          if (drafted) summary = drafted;
        }

        await db
          .update(threads)
          .set({
            status: "resolved",
            resolvedBy: ctx.user.id,
            resolvedAt: new Date(),
            resolutionSummary: summary,
            updatedAt: new Date(),
            aiResolutionSuggested: input.useAiSummary,
          })
          .where(eq(threads.id, input.threadId));

        const participantCountRows = await db
          .select({ count: sql<number>`count(*)` })
          .from(threadParticipants)
          .where(eq(threadParticipants.threadId, input.threadId));
        const participantCount = participantCountRows[0]?.count ?? 0;

        const createdAt = thread.createdAt ? new Date(thread.createdAt).getTime() : Date.now();
        const resolutionHours = (Date.now() - createdAt) / (1000 * 60 * 60);

        await logCollabEvent(db, {
          trialId: thread.trialId,
          userId: ctx.user.id,
          layer: "threads",
          eventType: "thread_resolved",
          eventData: {
            threadId: input.threadId,
            aiContributed: thread.aiContributed,
            participantCount,
            resolutionTimeHours: Number(resolutionHours.toFixed(2)),
          },
          aiInvolved: input.useAiSummary,
          aiAccepted: input.useAiSummary ? true : null,
        });

        return { success: true, summary };
      }),

    updateStatus: protectedProcedure
      .input(z.object({ threadId: z.string().min(1), status: threadStatusSchema }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [thread] = await db.select().from(threads).where(eq(threads.id, input.threadId)).limit(1);
        if (!thread) throw new Error("Thread not found");

        await db
          .update(threads)
          .set({ status: input.status, updatedAt: new Date() })
          .where(eq(threads.id, input.threadId));

        await logCollabEvent(db, {
          trialId: thread.trialId,
          userId: ctx.user.id,
          layer: "threads",
          eventType: "thread_status_changed",
          eventData: {
            threadId: input.threadId,
            status: input.status,
          },
        });

        return { success: true };
      }),

    addAnchor: protectedProcedure
      .input(
        z.object({
          threadId: z.string().min(1),
          anchorType: anchorTypeSchema,
          anchorLabel: z.string().min(1).max(255),
          anchorRefId: z.string().max(64).optional(),
          anchorRefType: z.string().max(64).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [thread] = await db
          .select({ trialId: threads.trialId })
          .from(threads)
          .where(eq(threads.id, input.threadId))
          .limit(1);
        if (!thread) throw new Error("Thread not found");

        const id = randomUUID();
        await db.insert(threadAnchors).values({
          id,
          threadId: input.threadId,
          anchorType: input.anchorType,
          anchorLabel: input.anchorLabel,
          anchorRefId: input.anchorRefId ?? null,
          anchorRefType: input.anchorRefType ?? null,
          createdAt: new Date(),
        });

        await logCollabEvent(db, {
          trialId: thread.trialId,
          userId: ctx.user.id,
          layer: "threads",
          eventType: "thread_anchor_added",
          eventData: {
            threadId: input.threadId,
            anchorType: input.anchorType,
            anchorLabel: input.anchorLabel,
          },
        });

        return { id };
      }),
  }),

  inbox: router({
    getConfig: protectedProcedure
      .input(z.object({ trialId: z.string().min(1), demoMode: demoModeSchema.optional() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) return null;
        return await ensureTrialInbox(db, beTrialUuid);
      }),

    listEmailChains: protectedProcedure
      .input(
        z.object({
          trialId: z.string().min(1),
          demoMode: demoModeSchema.optional(),
          folder: emailFolderSchema.optional(),
          label: z.string().optional(),
          priority: emailPrioritySchema.optional(),
        })
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) return [];

        const inbox = await ensureTrialInbox(db, beTrialUuid);

        const base = [eq(emailChains.inboxId, inbox.id)];
        if (input.folder) base.push(eq(emailChains.folder, input.folder));
        if (input.priority) base.push(eq(emailChains.aiPriority, input.priority));

        const chains = await db
          .select()
          .from(emailChains)
          .where(and(...base))
          .orderBy(desc(emailChains.updatedAt));

        if (!input.label) return chains;
        const wanted = normalizeText(input.label);
        return chains.filter((chain) => toStringArray(chain.aiLabels).map(normalizeText).includes(wanted));
      }),

    getEmailChain: protectedProcedure
      .input(z.object({ chainId: z.string().min(1) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [chain] = await db.select().from(emailChains).where(eq(emailChains.id, input.chainId)).limit(1);
        if (!chain) return null;

        const rows = await db
          .select()
          .from(messages)
          .where(eq(messages.emailChainId, input.chainId))
          .orderBy(asc(messages.createdAt));

        return {
          ...chain,
          messages: rows,
        };
      }),

    composeEmail: protectedProcedure
      .input(
        z.object({
          trialId: z.string().min(1),
          demoMode: demoModeSchema.optional(),
          to: z.array(z.string().email()).min(1),
          cc: z.array(z.string().email()).default([]),
          subject: z.string().min(1).max(500),
          body: z.string().min(1).max(20000),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) throw new Error("No backend trial found for this trial id");

        const inbox = await ensureTrialInbox(db, beTrialUuid);
        const chainId = randomUUID();

        await db.insert(emailChains).values({
          id: chainId,
          inboxId: inbox.id,
          subject: input.subject,
          folder: "sent",
          aiLabels: ["outbound"],
          aiPriority: "low",
          aiSummary: null,
          aiSuggestedThreadId: null,
          linkedThreadId: null,
          fromAddress: inbox.emailAddress,
          fromName: ctx.user.name,
          toAddresses: input.to,
          ccAddresses: input.cc,
          messageCount: 1,
          isRead: true,
          isStarred: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await db.insert(messages).values({
          id: randomUUID(),
          conversationId: null,
          threadId: null,
          emailChainId: chainId,
          senderId: ctx.user.id,
          senderType: "user",
          senderName: ctx.user.name,
          senderEmail: ctx.user.email,
          content: input.body,
          contentType: "email",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        });

        await logCollabEvent(db, {
          trialId: beTrialUuid,
          userId: ctx.user.id,
          layer: "inbox",
          eventType: "email_composed",
          eventData: {
            chainId,
            recipientCount: input.to.length,
            ccCount: input.cc.length,
          },
        });

        return { chainId };
      }),

    replyEmail: protectedProcedure
      .input(
        z.object({
          chainId: z.string().min(1),
          content: z.string().min(1).max(20000),
          aiDraftMeta: z
            .object({
              generated: z.boolean().default(false),
              editedDistance: z.number().int().min(0).optional(),
            })
            .optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [chainWithTrial] = await db
          .select({
            chainId: emailChains.id,
            trialId: trialInboxes.trialId,
            messageCount: emailChains.messageCount,
          })
          .from(emailChains)
          .innerJoin(trialInboxes, eq(emailChains.inboxId, trialInboxes.id))
          .where(eq(emailChains.id, input.chainId))
          .limit(1);
        if (!chainWithTrial) throw new Error("Email chain not found");

        await db.insert(messages).values({
          id: randomUUID(),
          conversationId: null,
          threadId: null,
          emailChainId: input.chainId,
          senderId: ctx.user.id,
          senderType: "user",
          senderName: ctx.user.name,
          senderEmail: ctx.user.email,
          content: input.content,
          contentType: "email",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        });

        await db
          .update(emailChains)
          .set({
            messageCount: (chainWithTrial.messageCount ?? 0) + 1,
            folder: "sent",
            isRead: true,
            updatedAt: new Date(),
          })
          .where(eq(emailChains.id, input.chainId));

        const editedDistance = input.aiDraftMeta?.editedDistance ?? null;
        await logCollabEvent(db, {
          trialId: chainWithTrial.trialId,
          userId: ctx.user.id,
          layer: "inbox",
          eventType:
            input.aiDraftMeta?.generated
              ? editedDistance === 0
                ? "ai_draft_sent_unedited"
                : "ai_draft_sent_edited"
              : "email_replied",
          aiInvolved: input.aiDraftMeta?.generated ?? false,
          aiAccepted: input.aiDraftMeta?.generated ? true : null,
          eventData: {
            chainId: input.chainId,
            editDistance: editedDistance,
          },
        });

        return { success: true };
      }),

    moveFolder: protectedProcedure
      .input(z.object({ chainId: z.string().min(1), folder: emailFolderSchema }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [chainWithTrial] = await db
          .select({ trialId: trialInboxes.trialId })
          .from(emailChains)
          .innerJoin(trialInboxes, eq(emailChains.inboxId, trialInboxes.id))
          .where(eq(emailChains.id, input.chainId))
          .limit(1);
        if (!chainWithTrial) throw new Error("Email chain not found");

        await db
          .update(emailChains)
          .set({ folder: input.folder, updatedAt: new Date() })
          .where(eq(emailChains.id, input.chainId));

        await logCollabEvent(db, {
          trialId: chainWithTrial.trialId,
          userId: ctx.user.id,
          layer: "inbox",
          eventType: "email_folder_changed",
          eventData: {
            chainId: input.chainId,
            folder: input.folder,
          },
        });

        return { success: true };
      }),

    markRead: protectedProcedure
      .input(z.object({ chainId: z.string().min(1), isRead: z.boolean().default(true) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [chainWithTrial] = await db
          .select({ trialId: trialInboxes.trialId })
          .from(emailChains)
          .innerJoin(trialInboxes, eq(emailChains.inboxId, trialInboxes.id))
          .where(eq(emailChains.id, input.chainId))
          .limit(1);
        if (!chainWithTrial) throw new Error("Email chain not found");

        await db
          .update(emailChains)
          .set({ isRead: input.isRead, updatedAt: new Date() })
          .where(eq(emailChains.id, input.chainId));

        await logCollabEvent(db, {
          trialId: chainWithTrial.trialId,
          userId: ctx.user.id,
          layer: "inbox",
          eventType: "email_read_status_changed",
          eventData: {
            chainId: input.chainId,
            isRead: input.isRead,
          },
        });

        return { success: true };
      }),

    dismissLabel: protectedProcedure
      .input(z.object({ chainId: z.string().min(1), label: z.string().min(1).max(100) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [chainWithTrial] = await db
          .select({
            trialId: trialInboxes.trialId,
            aiLabels: emailChains.aiLabels,
          })
          .from(emailChains)
          .innerJoin(trialInboxes, eq(emailChains.inboxId, trialInboxes.id))
          .where(eq(emailChains.id, input.chainId))
          .limit(1);
        if (!chainWithTrial) throw new Error("Email chain not found");

        const nextLabels = toStringArray(chainWithTrial.aiLabels).filter(
          (entry) => normalizeText(entry) !== normalizeText(input.label)
        );

        await db
          .update(emailChains)
          .set({
            aiLabels: nextLabels,
            updatedAt: new Date(),
          })
          .where(eq(emailChains.id, input.chainId));

        await logCollabEvent(db, {
          trialId: chainWithTrial.trialId,
          userId: ctx.user.id,
          layer: "inbox",
          eventType: "ai_label_dismissed",
          aiInvolved: true,
          aiAccepted: false,
          eventData: {
            chainId: input.chainId,
            labelDismissed: input.label,
          },
        });

        return { success: true };
      }),

    linkThread: protectedProcedure
      .input(z.object({ chainId: z.string().min(1), threadId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [chainWithTrial] = await db
          .select({ trialId: trialInboxes.trialId })
          .from(emailChains)
          .innerJoin(trialInboxes, eq(emailChains.inboxId, trialInboxes.id))
          .where(eq(emailChains.id, input.chainId))
          .limit(1);
        if (!chainWithTrial) throw new Error("Email chain not found");

        await db
          .update(emailChains)
          .set({ linkedThreadId: input.threadId, updatedAt: new Date() })
          .where(eq(emailChains.id, input.chainId));

        await db.insert(crossReferences).values({
          id: randomUUID(),
          sourceType: "email_chain",
          sourceId: input.chainId,
          targetType: "thread",
          targetId: input.threadId,
          refType: "manual",
          createdBy: ctx.user.id,
          createdAt: new Date(),
        });

        await logCollabEvent(db, {
          trialId: chainWithTrial.trialId,
          userId: ctx.user.id,
          layer: "inbox",
          eventType: "email_linked_thread",
          eventData: {
            chainId: input.chainId,
            threadId: input.threadId,
          },
        });

        return { success: true };
      }),

    createThread: protectedProcedure
      .input(
        z.object({
          chainId: z.string().min(1),
          title: z.string().min(2).max(500),
          category: threadCategorySchema.default("question"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [chainWithTrial] = await db
          .select({
            chainId: emailChains.id,
            trialId: trialInboxes.trialId,
            subject: emailChains.subject,
          })
          .from(emailChains)
          .innerJoin(trialInboxes, eq(emailChains.inboxId, trialInboxes.id))
          .where(eq(emailChains.id, input.chainId))
          .limit(1);
        if (!chainWithTrial) throw new Error("Email chain not found");

        const threadId = randomUUID();
        await db.insert(threads).values({
          id: threadId,
          trialId: chainWithTrial.trialId,
          title: input.title,
          category: input.category,
          status: "open",
          resolvedBy: null,
          resolvedAt: null,
          resolutionSummary: null,
          aiContributed: false,
          aiResolutionSuggested: false,
          createdBy: ctx.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await db.insert(threadParticipants).values({
          id: randomUUID(),
          threadId,
          userId: ctx.user.id,
          joinedAt: new Date(),
          lastReadAt: null,
        });

        await db
          .update(emailChains)
          .set({
            linkedThreadId: threadId,
            updatedAt: new Date(),
          })
          .where(eq(emailChains.id, input.chainId));

        await db.insert(crossReferences).values({
          id: randomUUID(),
          sourceType: "email_chain",
          sourceId: input.chainId,
          targetType: "thread",
          targetId: threadId,
          refType: "spawned_from",
          createdBy: ctx.user.id,
          createdAt: new Date(),
        });

        await logCollabEvent(db, {
          trialId: chainWithTrial.trialId,
          userId: ctx.user.id,
          layer: "inbox",
          eventType: "thread_created",
          eventData: {
            source: "from_email",
            chainId: input.chainId,
            threadId,
          },
        });

        await logThreadCreationEntityEvent({
          trialId: chainWithTrial.trialId,
          userId: ctx.user.id,
          threadId,
          category: input.category,
          source: "from_email",
        });

        return { threadId };
      }),

    draftWithAI: protectedProcedure
      .input(
        z.object({
          chainId: z.string().min(1),
          instructions: z.string().max(3000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        return await draftEmailWithAI(db, {
          chainId: input.chainId,
          instructions: input.instructions,
          userId: ctx.user.id,
        });
      }),
  }),

  crossLayer: router({
    startThreadFromMessage: protectedProcedure
      .input(
        z.object({
          messageId: z.string().min(1),
          title: z.string().min(2).max(500),
          category: threadCategorySchema.default("question"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [messageRow] = await db
          .select({
            id: messages.id,
            content: messages.content,
            conversationId: messages.conversationId,
            threadId: messages.threadId,
            emailChainId: messages.emailChainId,
          })
          .from(messages)
          .where(eq(messages.id, input.messageId))
          .limit(1);
        if (!messageRow) throw new Error("Message not found");

        const trialId = await getTrialIdForMessageEntity(db, {
          conversationId: messageRow.conversationId,
          threadId: messageRow.threadId,
          emailChainId: messageRow.emailChainId,
        });
        if (!trialId) throw new Error("Unable to derive trial context from message");

        const threadId = randomUUID();
        await db.insert(threads).values({
          id: threadId,
          trialId,
          title: input.title,
          category: input.category,
          status: "open",
          resolvedBy: null,
          resolvedAt: null,
          resolutionSummary: null,
          aiContributed: false,
          aiResolutionSuggested: false,
          createdBy: ctx.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await db.insert(threadParticipants).values({
          id: randomUUID(),
          threadId,
          userId: ctx.user.id,
          joinedAt: new Date(),
          lastReadAt: null,
        });

        await db.insert(messages).values({
          id: randomUUID(),
          conversationId: null,
          threadId,
          emailChainId: null,
          senderId: ctx.user.id,
          senderType: "user",
          senderName: ctx.user.name,
          senderEmail: ctx.user.email,
          content: `Spawned from message:\n\n${messageRow.content}`,
          contentType: "text",
          embeddedContent: { sourceMessageId: input.messageId },
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        });

        await db.insert(crossReferences).values({
          id: randomUUID(),
          sourceType: "message",
          sourceId: input.messageId,
          targetType: "thread",
          targetId: threadId,
          refType: "spawned_from",
          createdBy: ctx.user.id,
          createdAt: new Date(),
        });

        await logCollabEvent(db, {
          trialId,
          userId: ctx.user.id,
          layer: "threads",
          eventType: "thread_created",
          eventData: {
            source: "from_message",
            messageId: input.messageId,
            threadId,
          },
        });

        await logThreadCreationEntityEvent({
          trialId,
          userId: ctx.user.id,
          threadId,
          category: input.category,
          source: "from_message",
        });

        return { threadId };
      }),

    createReference: protectedProcedure
      .input(
        z.object({
          sourceType: crossRefEntityTypeSchema,
          sourceId: z.string().min(1),
          targetType: crossRefEntityTypeSchema,
          targetId: z.string().min(1),
          refType: crossRefTypeSchema.default("manual"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const id = randomUUID();
        await db.insert(crossReferences).values({
          id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          targetType: input.targetType,
          targetId: input.targetId,
          refType: input.refType,
          createdBy: ctx.user.id,
          createdAt: new Date(),
        });

        return { id };
      }),

    listReferences: protectedProcedure
      .input(
        z.object({
          sourceType: crossRefEntityTypeSchema,
          sourceId: z.string().min(1),
        })
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        return await db
          .select()
          .from(crossReferences)
          .where(and(eq(crossReferences.sourceType, input.sourceType), eq(crossReferences.sourceId, input.sourceId)))
          .orderBy(desc(crossReferences.createdAt));
      }),
  }),

  ai: router({
    classifyIntent: protectedProcedure
      .input(z.object({ content: z.string().min(1).max(12000) }))
      .mutation(async ({ input }) => {
        const heuristic = classifyIntentHeuristic(input.content);
        return { intent: heuristic };
      }),

    respond: protectedProcedure
      .input(
        z.object({
          trialId: z.string().min(1),
          demoMode: demoModeSchema.optional(),
          layer: layerSchema,
          question: z.string().min(1).max(12000),
          conversationId: z.string().optional(),
          threadId: z.string().optional(),
          emailChainId: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) throw new Error("No backend trial found for this trial id");

        return await createAiMessage({
          db,
          trialId: beTrialUuid,
          userId: ctx.user.id,
          layer: input.layer,
          question: input.question,
          conversationId: input.conversationId,
          threadId: input.threadId,
          emailChainId: input.emailChainId,
        });
      }),

    triageEmail: protectedProcedure
      .input(z.object({ chainId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [chainWithTrial] = await db
          .select({
            chainId: emailChains.id,
            trialId: trialInboxes.trialId,
            subject: emailChains.subject,
            fromName: emailChains.fromName,
            fromAddress: emailChains.fromAddress,
          })
          .from(emailChains)
          .innerJoin(trialInboxes, eq(emailChains.inboxId, trialInboxes.id))
          .where(eq(emailChains.id, input.chainId))
          .limit(1);
        if (!chainWithTrial) throw new Error("Email chain not found");

        const lastMessage = await db
          .select({ content: messages.content })
          .from(messages)
          .where(eq(messages.emailChainId, input.chainId))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        const bodyText = lastMessage[0]?.content || "";

        const triageResponse = await callBackend<{
          triage: { labels: string[]; priority: "high" | "medium" | "low"; summary: string };
          model: string;
          promptTokens: number;
          completionTokens: number;
        }>("/api/collaboration/ai/triage-email", {
          method: "POST",
          body: {
            subject: chainWithTrial.subject,
            fromName: chainWithTrial.fromName || null,
            fromAddress: chainWithTrial.fromAddress || null,
            body: bodyText,
          },
          user: ctx.user,
        });

        const labels = (triageResponse.triage.labels || [])
          .map((label) => normalizeText(label))
          .filter(Boolean);
        const priority = triageResponse.triage.priority;
        const summary = triageResponse.triage.summary || "Triage summary unavailable.";

        await db
          .update(emailChains)
          .set({
            aiLabels: labels,
            aiPriority: priority,
            aiSummary: summary,
            updatedAt: new Date(),
          })
          .where(eq(emailChains.id, input.chainId));

        await logCollabEvent(db, {
          trialId: chainWithTrial.trialId,
          userId: ctx.user.id,
          layer: "inbox",
          eventType: "email_triaged",
          aiInvolved: true,
          aiModel: "gpt-4-turbo",
          eventData: {
            chainId: input.chainId,
            labels,
            priority,
          },
        });

        return {
          labels,
          priority,
          summary,
        };
      }),

    draftEmail: protectedProcedure
      .input(
        z.object({
          chainId: z.string().min(1),
          instructions: z.string().max(3000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        return await draftEmailWithAI(db, {
          chainId: input.chainId,
          instructions: input.instructions,
          userId: ctx.user.id,
        });
      }),

    createTask: protectedProcedure
      .input(
        z.object({
          trialId: z.string().min(1),
          demoMode: demoModeSchema.optional(),
          content: z.string().min(1).max(8000),
          conversationId: z.string().optional(),
          threadId: z.string().optional(),
          sourceMessageId: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) throw new Error("No backend trial found for this trial id");

        const taskCard = buildTaskCardFromPrompt(input.content);
        const messageText = `Prepared a task draft. Please review and confirm before creation.`;

        let messageId: string | null = null;
        if (input.conversationId || input.threadId) {
          messageId = randomUUID();
          await db.insert(messages).values({
            id: messageId,
            conversationId: input.conversationId ?? null,
            threadId: input.threadId ?? null,
            emailChainId: null,
            senderId: null,
            senderType: "ai",
            senderName: "Themison AI",
            senderEmail: null,
            content: messageText,
            contentType: "task_card",
            embeddedContent: taskCard,
            isAiGenerated: true,
            aiModel: "gpt-4-turbo",
            aiLatencyMs: null,
            editedAt: null,
            createdAt: new Date(),
          });
        }

        await logCollabEvent(db, {
          trialId: beTrialUuid,
          userId: ctx.user.id,
          layer: input.threadId ? "threads" : "messages",
          eventType: "ai_task_suggested",
          aiInvolved: true,
          aiModel: "gpt-4-turbo",
          eventData: {
            sourceMessageId: input.sourceMessageId ?? null,
            hasConversationContext: Boolean(input.conversationId || input.threadId),
          },
        });

        return {
          taskCard,
          messageId,
          requiresConfirmation: true,
        };
      }),

    suggestResolution: protectedProcedure
      .input(z.object({ threadId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [thread] = await db.select().from(threads).where(eq(threads.id, input.threadId)).limit(1);
        if (!thread) throw new Error("Thread not found");

        const rows = await db
          .select({ senderName: messages.senderName, senderType: messages.senderType, content: messages.content })
          .from(messages)
          .where(eq(messages.threadId, input.threadId))
          .orderBy(asc(messages.createdAt))
          .limit(60);

        const messagesFormatted = rows
          .map((row) => `${row.senderType === "ai" ? "Themison AI" : row.senderName || "Team"}: ${row.content}`)
          .join("\n");

        const suggestion = await callBackend<{
          summary: string;
          model: string;
          promptTokens: number;
          completionTokens: number;
        }>("/api/collaboration/ai/suggest-resolution", {
          method: "POST",
          body: { messagesFormatted },
          user: ctx.user,
        });

        const summary = suggestion.summary.trim();

        await db
          .update(threads)
          .set({ aiResolutionSuggested: true, updatedAt: new Date() })
          .where(eq(threads.id, input.threadId));

        await logCollabEvent(db, {
          trialId: thread.trialId,
          userId: ctx.user.id,
          layer: "threads",
          eventType: "ai_resolution_suggested",
          aiInvolved: true,
          aiModel: "gpt-4-turbo",
          eventData: {
            threadId: input.threadId,
          },
        });

        return {
          summary,
        };
      }),

    findRelatedThreads: protectedProcedure
      .input(z.object({ trialId: z.string().min(1), demoMode: demoModeSchema.optional(), query: z.string().min(2).max(500) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) return [];

        const tokenized = input.query
          .toLowerCase()
          .split(/\s+/)
          .map((token) => token.trim())
          .filter((token) => token.length > 2)
          .slice(0, 8);

        const whereParts = tokenized.map((token) => like(threads.title, `%${token}%`));
        const base = [eq(threads.trialId, beTrialUuid)];
        if (whereParts.length) {
          base.push(or(...whereParts) as any);
        }

        const rows = await db
          .select({
            id: threads.id,
            title: threads.title,
            category: threads.category,
            status: threads.status,
            resolutionSummary: threads.resolutionSummary,
            updatedAt: threads.updatedAt,
          })
          .from(threads)
          .where(and(...base))
          .orderBy(desc(threads.updatedAt))
          .limit(8);

        return rows;
      }),
  }),

  telemetry: router({
    log: protectedProcedure
      .input(
        z.object({
          trialId: z.string().min(1),
          demoMode: demoModeSchema.optional(),
          layer: layerSchema,
          eventType: z.string().min(2).max(120),
          eventData: z.record(z.string(), z.unknown()).default({}),
          aiInvolved: z.boolean().default(false),
          aiModel: z.string().max(100).optional(),
          aiLatencyMs: z.number().int().min(0).optional(),
          aiAccepted: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
        if (!beTrialUuid) return { success: true } as const;

        await logCollabEvent(db, {
          trialId: beTrialUuid,
          userId: ctx.user.id,
          layer: input.layer,
          eventType: input.eventType,
          eventData: input.eventData,
          aiInvolved: input.aiInvolved,
          aiModel: input.aiModel ?? null,
          aiLatencyMs: input.aiLatencyMs ?? null,
          aiAccepted: input.aiAccepted ?? null,
        });

        return { success: true } as const;
      }),
  }),

  seedDemoData: protectedProcedure
    .input(z.object({ trialId: z.string().min(1), demoMode: demoModeSchema.optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const beTrialUuid = await resolveBeTrialIdForRead(db, mode, input.trialId);
      if (!beTrialUuid) {
        throw new Error("No backend trial found for this trial id; cannot seed collaboration data");
      }

      const inbox = await ensureTrialInbox(db, beTrialUuid);

      const [conversationCountRows, threadCountRows, emailCountRows, emailInboxCountRows, emailDraftCountRows] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(conversations)
          .where(eq(conversations.trialId, beTrialUuid)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(threads)
          .where(eq(threads.trialId, beTrialUuid)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(emailChains)
          .where(eq(emailChains.inboxId, inbox.id)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(emailChains)
          .where(and(eq(emailChains.inboxId, inbox.id), eq(emailChains.folder, "inbox"))),
        db
          .select({ count: sql<number>`count(*)` })
          .from(emailChains)
          .where(and(eq(emailChains.inboxId, inbox.id), eq(emailChains.folder, "drafts"))),
      ]);

      const conversationCount = conversationCountRows[0]?.count ?? 0;
      const threadCount = threadCountRows[0]?.count ?? 0;
      const emailCount = emailCountRows[0]?.count ?? 0;
      const emailInboxCount = emailInboxCountRows[0]?.count ?? 0;
      const emailDraftCount = emailDraftCountRows[0]?.count ?? 0;

      if (conversationCount > 0 && threadCount > 0 && emailInboxCount > 0 && emailDraftCount > 0) {
        return {
          success: true,
          trialId: input.trialId,
          skipped: true,
        };
      }

      if ((conversationCount > 0 || threadCount > 0) && (emailInboxCount === 0 || emailDraftCount === 0)) {
        const [existingVisitThread] = await db
          .select({ id: threads.id })
          .from(threads)
          .where(and(eq(threads.trialId, beTrialUuid), eq(threads.title, "Visit 3 timing clarification")))
          .limit(1);

        let threadVisitId = existingVisitThread?.id ?? null;
        if (!threadVisitId) {
          const [latestThread] = await db
            .select({ id: threads.id })
            .from(threads)
            .where(eq(threads.trialId, beTrialUuid))
            .orderBy(desc(threads.updatedAt))
            .limit(1);
          threadVisitId = latestThread?.id ?? null;
        }

        if (!threadVisitId) {
          threadVisitId = randomUUID();
          await db.insert(threads).values({
            id: threadVisitId,
            trialId: beTrialUuid,
            title: "Visit 3 timing clarification",
            category: "question",
            status: "open",
            resolvedBy: null,
            resolvedAt: null,
            resolutionSummary: null,
            aiContributed: true,
            aiResolutionSuggested: false,
            createdBy: ctx.user.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        const existingChains = await db
          .select({ id: emailChains.id, subject: emailChains.subject })
          .from(emailChains)
          .where(eq(emailChains.inboxId, inbox.id));
        const bySubject = new Map(existingChains.map((row) => [row.subject, row.id]));

        const sponsorSubject = "Visit 3 blood sample timing confirmation";
        const systemSubject = "CTMS Enrollment Update";
        const draftSubject = "Re: Visit 3 blood sample timing confirmation";

        const sponsorChainId = bySubject.get(sponsorSubject) ?? randomUUID();
        const systemChainId = bySubject.get(systemSubject) ?? randomUUID();
        const draftChainId = bySubject.get(draftSubject) ?? randomUUID();

        const chainsToInsert = [];
        if (!bySubject.has(sponsorSubject)) {
          chainsToInsert.push({
            id: sponsorChainId,
            inboxId: inbox.id,
            subject: sponsorSubject,
            folder: "inbox" as const,
            aiLabels: ["sponsor_query", "action_required"],
            aiPriority: "high" as const,
            aiSummary: "Sponsor requesting confirmation of Visit 3 blood sample timing window.",
            aiSuggestedThreadId: threadVisitId,
            linkedThreadId: threadVisitId,
            fromAddress: "sponsor.ops@cro-example.com",
            fromName: "Sponsor Operations",
            toAddresses: [inbox.emailAddress],
            ccAddresses: [],
            messageCount: 1,
            isRead: false,
            isStarred: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        if (!bySubject.has(systemSubject)) {
          chainsToInsert.push({
            id: systemChainId,
            inboxId: inbox.id,
            subject: systemSubject,
            folder: "inbox" as const,
            aiLabels: ["system_notification", "fyi"],
            aiPriority: "low" as const,
            aiSummary: "Enrollment update: 2 new patients screened.",
            aiSuggestedThreadId: null,
            linkedThreadId: null,
            fromAddress: "notifications@ctms.local",
            fromName: "CTMS System",
            toAddresses: [inbox.emailAddress],
            ccAddresses: [],
            messageCount: 1,
            isRead: false,
            isStarred: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        if (!bySubject.has(draftSubject)) {
          chainsToInsert.push({
            id: draftChainId,
            inboxId: inbox.id,
            subject: draftSubject,
            folder: "drafts" as const,
            aiLabels: ["draft"],
            aiPriority: "medium" as const,
            aiSummary: "AI-generated draft reply pending coordinator review.",
            aiSuggestedThreadId: threadVisitId,
            linkedThreadId: threadVisitId,
            fromAddress: inbox.emailAddress,
            fromName: "Susan Johnson",
            toAddresses: ["sponsor.ops@cro-example.com"],
            ccAddresses: [],
            messageCount: 1,
            isRead: true,
            isStarred: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        if (chainsToInsert.length > 0) {
          await db.insert(emailChains).values(chainsToInsert);
        }

        const messagesToInsert = [];
        if (!bySubject.has(sponsorSubject)) {
          messagesToInsert.push({
            id: randomUUID(),
            conversationId: null,
            threadId: null,
            emailChainId: sponsorChainId,
            senderId: null,
            senderType: "email_external" as const,
            senderName: "Sponsor Operations",
            senderEmail: "sponsor.ops@cro-example.com",
            content: "Please confirm the Visit 3 blood sample timing window.",
            contentType: "email" as const,
            embeddedContent: null,
            isAiGenerated: false,
            aiModel: null,
            aiLatencyMs: null,
            editedAt: null,
            createdAt: new Date(),
          });
        }
        if (!bySubject.has(systemSubject)) {
          messagesToInsert.push({
            id: randomUUID(),
            conversationId: null,
            threadId: null,
            emailChainId: systemChainId,
            senderId: null,
            senderType: "email_external" as const,
            senderName: "CTMS System",
            senderEmail: "notifications@ctms.local",
            content: "Enrollment update: 2 new patients screened.",
            contentType: "email" as const,
            embeddedContent: null,
            isAiGenerated: false,
            aiModel: null,
            aiLatencyMs: null,
            editedAt: null,
            createdAt: new Date(),
          });
        }
        if (!bySubject.has(draftSubject)) {
          messagesToInsert.push({
            id: randomUUID(),
            conversationId: null,
            threadId: null,
            emailChainId: draftChainId,
            senderId: null,
            senderType: "ai" as const,
            senderName: "Themison AI",
            senderEmail: null,
            content:
              "Per Protocol Section 5.5.3, Visit 3 blood samples should be collected within a strict +/-2 hour window. Please let us know if additional detail is needed.",
            contentType: "email" as const,
            embeddedContent: {
              type: "ai_response",
              sources: [
                {
                  document_id: "protocol-main",
                  document_name: "Protocol DN-2024-01",
                  section_ref: "Section 5.5.3",
                  quoted_text:
                    "Visit 3 blood samples must be collected within a +/-2 hour window from scheduled collection time.",
                  page_number: 64,
                },
              ],
              confidence: 0.9,
              query_intent: "email_draft",
              suggested_actions: [],
            },
            isAiGenerated: true,
            aiModel: "gpt-4-turbo",
            aiLatencyMs: 530,
            editedAt: null,
            createdAt: new Date(),
          });
        }

        if (messagesToInsert.length > 0) {
          await db.insert(messages).values(messagesToInsert as any);
        }

        const [existingSponsorRef] = await db
          .select({ id: crossReferences.id })
          .from(crossReferences)
          .where(
            and(
              eq(crossReferences.sourceType, "email_chain"),
              eq(crossReferences.sourceId, sponsorChainId),
              eq(crossReferences.targetType, "thread"),
              eq(crossReferences.targetId, threadVisitId)
            )
          )
          .limit(1);
        if (!existingSponsorRef) {
          await db.insert(crossReferences).values({
            id: randomUUID(),
            sourceType: "email_chain",
            sourceId: sponsorChainId,
            targetType: "thread",
            targetId: threadVisitId,
            refType: "manual",
            createdBy: ctx.user.id,
            createdAt: new Date(),
          });
        }

        await logCollabEvent(db, {
          trialId: beTrialUuid,
          userId: ctx.user.id,
          layer: "inbox",
          eventType: "collaboration_seeded_inbox_backfill",
          eventData: {
            emailChainsInserted: chainsToInsert.length,
          },
        });

        return {
          success: true,
          trialId: input.trialId,
          seededInboxOnly: true,
        };
      }

      const [susan, olivia, allan] = await Promise.all([
        (async () => {
          const openId = "seed-susan-johnson";
          const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
          if (existing) return existing.id;
          await db.insert(users).values({
            openId,
            name: "Susan Johnson",
            email: "susan.johnson@themison.com",
            loginMethod: "seed",
            role: "user",
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          });
          const [row] = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
          return row.id;
        })(),
        (async () => {
          const openId = "seed-olivia-rhye";
          const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
          if (existing) return existing.id;
          await db.insert(users).values({
            openId,
            name: "Olivia Rhye",
            email: "olivia.rhye@themison.com",
            loginMethod: "seed",
            role: "user",
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          });
          const [row] = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
          return row.id;
        })(),
        (async () => {
          const openId = "seed-allan-cook";
          const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
          if (existing) return existing.id;
          await db.insert(users).values({
            openId,
            name: "Allan Cook",
            email: "allan.cook@themison.com",
            loginMethod: "seed",
            role: "user",
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          });
          const [row] = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
          return row.id;
        })(),
      ]);

      const dmConversationId = randomUUID();
      const groupConversationId = randomUUID();

      await db.insert(conversations).values([
        {
          id: dmConversationId,
          trialId: beTrialUuid,
          type: "direct",
          name: null,
          createdBy: olivia,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: groupConversationId,
          trialId: beTrialUuid,
          type: "group",
          name: "Site Coordinators",
          createdBy: susan,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await db.insert(conversationParticipants).values([
        { id: randomUUID(), conversationId: dmConversationId, userId: susan, joinedAt: new Date(), lastReadAt: null },
        { id: randomUUID(), conversationId: dmConversationId, userId: olivia, joinedAt: new Date(), lastReadAt: null },
        { id: randomUUID(), conversationId: groupConversationId, userId: susan, joinedAt: new Date(), lastReadAt: null },
        { id: randomUUID(), conversationId: groupConversationId, userId: olivia, joinedAt: new Date(), lastReadAt: null },
        { id: randomUUID(), conversationId: groupConversationId, userId: allan, joinedAt: new Date(), lastReadAt: null },
      ]);

      const threadVisitId = randomUUID();
      const threadLabId = randomUUID();

      await db.insert(threads).values([
        {
          id: threadVisitId,
          trialId: beTrialUuid,
          title: "Visit 3 timing clarification",
          category: "question",
          status: "open",
          resolvedBy: null,
          resolvedAt: null,
          resolutionSummary: null,
          aiContributed: true,
          aiResolutionSuggested: false,
          createdBy: allan,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: threadLabId,
          trialId: beTrialUuid,
          title: "Lab kit supplier approval",
          category: "decision",
          status: "resolved",
          resolvedBy: susan,
          resolvedAt: new Date(),
          resolutionSummary: "Approved LabCorp as primary supplier for Visit 3-6 kits.",
          aiContributed: false,
          aiResolutionSuggested: false,
          createdBy: susan,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await db.insert(threadAnchors).values([
        {
          id: randomUUID(),
          threadId: threadVisitId,
          anchorType: "visit",
          anchorLabel: "Visit 3 Assessments",
          anchorRefId: null,
          anchorRefType: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          threadId: threadVisitId,
          anchorType: "document_section",
          anchorLabel: "Protocol 5.5.3",
          anchorRefId: null,
          anchorRefType: null,
          createdAt: new Date(),
        },
      ]);

      await db.insert(threadParticipants).values([
        { id: randomUUID(), threadId: threadVisitId, userId: allan, joinedAt: new Date(), lastReadAt: null },
        { id: randomUUID(), threadId: threadVisitId, userId: susan, joinedAt: new Date(), lastReadAt: null },
        { id: randomUUID(), threadId: threadVisitId, userId: olivia, joinedAt: new Date(), lastReadAt: null },
        { id: randomUUID(), threadId: threadLabId, userId: susan, joinedAt: new Date(), lastReadAt: null },
      ]);

      const sponsorChainId = randomUUID();
      const systemChainId = randomUUID();
      const draftChainId = randomUUID();

      await db.insert(emailChains).values([
        {
          id: sponsorChainId,
          inboxId: inbox.id,
          subject: "Visit 3 blood sample timing confirmation",
          folder: "inbox",
          aiLabels: ["sponsor_query", "action_required"],
          aiPriority: "high",
          aiSummary: "Sponsor requesting confirmation of Visit 3 blood sample timing window.",
          aiSuggestedThreadId: threadVisitId,
          linkedThreadId: threadVisitId,
          fromAddress: "sponsor.ops@cro-example.com",
          fromName: "Sponsor Operations",
          toAddresses: [inbox.emailAddress],
          ccAddresses: [],
          messageCount: 1,
          isRead: false,
          isStarred: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: systemChainId,
          inboxId: inbox.id,
          subject: "CTMS Enrollment Update",
          folder: "inbox",
          aiLabels: ["system_notification", "fyi"],
          aiPriority: "low",
          aiSummary: "Enrollment update: 2 new patients screened.",
          aiSuggestedThreadId: null,
          linkedThreadId: null,
          fromAddress: "notifications@ctms.local",
          fromName: "CTMS System",
          toAddresses: [inbox.emailAddress],
          ccAddresses: [],
          messageCount: 1,
          isRead: false,
          isStarred: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: draftChainId,
          inboxId: inbox.id,
          subject: "Re: Visit 3 blood sample timing confirmation",
          folder: "drafts",
          aiLabels: ["draft"],
          aiPriority: "medium",
          aiSummary: "AI-generated draft reply pending coordinator review.",
          aiSuggestedThreadId: threadVisitId,
          linkedThreadId: threadVisitId,
          fromAddress: inbox.emailAddress,
          fromName: "Susan Johnson",
          toAddresses: ["sponsor.ops@cro-example.com"],
          ccAddresses: [],
          messageCount: 1,
          isRead: true,
          isStarred: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const aiResponseEmbedded = {
        type: "ai_response",
        sources: [
          {
            document_id: "protocol-main",
            document_name: "Protocol DN-2024-01",
            section_ref: "Section 5.5.3",
            quoted_text:
              "Visit 3 blood samples must be collected within a +/-2 hour window from scheduled collection time.",
            page_number: 64,
          },
        ],
        confidence: 0.91,
        query_intent: "protocol_question",
        suggested_actions: [
          { type: "view_document", label: "View source", data: {} },
          { type: "start_thread", label: "Discuss in thread", data: {} },
        ],
      };

      const taskCardEmbedded = {
        type: "task_card",
        task_id: `proposal-${randomUUID()}`,
        title: "Update site training materials on Visit 3 timing",
        assignee_id: String(susan),
        assignee_name: "Susan Johnson",
        due_date: "Tomorrow",
        status: "proposed",
      };

      const spawnedMessageId = randomUUID();

      await db.insert(messages).values([
        {
          id: randomUUID(),
          conversationId: dmConversationId,
          threadId: null,
          emailChainId: null,
          senderId: susan,
          senderType: "user",
          senderName: "Susan Johnson",
          senderEmail: "susan.johnson@themison.com",
          content:
            "Hey, can you look at Visit 3 protocol section? I think there is some confusion about timing.",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: dmConversationId,
          threadId: null,
          emailChainId: null,
          senderId: olivia,
          senderType: "user",
          senderName: "Olivia Rhye",
          senderEmail: "olivia.rhye@themison.com",
          content: "Here's the relevant section from the protocol:",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: dmConversationId,
          threadId: null,
          emailChainId: null,
          senderId: olivia,
          senderType: "user",
          senderName: "Olivia Rhye",
          senderEmail: "olivia.rhye@themison.com",
          content: "",
          contentType: "protocol_snippet",
          embeddedContent: {
            type: "protocol_snippet",
            protocol_id: "protocol-main",
            document_name: "Protocol DN-2024-01",
            section_ref: "Section 5.5.3",
            quoted_text:
              "At Visit 3, the subject must undergo a safety assessment including vital signs, physical examination, and review of adverse events. Blood samples must be collected within 2 hours of the visit start.",
            document_link: "/documents",
          },
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: dmConversationId,
          threadId: null,
          emailChainId: null,
          senderId: susan,
          senderType: "user",
          senderName: "Susan Johnson",
          senderEmail: "susan.johnson@themison.com",
          content: "Got it, so the 2-hour window is strict. Can you create a task to update the site training materials?",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: dmConversationId,
          threadId: null,
          emailChainId: null,
          senderId: olivia,
          senderType: "user",
          senderName: "Olivia Rhye",
          senderEmail: "olivia.rhye@themison.com",
          content: "Done! Created a task for you:",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: dmConversationId,
          threadId: null,
          emailChainId: null,
          senderId: olivia,
          senderType: "user",
          senderName: "Olivia Rhye",
          senderEmail: "olivia.rhye@themison.com",
          content: "",
          contentType: "task_card",
          embeddedContent: taskCardEmbedded,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: dmConversationId,
          threadId: null,
          emailChainId: null,
          senderId: susan,
          senderType: "user",
          senderName: "Susan Johnson",
          senderEmail: "susan.johnson@themison.com",
          content: "Perfect, thanks! I will get that done by EOD.",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: groupConversationId,
          threadId: null,
          emailChainId: null,
          senderId: allan,
          senderType: "user",
          senderName: "Allan Cook",
          senderEmail: "allan.cook@themison.com",
          content: "Can we clarify Visit 3 timing for remote sites?",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: groupConversationId,
          threadId: null,
          emailChainId: null,
          senderId: susan,
          senderType: "user",
          senderName: "Susan Johnson",
          senderEmail: "susan.johnson@themison.com",
          content: "@Themison can you pull the protocol language?",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: groupConversationId,
          threadId: null,
          emailChainId: null,
          senderId: null,
          senderType: "ai",
          senderName: "Themison AI",
          senderEmail: null,
          content:
            "Per protocol, Visit 3 blood sampling is constrained to a strict +/-2 hour window. [Source: Protocol DN-2024-01, Section 5.5.3]",
          contentType: "ai_response",
          embeddedContent: aiResponseEmbedded,
          isAiGenerated: true,
          aiModel: "gpt-4-turbo",
          aiLatencyMs: 940,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: spawnedMessageId,
          conversationId: groupConversationId,
          threadId: null,
          emailChainId: null,
          senderId: olivia,
          senderType: "user",
          senderName: "Olivia Rhye",
          senderEmail: "olivia.rhye@themison.com",
          content: "This looks like it should be a formal thread. I am starting one now.",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: groupConversationId,
          threadId: null,
          emailChainId: null,
          senderId: susan,
          senderType: "user",
          senderName: "Susan Johnson",
          senderEmail: "susan.johnson@themison.com",
          content: "Great, moving this into a Thread so we can capture the final decision.",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: null,
          threadId: threadVisitId,
          emailChainId: null,
          senderId: allan,
          senderType: "user",
          senderName: "Allan Cook",
          senderEmail: "allan.cook@themison.com",
          content: "Can remote sites use any flexibility for sample timing?",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: null,
          threadId: threadVisitId,
          emailChainId: null,
          senderId: null,
          senderType: "ai",
          senderName: "Themison AI",
          senderEmail: null,
          content: "Prepared an action suggestion for the team to confirm:",
          contentType: "task_card",
          embeddedContent: {
            ...taskCardEmbedded,
            title: "Confirm deviation process with sponsor for Visit 3 timing",
            due_date: "Friday",
          },
          isAiGenerated: true,
          aiModel: "gpt-4-turbo",
          aiLatencyMs: 670,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: null,
          threadId: threadVisitId,
          emailChainId: null,
          senderId: susan,
          senderType: "user",
          senderName: "Susan Johnson",
          senderEmail: "susan.johnson@themison.com",
          content:
            "@Allan Cook The 2-hour window is strict. Here is the protocol section and can Themison check amendments?",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: null,
          threadId: threadVisitId,
          emailChainId: null,
          senderId: null,
          senderType: "ai",
          senderName: "Themison AI",
          senderEmail: null,
          content:
            "The base requirement is strict +/-2 hours for Visit 3. [Source: Protocol DN-2024-01, Section 5.5.3]",
          contentType: "protocol_snippet",
          embeddedContent: {
            type: "protocol_snippet",
            protocol_id: "protocol-main",
            document_name: "Protocol DN-2024-01",
            section_ref: "Section 5.5.3",
            quoted_text:
              "Visit 3 blood samples must be collected within a +/-2 hour window from scheduled collection time.",
            document_link: "/documents",
          },
          isAiGenerated: true,
          aiModel: "gpt-4-turbo",
          aiLatencyMs: 720,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: null,
          threadId: threadVisitId,
          emailChainId: null,
          senderId: susan,
          senderType: "user",
          senderName: "Susan Johnson",
          senderEmail: "susan.johnson@themison.com",
          content:
            "Good find. I will reach out to the sponsor and create an action item so this is tracked.",
          contentType: "text",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: null,
          threadId: threadVisitId,
          emailChainId: null,
          senderId: null,
          senderType: "ai",
          senderName: "Themison AI",
          senderEmail: null,
          content:
            "Schedule of Activities confirms Visit 3 window and indicates deviations need documentation within 24h. [Source: Amendment v2, Schedule of Activities]",
          contentType: "ai_response",
          embeddedContent: {
            type: "ai_response",
            sources: [
              {
                document_id: "amendment-v2",
                document_name: "Amendment v2",
                section_ref: "Schedule of Activities",
                quoted_text: "Deviations must be documented within 24 hours.",
                page_number: 12,
              },
            ],
            confidence: 0.86,
            query_intent: "schedule_question",
            suggested_actions: [{ type: "view_document", label: "View SoA", data: {} }],
          },
          isAiGenerated: true,
          aiModel: "gpt-4-turbo",
          aiLatencyMs: 800,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: null,
          threadId: null,
          emailChainId: sponsorChainId,
          senderId: null,
          senderType: "email_external",
          senderName: "Sponsor Operations",
          senderEmail: "sponsor.ops@cro-example.com",
          content: "Please confirm the Visit 3 blood sample timing window.",
          contentType: "email",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: null,
          threadId: null,
          emailChainId: systemChainId,
          senderId: null,
          senderType: "email_external",
          senderName: "CTMS System",
          senderEmail: "notifications@ctms.local",
          content: "Enrollment update: 2 new patients screened.",
          contentType: "email",
          embeddedContent: null,
          isAiGenerated: false,
          aiModel: null,
          aiLatencyMs: null,
          editedAt: null,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          conversationId: null,
          threadId: null,
          emailChainId: draftChainId,
          senderId: null,
          senderType: "ai",
          senderName: "Themison AI",
          senderEmail: null,
          content:
            "Per Protocol Section 5.5.3, Visit 3 blood samples should be collected within a strict +/-2 hour window. Please let us know if additional detail is needed.",
          contentType: "email",
          embeddedContent: {
            type: "ai_response",
            sources: aiResponseEmbedded.sources,
            confidence: 0.9,
            query_intent: "email_draft",
            suggested_actions: [],
          },
          isAiGenerated: true,
          aiModel: "gpt-4-turbo",
          aiLatencyMs: 530,
          editedAt: null,
          createdAt: new Date(),
        },
      ]);

      await db.insert(crossReferences).values([
        {
          id: randomUUID(),
          sourceType: "email_chain",
          sourceId: sponsorChainId,
          targetType: "thread",
          targetId: threadVisitId,
          refType: "manual",
          createdBy: ctx.user.id,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          sourceType: "message",
          sourceId: spawnedMessageId,
          targetType: "thread",
          targetId: threadVisitId,
          refType: "spawned_from",
          createdBy: ctx.user.id,
          createdAt: new Date(),
        },
      ]);

      await logCollabEvent(db, {
        trialId: beTrialUuid,
        userId: ctx.user.id,
        layer: "messages",
        eventType: "collaboration_seeded",
        eventData: {
          conversations: 2,
          threads: 2,
          emailChains: 3,
        },
      });

      return {
        success: true,
        trialId: input.trialId,
      };
    }),
});
