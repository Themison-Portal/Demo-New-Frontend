/**
 * apiClient.ts
 * Unified API layer — replaces tRPC calls with
 * direct FastAPI BE calls.
 *
 * UUID guards prevent sending demo/fake IDs to BE.
 * Field mappers convert BE snake_case to FE camelCase.
 */

import type { CreateThreadInput, DraftResult, ThreadFilters, Conversation, CollaborationMessage } from "@/types/collaboration";

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────

const API_URL = import.meta.env.DEV
    ? "/api/be"
    : (import.meta.env.VITE_API_URL ?? "");

// ─────────────────────────────────────────
// UUID helpers
// ─────────────────────────────────────────

function isValidUUID(str: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function safeUUID(str: string | undefined | null): string | undefined {
    if (!str) return undefined;
    return isValidUUID(str) ? str : undefined;
}

// ─────────────────────────────────────────
// Field mappers — BE snake_case → FE camelCase
// ─────────────────────────────────────────

function mapInboxMessage(raw: any) {
    return {
        id: raw.id,
        inboxId: raw.organization_id ?? raw.id,
        subject: raw.subject,
        folder: raw.folder,
        aiLabels: raw.labels ?? [],
        aiPriority: null,
        aiSummary: raw.ai_summary ?? null,
        aiSuggestedThreadId: null,
        linkedThreadId: raw.related_thread_id ?? null,
        fromAddress: raw.sender_email ?? null,
        fromName: raw.sender_name ?? null,
        toAddresses: raw.to_addresses ?? [],
        ccAddresses: raw.cc_addresses ?? [],
        messageCount: 1,
        isRead: raw.is_read ?? false,
        isStarred: raw.is_starred ?? false,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at ?? raw.created_at,
        messages: raw.messages ?? undefined,
    };
}

function mapThread(raw: any) {
    return {
        id: raw.id,
        trialId: raw.trial_id ?? null,
        title: raw.title,
        category: raw.thread_type ?? "general",
        status: raw.is_resolved ? "resolved" : "open",
        resolvedBy: raw.resolved_by ?? null,
        resolvedAt: raw.resolved_at ?? null,
        resolutionSummary: raw.resolution_summary ?? null,
        aiContributed: false,
        aiResolutionSuggested: false,
        createdBy: raw.created_by ?? null,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
        anchors: (raw.anchors ?? []).map((a: any) => ({
            id: a.id ?? a.type,
            threadId: raw.id,
            anchorType: a.type,
            anchorLabel: a.label,
            anchorRefId: a.id ?? null,
            anchorRefType: null,
            createdAt: raw.created_at,
        })),
        replyCount: raw.reply_count ?? 0,
        messages: (raw.messages ?? []).map((m: any) => mapThreadMessage(m)),
    };
}

function mapThreadMessage(raw: any) {
    return {
        id: raw.id,
        conversationId: null,
        threadId: raw.thread_id,
        emailChainId: null,
        senderId: raw.sender_id ?? null,
        senderType: raw.role === "ai" ? "ai" : "user",
        senderName: raw.sender_name ?? (raw.role === "ai" ? "Themison AI" : null),
        senderEmail: null,
        content: raw.content,
        contentType: "text",
        embeddedContent: null,
        isAiGenerated: raw.role === "ai",
        aiModel: null,
        aiLatencyMs: null,
        editedAt: null,
        createdAt: raw.created_at,
    };
}

function mapConversation(raw: any) {
    return {
        id: raw.partner_id ?? raw.id,
        trialId: null,
        type: "direct",
        name: raw.partner_name ?? null,
        createdBy: null,
        createdAt: raw.last_message_at ?? new Date().toISOString(),
        updatedAt: raw.last_message_at ?? new Date().toISOString(),
        participants: [],
        lastMessage: raw.last_message ? {
            id: null,
            content: raw.last_message,
            contentType: "text",
            senderType: "user",
            senderName: null,
            createdAt: raw.last_message_at,
        } : null,
        unreadCount: raw.unread_count ?? 0,
    };
}

function mapDirectMessage(raw: any) {
    return {
        id: raw.id,
        conversationId: raw.sender_id,
        threadId: null,
        emailChainId: null,
        senderId: raw.sender_id,
        senderType: "user",
        senderName: raw.sender_name ?? null,
        senderEmail: null,
        content: raw.content,
        contentType: "text",
        embeddedContent: null,
        isAiGenerated: false,
        aiModel: null,
        aiLatencyMs: null,
        editedAt: null,
        createdAt: raw.sent_at ?? raw.created_at,
    };
}

// ─────────────────────────────────────────
// Core fetch wrapper
// ─────────────────────────────────────────

async function apiFetch<T>(
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const token = null; // AUTH_DISABLED=true — no token needed for demo

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string> ?? {}),
    };

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(error.detail ?? `API error: ${response.status}`);
    }

    if (response.status === 204) return {} as T;

    return response.json() as Promise<T>;
}

