import { useSyncExternalStore } from "react";
import { collabApi } from "@/lib/collab-api";
import type {
  CollaborationLayer,
  CollaborationMessage,
  Conversation,
  CreateThreadInput,
  DraftResult,
  EmailChain,
  ThreadFilters,
  TrialInbox,
  TrialThread,
} from "@/types/collaboration";

type InboxFolderView = "inbox" | "unread" | "sent" | "drafts";

type CollaborationStore = {
  activeLayer: CollaborationLayer;
  setActiveLayer: (layer: CollaborationLayer) => void;

  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, CollaborationMessage[]>;
  aiIsTyping: boolean;
  setActiveConversation: (conversationId: string | null) => void;
  loadConversations: (trialId: string) => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    content: string,
    embeddedContent?: Record<string, unknown>
  ) => Promise<void>;

  threads: TrialThread[];
  activeThreadId: string | null;
  threadMessages: Record<string, CollaborationMessage[]>;
  threadFilters: ThreadFilters;
  setActiveThread: (threadId: string | null) => void;
  setThreadFilters: (filters: ThreadFilters) => void;
  loadThreads: (trialId: string, filters?: ThreadFilters) => Promise<void>;
  loadThreadMessages: (threadId: string) => Promise<void>;
  createThread: (data: CreateThreadInput) => Promise<TrialThread | null>;
  resolveThread: (threadId: string, summary: string) => Promise<void>;
  requestAIResolutionSummary: (threadId: string) => Promise<string>;

  inboxConfig: TrialInbox | null;
  emailChains: EmailChain[];
  activeEmailChainId: string | null;
  emailMessages: Record<string, CollaborationMessage[]>;
  activeFolder: InboxFolderView;
  aiDraft: DraftResult | null;
  aiDraftLoading: boolean;
  setActiveFolder: (folder: InboxFolderView) => void;
  setActiveEmailChain: (chainId: string | null) => void;
  loadInbox: (trialId: string) => Promise<void>;
  loadEmailChains: (folder?: InboxFolderView) => Promise<void>;
  loadEmailMessages: (chainId: string) => Promise<void>;
  dismissAILabel: (chainId: string, label: string) => Promise<void>;
  requestAIDraft: (chainId: string, instructions?: string) => Promise<DraftResult>;

  spawnThreadFromMessage: (messageId: string, threadData: CreateThreadInput) => Promise<TrialThread | null>;
  linkEmailToThread: (emailChainId: string, threadId: string) => Promise<void>;
  createThreadFromEmail: (emailChainId: string, threadData: CreateThreadInput) => Promise<TrialThread | null>;

  subscribeToUpdates: (trialId: string) => void;
  unsubscribe: () => void;

  isLoading: boolean;
  error: string | null;
};

const listeners = new Set<() => void>();
let pollTimer: number | null = null;
let subscribedTrialId: string | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

