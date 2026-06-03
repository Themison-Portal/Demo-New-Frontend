/**
 * apiClient.ts
 * Unified API layer — replaces tRPC calls with
 * direct FastAPI BE calls.
 *
 * UUID guards prevent sending demo/fake IDs to BE.
 */

import type { CreateThreadInput, DraftResult, ThreadFilters } from "@/types/collaboration";

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL ?? "";

// ─────────────────────────────────────────
// UUID helpers
// ─────────────────────────────────────────

function isValidUUID(str: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Returns UUID string if valid, undefined otherwise
function safeUUID(str: string | undefined | null): string | undefined {
    if (!str) return undefined;
    return isValidUUID(str) ? str : undefined;
}

// ─────────────────────────────────────────
// Core fetch wrapper
// ─────────────────────────────────────────

async function getAuthToken(): Promise<string | null> {
    try {
        const res = await fetch("/api/auth/token");
        if (!res.ok) return null;
        const data = await res.json();
        return data.accessToken ?? null;
    } catch {
        return null;
    }
}

async function apiFetch<T>(
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const token = await getAuthToken();

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

    listConversations: (trialId: string) => {
        const params = new URLSearchParams();
        const safe = safeUUID(trialId);
        if (safe) params.append("trial_id", safe);
        return apiFetch(`/api/direct-messages/conversations?${params.toString()}`);
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

    getConversationMessages: (conversationId: string, _limit = 80) => {
        if (!isValidUUID(conversationId)) return Promise.resolve([]);
        return apiFetch(`/api/direct-messages/conversations/${conversationId}`);
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

    listThreads: (trialId: string, filters?: ThreadFilters) => {
        const params = new URLSearchParams();
        const safe = safeUUID(trialId);
        if (safe) params.append("trial_id", safe);
        if (filters?.category) params.append("thread_type", filters.category);
        if (filters?.status) params.append("is_resolved", String(filters.status === "resolved"));
        return apiFetch(`/api/collaboration-threads/?${params.toString()}`);
    },

    createThread: (input: CreateThreadInput & {
        participantUserIds?: number[];
        initialMessage?: string;
    }) =>
        apiFetch(`/api/collaboration-threads/`, {
            method: "POST",
            body: JSON.stringify({
                trial_id: safeUUID(input.trialId),
                title: input.title,
                thread_type: input.category,
                anchors: input.anchors ?? [],
            }),
        }),

    getThread: (threadId: string) => {
        if (!isValidUUID(threadId)) return Promise.resolve(null);
        return apiFetch(`/api/collaboration-threads/${threadId}`);
    },

    addThreadMessage: (input: {
        threadId: string;
        content: string;
        contentType?: string;
        embeddedContent?: Record<string, unknown>;
    }) => {
        if (!isValidUUID(input.threadId)) return Promise.resolve(null);
        return apiFetch(`/api/collaboration-threads/${input.threadId}/messages`, {
            method: "POST",
            body: JSON.stringify({
                content: input.content,
                role: "user",
            }),
        });
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
        const safe = safeUUID(trialId);
        if (safe) params.append("trial_id", safe);
        return apiFetch(`/api/inbox/counts?${params.toString()}`);
    },

    listEmailChains: (input: {
        trialId: string;
        folder?: "inbox" | "sent" | "drafts" | "archived";
        label?: string;
        priority?: "high" | "medium" | "low";
    }) => {
        const params = new URLSearchParams();
        const safe = safeUUID(input.trialId);
        if (safe) params.append("trial_id", safe);
        if (input.folder) params.append("folder", input.folder);
        return apiFetch(`/api/inbox/?${params.toString()}`);
    },

    getEmailChain: (chainId: string) => {
        if (!isValidUUID(chainId)) return Promise.resolve(null);
        return apiFetch(`/api/inbox/${chainId}`);
    },

    composeEmail: (input: {
        trialId: string;
        to: string[];
        cc?: string[];
        subject: string;
        body: string;
    }) =>
        apiFetch(`/api/inbox/`, {
            method: "POST",
            body: JSON.stringify({
                trial_id: safeUUID(input.trialId),
                sender_name: "Me",
                to_addresses: input.to,
                cc_addresses: input.cc ?? [],
                subject: input.subject,
                body: input.body,
                folder: "sent",
            }),
        }),

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

    findRelatedThreads: (trialId: string, query: string) => {
        const params = new URLSearchParams();
        const safe = safeUUID(trialId);
        if (safe) params.append("trial_id", safe);
        if (query) params.append("search", encodeURIComponent(query));
        return apiFetch(`/api/collaboration-threads/?${params.toString()}`);
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