// ─────────────────────────────────────────
// Collaboration Hub API
// ─────────────────────────────────────────

export const collabApi = {

    // ─── Direct Messages ──────────────────────────────────────────────

    listConversations: async (trialId: string) => {
        const params = new URLSearchParams();
        // const safe = safeUUID(trialId);
        // if (safe) params.append("trial_id", safe);
        const rows = await apiFetch<any[]>(`/api/direct-messages/conversations?${params.toString()}`);
        return (rows ?? []).map(mapConversation) as unknown as Conversation[];
    },

    createConversation: (input: {
        trialId: string;
        type: "direct" | "group";
        name?: string;
        participantUserIds?: number[];
    }) => {
        const recipientId = input.participantUserIds?.[0];
        if (!recipientId) return Promise.resolve(null);
        return apiFetch(`/api/direct-messages/`, {
            method: "POST",
            body: JSON.stringify({
                trial_id: safeUUID(input.trialId),
                content: input.name ?? "",
                recipient_id: recipientId,
            }),
        });
    },

    getConversationMessages: async (conversationId: string, _limit = 80) => {
        if (!isValidUUID(conversationId)) return Promise.resolve([]);
        const rows = await apiFetch<any[]>(`/api/direct-messages/conversations/${conversationId}`);
        return (rows ?? []).map(mapDirectMessage) as unknown as CollaborationMessage[];
    },

    sendConversationMessage: (input: {
        conversationId: string;
        content: string;
        contentType?: string;
        embeddedContent?: Record<string, unknown>;
    }) => {
        if (!isValidUUID(input.conversationId)) return Promise.resolve(null);
        return apiFetch(`/api/direct-messages/`, {
            method: "POST",
            body: JSON.stringify({
                recipient_id: input.conversationId,
                content: input.content,
            }),
        });
    },

    markConversationRead: (conversationId: string) => {
        if (!isValidUUID(conversationId)) return Promise.resolve({ success: true });
        return apiFetch(`/api/direct-messages/${conversationId}/read`, {
            method: "PUT",
        });
    },

    // ─── Threads ──────────────────────────────────────────────────────

    listThreads: async (trialId: string, filters?: ThreadFilters) => {
        const params = new URLSearchParams();
        // const safe = safeUUID(trialId);
        // if (safe) params.append("trial_id", safe);
        if (filters?.category) params.append("thread_type", filters.category);
        if (filters?.status) params.append("is_resolved", String(filters.status === "resolved"));
        const rows = await apiFetch<any[]>(`/api/collaboration-threads/?${params.toString()}`);
        return (rows ?? []).map(mapThread);
    },

    createThread: async (input: CreateThreadInput & {
        participantUserIds?: number[];
        initialMessage?: string;
    }) => {
        const raw = await apiFetch<any>(`/api/collaboration-threads/`, {
            method: "POST",
            body: JSON.stringify({
                trial_id: safeUUID(input.trialId),
                title: input.title,
                thread_type: input.category,
                anchors: input.anchors ?? [],
            }),
        });
        return mapThread(raw);
    },

    getThread: async (threadId: string) => {
        if (!isValidUUID(threadId)) return Promise.resolve(null);
        const raw = await apiFetch<any>(`/api/collaboration-threads/${threadId}`);
        return raw ? mapThread(raw) : null;
    },

    addThreadMessage: async (input: {
        threadId: string;
        content: string;
        contentType?: string;
        embeddedContent?: Record<string, unknown>;
    }) => {
        if (!isValidUUID(input.threadId)) return Promise.resolve(null);
        const raw = await apiFetch<any>(`/api/collaboration-threads/${input.threadId}/messages`, {
            method: "POST",
            body: JSON.stringify({
                content: input.content,
                role: "user",
            }),
        });
        return raw ? mapThreadMessage(raw) : null;
    },

    resolveThread: (threadId: string, summary?: string, _useAiSummary = false) => {
        if (!isValidUUID(threadId)) return Promise.resolve(null);
        const params = new URLSearchParams();
        if (summary) params.append("resolution_summary", summary);
        return apiFetch(`/api/collaboration-threads/${threadId}/resolve?${params.toString()}`, {
            method: "POST",
        });
    },

    updateThreadStatus: (threadId: string, status: "open" | "pending" | "resolved" | "closed") => {
        if (!isValidUUID(threadId)) return Promise.resolve(null);
        return apiFetch(`/api/collaboration-threads/${threadId}`, {
            method: "PUT",
            body: JSON.stringify({ is_resolved: status === "resolved" }),
        });
    },

    addThreadAnchor: (input: {
        threadId: string;
        anchorType: string;
        anchorLabel: string;
        anchorRefId?: string;
        anchorRefType?: string;
    }) => {
        if (!isValidUUID(input.threadId)) return Promise.resolve(null);
        return apiFetch(`/api/collaboration-threads/${input.threadId}`, {
            method: "PUT",
            body: JSON.stringify({
                anchors: [{
                    type: input.anchorType,
                    label: input.anchorLabel,
                    id: input.anchorRefId ?? null,
                }],
            }),
        });
    },

    // ─── Inbox ────────────────────────────────────────────────────────

    getInboxConfig: (trialId: string) => {
        const params = new URLSearchParams();
        // const safe = safeUUID(trialId);
        // if (safe) params.append("trial_id", safe);
        return apiFetch(`/api/inbox/config?${params.toString()}`);
    },

    getInboxCounts: async () => {
        const data = await apiFetch<any>(`/api/inbox/counts`);
        return data;
    },

    listEmailChains: async (input: {
        trialId: string;
        folder?: "inbox" | "sent" | "drafts" | "archived";
        label?: string;
        priority?: "high" | "medium" | "low";
    }) => {
        const params = new URLSearchParams();
        // don't send trial_id — messages are org-scoped, not trial-scoped
        // const safe = safeUUID(input.trialId);
        // if (safe) params.append("trial_id", safe);
        if (input.folder) params.append("folder", input.folder);
        const rows = await apiFetch<any[]>(`/api/inbox/?${params.toString()}`);
        return (rows ?? []).map(mapInboxMessage);
    },

    getEmailChain: async (chainId: string) => {
        if (!isValidUUID(chainId)) return Promise.resolve(null);
        const raw = await apiFetch<any>(`/api/inbox/${chainId}`);
        return raw ? mapInboxMessage(raw) : null;
    },

    composeEmail: async (input: {
        trialId: string;
        to: string[];
        cc?: string[];
        subject: string;
        body: string;
    }) => {
        console.log("composeEmail called with:", input);
        console.log("API_URL:", API_URL);
        const result = await apiFetch<Record<string, unknown>>(`/api/inbox/`, {
            method: "POST",
            body: JSON.stringify({
                // remove trial_id — let BE scope to org only
                // trial_id: safeUUID(input.trialId),
                sender_name: "Me",
                to_addresses: input.to,
                cc_addresses: input.cc ?? [],
                subject: input.subject,
                body: input.body,
                folder: "sent",
            }),
        });
        console.log("composeEmail result:", result);
        return result;
    },

    replyEmail: (input: {
        chainId: string;
        content: string;
        aiDraftMeta?: { generated: boolean; editedDistance?: number };
    }) => {
        if (!isValidUUID(input.chainId)) return Promise.resolve(null);
        return apiFetch(`/api/inbox/${input.chainId}/reply`, {
            method: "POST",
            body: JSON.stringify({
                to_addresses: [],
                body: input.content,
            }),
        });
    },

    moveEmailFolder: (chainId: string, folder: "inbox" | "sent" | "drafts" | "archived") => {
        if (!isValidUUID(chainId)) return Promise.resolve(null);
        return apiFetch(`/api/inbox/${chainId}`, {
            method: "PUT",
            body: JSON.stringify({ folder }),
        });
    },

    markEmailRead: (chainId: string, isRead = true) => {
        if (!isValidUUID(chainId)) return Promise.resolve(null);
        return apiFetch(`/api/inbox/${chainId}`, {
            method: "PUT",
            body: JSON.stringify({ is_read: isRead }),
        });
    },

    dismissAILabel: (chainId: string, _label: string) => {
        if (!isValidUUID(chainId)) return Promise.resolve(null);
        return apiFetch(`/api/inbox/${chainId}`, {
            method: "PUT",
            body: JSON.stringify({ labels: [] }),
        });
    },

    linkEmailThread: (chainId: string, threadId: string) => {
        if (!isValidUUID(chainId)) return Promise.resolve(null);
        return apiFetch(`/api/inbox/${chainId}`, {
            method: "PUT",
            body: JSON.stringify({ related_thread_id: safeUUID(threadId) }),
        });
    },

    createThreadFromEmail: (chainId: string, title: string, category: CreateThreadInput["category"]) => {
        if (!isValidUUID(chainId)) return Promise.resolve(null);
        return apiFetch(`/api/collaboration-threads/`, {
            method: "POST",
            body: JSON.stringify({
                title,
                thread_type: category,
                anchors: [],
            }),
        });
    },

    draftWithAI: (chainId: string, _instructions?: string) => {
        if (!isValidUUID(chainId)) return Promise.resolve(null);
        return apiFetch(`/api/inbox/${chainId}/ai-triage`, {
            method: "POST",
        }) as Promise<DraftResult>;
    },

    // ─── Cross Layer ──────────────────────────────────────────────────

    startThreadFromMessage: (messageId: string, title: string, category: CreateThreadInput["category"]) => {
        if (!isValidUUID(messageId)) return Promise.resolve(null);
        return apiFetch(`/api/collaboration-threads/`, {
            method: "POST",
            body: JSON.stringify({
                title,
                thread_type: category,
                anchors: [],
            }),
        });
    },

    createCrossReference: (_input: {
        sourceType: string;
        sourceId: string;
        targetType: string;
        targetId: string;
        refType?: string;
    }) => Promise.resolve({ success: true }),

    listCrossReferences: (_sourceType: string, _sourceId: string) =>
        Promise.resolve([]),

    // ─── AI ───────────────────────────────────────────────────────────

    classifyIntent: (_content: string) =>
        Promise.resolve({ intent: "general_question" }),

    aiRespond: (input: {
        trialId: string;
        layer: "messages" | "threads" | "inbox";
        question: string;
        conversationId?: string;
        threadId?: string;
        emailChainId?: string;
    }) => {
        if (input.threadId && isValidUUID(input.threadId)) {
            return apiFetch(`/api/collaboration-threads/${input.threadId}/messages`, {
                method: "POST",
                body: JSON.stringify({ content: input.question, role: "ai" }),
            });
        }
        if (input.emailChainId && isValidUUID(input.emailChainId)) {
            return apiFetch(`/api/inbox/${input.emailChainId}/ai-triage`, { method: "POST" });
        }
        return Promise.resolve({ text: "" });
    },

    triageEmail: (chainId: string) => {
        if (!isValidUUID(chainId)) return Promise.resolve(null);
        return apiFetch(`/api/inbox/${chainId}/ai-triage`, { method: "POST" });
    },

    draftEmail: (chainId: string, _instructions?: string) => {
        if (!isValidUUID(chainId)) return Promise.resolve(null);
        return apiFetch(`/api/inbox/${chainId}/ai-triage`, { method: "POST" }) as Promise<DraftResult>;
    },

    createTaskProposal: (_input: {
        trialId: string;
        content: string;
        conversationId?: string;
        threadId?: string;
        sourceMessageId?: string;
    }) => Promise.resolve({ taskCard: null, messageId: null, requiresConfirmation: true }),

    suggestResolution: (threadId: string) => {
        if (!isValidUUID(threadId)) return Promise.resolve(null);
        return apiFetch(`/api/collaboration-threads/${threadId}/ai-draft`, { method: "POST" });
    },

    findRelatedThreads: async (trialId: string, query: string) => {
        const params = new URLSearchParams();
        // const safe = safeUUID(trialId);
        // if (safe) params.append("trial_id", safe);
        if (query) params.append("search", encodeURIComponent(query));
        const rows = await apiFetch<any[]>(`/api/collaboration-threads/?${params.toString()}`);
        return (rows ?? []).map(mapThread);
    },

    // ─── Telemetry ────────────────────────────────────────────────────

    logCollabEvent: (_input: {
        trialId: string;
        layer: string;
        eventType: string;
        eventData?: Record<string, unknown>;
        aiInvolved?: boolean;
        aiModel?: string;
        aiLatencyMs?: number;
        aiAccepted?: boolean;
    }) => Promise.resolve({ success: true }),

    // ─── Demo seed (not needed — BE starts fresh) ─────────────────────

    seedDemoData: (_trialId: string) =>
        Promise.resolve({ success: true, skipped: true }),
};