const state: CollaborationStore = {
  activeLayer: "messages",
  setActiveLayer(layer) {
    state.activeLayer = layer;
    emit();
  },

  conversations: [],
  activeConversationId: null,
  messages: {},
  aiIsTyping: false,
  setActiveConversation(conversationId) {
    state.activeConversationId = conversationId;
    emit();
  },
  async loadConversations(trialId) {
    state.isLoading = true;
    state.error = null;
    emit();
    try {
      state.conversations = (await collabApi.listConversations(trialId)) as Conversation[];
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to load conversations";
    } finally {
      state.isLoading = false;
      emit();
    }
  },
  async loadMessages(conversationId) {
    try {
      state.messages[conversationId] = (await collabApi.getConversationMessages(
        conversationId,
        120
      )) as CollaborationMessage[];
      emit();
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to load messages";
      emit();
    }
  },
  async sendMessage(conversationId, content, embeddedContent) {
    if (!content.trim()) return;
    const optimistic: CollaborationMessage = {
      id: `tmp-${Date.now()}`,
      conversationId,
      threadId: null,
      emailChainId: null,
      senderId: null,
      senderType: "user",
      senderName: "You",
      senderEmail: null,
      content,
      contentType: "text",
      embeddedContent: embeddedContent ?? null,
      isAiGenerated: false,
      aiModel: null,
      aiLatencyMs: null,
      editedAt: null,
      createdAt: new Date().toISOString(),
    };

    state.messages[conversationId] = [...(state.messages[conversationId] || []), optimistic];
    state.aiIsTyping = true;
    emit();

    try {
      await collabApi.sendConversationMessage({
        conversationId,
        content,
        embeddedContent,
      });
      await state.loadMessages(conversationId);
      if (subscribedTrialId) {
        await state.loadConversations(subscribedTrialId);
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to send message";
    } finally {
      state.aiIsTyping = false;
      emit();
    }
  },

  threads: [],
  activeThreadId: null,
  threadMessages: {},
  threadFilters: {},
  setActiveThread(threadId) {
    state.activeThreadId = threadId;
    emit();
  },
  setThreadFilters(filters) {
    state.threadFilters = { ...filters };
    emit();
  },
  async loadThreads(trialId, filters) {
    state.isLoading = true;
    state.error = null;
    emit();
    try {
      state.threadFilters = filters ?? state.threadFilters;
      state.threads = (await collabApi.listThreads(trialId, state.threadFilters)) as TrialThread[];
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to load threads";
    } finally {
      state.isLoading = false;
      emit();
    }
  },
  async loadThreadMessages(threadId) {
    try {
      const thread = (await collabApi.getThread(threadId)) as TrialThread | null;
      state.threadMessages[threadId] = (thread?.messages || []) as CollaborationMessage[];
      emit();
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to load thread messages";
      emit();
    }
  },
  async createThread(data) {
    try {
      const created = await collabApi.createThread(data);
      await state.loadThreads(data.trialId);
      if (!created?.id) return null;
      const thread = (await collabApi.getThread(created.id)) as TrialThread | null;
      return thread;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to create thread";
      emit();
      return null;
    }
  },
  async resolveThread(threadId, summary) {
    try {
      await collabApi.resolveThread(threadId, summary, false);
      const activeThread = state.threads.find((thread) => thread.id === threadId);
      if (activeThread) {
        await state.loadThreads(activeThread.trialId, state.threadFilters);
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to resolve thread";
      emit();
    }
  },
  async requestAIResolutionSummary(threadId) {
    try {
      const result = await collabApi.suggestResolution(threadId);
      return String(result.summary || "");
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to generate AI summary";
      emit();
      return "";
    }
  },

  inboxConfig: null,
  emailChains: [],
  activeEmailChainId: null,
  emailMessages: {},
  activeFolder: "inbox",
  aiDraft: null,
  aiDraftLoading: false,
  setActiveFolder(folder) {
    state.activeFolder = folder;
    emit();
  },
  setActiveEmailChain(chainId) {
    state.activeEmailChainId = chainId;
    emit();
  },
  async loadInbox(trialId) {
    state.isLoading = true;
    state.error = null;
    emit();
    try {
      state.inboxConfig = (await collabApi.getInboxConfig(trialId)) as TrialInbox;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to load inbox";
    } finally {
      state.isLoading = false;
      emit();
    }
  },
  async loadEmailChains(folder) {
    const selected = folder ?? state.activeFolder;
    state.activeFolder = selected;
    if (!state.inboxConfig) return;

    const folderFilter = selected === "unread" ? "inbox" : selected;
    try {
      const rows = (await collabApi.listEmailChains({
        trialId: state.inboxConfig.trialId,
        folder: folderFilter === "inbox" || folderFilter === "sent" || folderFilter === "drafts" || folderFilter === "archived"
          ? folderFilter
          : undefined,
      })) as EmailChain[];

      state.emailChains = selected === "unread" ? rows.filter((row) => !row.isRead) : rows;
      emit();
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to load email chains";
      emit();
    }
  },
  async loadEmailMessages(chainId) {
    try {
      const chain = (await collabApi.getEmailChain(chainId)) as EmailChain | null;
      state.emailMessages[chainId] = (chain?.messages || []) as CollaborationMessage[];
      emit();
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to load email messages";
      emit();
    }
  },
  async dismissAILabel(chainId, label) {
    try {
      await collabApi.dismissAILabel(chainId, label);
      await state.loadEmailChains(state.activeFolder);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to dismiss label";
      emit();
    }
  },
  async requestAIDraft(chainId, instructions) {
    state.aiDraftLoading = true;
    emit();
    try {
      const draft = (await collabApi.draftWithAI(chainId, instructions)) as DraftResult;
      state.aiDraft = draft;
      return draft;
    } finally {
      state.aiDraftLoading = false;
      emit();
    }
  },

  async spawnThreadFromMessage(messageId, threadData) {
    try {
      const created = await collabApi.startThreadFromMessage(messageId, threadData.title, threadData.category);
      await state.loadThreads(threadData.trialId, state.threadFilters);
      if (!created?.threadId) return null;
      return (await collabApi.getThread(created.threadId)) as TrialThread | null;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to spawn thread";
      emit();
      return null;
    }
  },
  async linkEmailToThread(emailChainId, threadId) {
    try {
      await collabApi.linkEmailThread(emailChainId, threadId);
      await state.loadEmailChains(state.activeFolder);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to link email to thread";
      emit();
    }
  },
  async createThreadFromEmail(emailChainId, threadData) {
    try {
      const created = await collabApi.createThreadFromEmail(emailChainId, threadData.title, threadData.category);
      await Promise.all([
        state.loadThreads(threadData.trialId, state.threadFilters),
        state.loadEmailChains(state.activeFolder),
      ]);
      if (!created?.threadId) return null;
      return (await collabApi.getThread(created.threadId)) as TrialThread | null;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to create thread from email";
      emit();
      return null;
    }
  },

  subscribeToUpdates(trialId) {
    subscribedTrialId = trialId;
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }

    const tick = async () => {
      if (!subscribedTrialId) return;
      try {
        await Promise.all([
          state.loadConversations(subscribedTrialId),
          state.loadThreads(subscribedTrialId, state.threadFilters),
          state.loadInbox(subscribedTrialId),
        ]);

        await state.loadEmailChains(state.activeFolder);

        await Promise.all([
          state.activeConversationId ? state.loadMessages(state.activeConversationId) : Promise.resolve(),
          state.activeThreadId ? state.loadThreadMessages(state.activeThreadId) : Promise.resolve(),
          state.activeEmailChainId ? state.loadEmailMessages(state.activeEmailChainId) : Promise.resolve(),
        ]);
      } catch {
        // noop: polling errors are captured in state.error in individual calls
      }
    };

    pollTimer = window.setInterval(tick, 3500);
    void tick();
  },
  unsubscribe() {
    subscribedTrialId = null;
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  },

  isLoading: false,
  error: null,
};

const store = state;

export function useCollaborationStore<T>(selector: (snapshot: CollaborationStore) => T) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => selector(store),
    () => selector(store)
  );
}

export function getCollaborationStore() {
  return store;
}
