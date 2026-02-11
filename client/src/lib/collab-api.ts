import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";
import type { CreateThreadInput, DraftResult, ThreadFilters } from "@/types/collaboration";

const collabTrpcClient = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

export const collabApi = {
  seedDemoData: (trialId: string) => collabTrpcClient.collaboration.seedDemoData.mutate({ trialId }),

  listConversations: (trialId: string) =>
    collabTrpcClient.collaboration.conversations.list.query({ trialId }),
  createConversation: (input: {
    trialId: string;
    type: "direct" | "group";
    name?: string;
    participantUserIds?: number[];
  }) => collabTrpcClient.collaboration.conversations.create.mutate(input),
  getConversationMessages: (conversationId: string, limit = 80) =>
    collabTrpcClient.collaboration.conversations.getMessages.query({ conversationId, limit }),
  sendConversationMessage: (input: {
    conversationId: string;
    content: string;
    contentType?: "text" | "protocol_snippet" | "task_card" | "ai_response" | "email";
    embeddedContent?: Record<string, unknown>;
  }) => collabTrpcClient.collaboration.conversations.sendMessage.mutate(input),
  markConversationRead: (conversationId: string) =>
    collabTrpcClient.collaboration.conversations.markRead.mutate({ conversationId }),

  listThreads: (trialId: string, filters?: ThreadFilters) =>
    collabTrpcClient.collaboration.threads.list.query({
      trialId,
      category: filters?.category,
      status: filters?.status,
    }),
  createThread: (input: CreateThreadInput & { participantUserIds?: number[]; initialMessage?: string }) =>
    collabTrpcClient.collaboration.threads.create.mutate({
      trialId: input.trialId,
      title: input.title,
      category: input.category,
      anchors: input.anchors,
      participantUserIds: input.participantUserIds,
      initialMessage: input.initialMessage,
    }),
  getThread: (threadId: string) => collabTrpcClient.collaboration.threads.get.query({ threadId }),
  addThreadMessage: (input: {
    threadId: string;
    content: string;
    contentType?: "text" | "protocol_snippet" | "task_card" | "ai_response" | "email";
    embeddedContent?: Record<string, unknown>;
  }) => collabTrpcClient.collaboration.threads.addMessage.mutate(input),
  resolveThread: (threadId: string, summary?: string, useAiSummary = false) =>
    collabTrpcClient.collaboration.threads.resolve.mutate({ threadId, summary, useAiSummary }),
  updateThreadStatus: (threadId: string, status: "open" | "pending" | "resolved" | "closed") =>
    collabTrpcClient.collaboration.threads.updateStatus.mutate({ threadId, status }),
  addThreadAnchor: (input: {
    threadId: string;
    anchorType:
      | "document_section"
      | "task"
      | "visit"
      | "trial_wide"
      | "therapeutic_area"
      | "team_member";
    anchorLabel: string;
    anchorRefId?: string;
    anchorRefType?: string;
  }) => collabTrpcClient.collaboration.threads.addAnchor.mutate(input),

  getInboxConfig: (trialId: string) => collabTrpcClient.collaboration.inbox.getConfig.query({ trialId }),
  listEmailChains: (input: {
    trialId: string;
    folder?: "inbox" | "sent" | "drafts" | "archived";
    label?: string;
    priority?: "high" | "medium" | "low";
  }) => collabTrpcClient.collaboration.inbox.listEmailChains.query(input),
  getEmailChain: (chainId: string) => collabTrpcClient.collaboration.inbox.getEmailChain.query({ chainId }),
  composeEmail: (input: {
    trialId: string;
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
  }) =>
    collabTrpcClient.collaboration.inbox.composeEmail.mutate({
      trialId: input.trialId,
      to: input.to,
      cc: input.cc ?? [],
      subject: input.subject,
      body: input.body,
    }),
  replyEmail: (input: {
    chainId: string;
    content: string;
    aiDraftMeta?: { generated: boolean; editedDistance?: number };
  }) => collabTrpcClient.collaboration.inbox.replyEmail.mutate(input),
  moveEmailFolder: (chainId: string, folder: "inbox" | "sent" | "drafts" | "archived") =>
    collabTrpcClient.collaboration.inbox.moveFolder.mutate({ chainId, folder }),
  markEmailRead: (chainId: string, isRead = true) =>
    collabTrpcClient.collaboration.inbox.markRead.mutate({ chainId, isRead }),
  dismissAILabel: (chainId: string, label: string) =>
    collabTrpcClient.collaboration.inbox.dismissLabel.mutate({ chainId, label }),
  linkEmailThread: (chainId: string, threadId: string) =>
    collabTrpcClient.collaboration.inbox.linkThread.mutate({ chainId, threadId }),
  createThreadFromEmail: (chainId: string, title: string, category: CreateThreadInput["category"]) =>
    collabTrpcClient.collaboration.inbox.createThread.mutate({ chainId, title, category }),
  draftWithAI: (chainId: string, instructions?: string) =>
    collabTrpcClient.collaboration.inbox.draftWithAI.mutate({ chainId, instructions }) as Promise<DraftResult>,

  startThreadFromMessage: (messageId: string, title: string, category: CreateThreadInput["category"]) =>
    collabTrpcClient.collaboration.crossLayer.startThreadFromMessage.mutate({ messageId, title, category }),
  createCrossReference: (input: {
    sourceType: "message" | "thread" | "email_chain" | "task";
    sourceId: string;
    targetType: "message" | "thread" | "email_chain" | "task";
    targetId: string;
    refType?: "manual" | "ai_suggested" | "spawned_from";
  }) => collabTrpcClient.collaboration.crossLayer.createReference.mutate(input),
  listCrossReferences: (sourceType: "message" | "thread" | "email_chain" | "task", sourceId: string) =>
    collabTrpcClient.collaboration.crossLayer.listReferences.query({ sourceType, sourceId }),

  classifyIntent: (content: string) => collabTrpcClient.collaboration.ai.classifyIntent.mutate({ content }),
  aiRespond: (input: {
    trialId: string;
    layer: "messages" | "threads" | "inbox";
    question: string;
    conversationId?: string;
    threadId?: string;
    emailChainId?: string;
  }) => collabTrpcClient.collaboration.ai.respond.mutate(input),
  triageEmail: (chainId: string) => collabTrpcClient.collaboration.ai.triageEmail.mutate({ chainId }),
  draftEmail: (chainId: string, instructions?: string) =>
    collabTrpcClient.collaboration.ai.draftEmail.mutate({ chainId, instructions }),
  createTaskProposal: (input: {
    trialId: string;
    content: string;
    conversationId?: string;
    threadId?: string;
    sourceMessageId?: string;
  }) => collabTrpcClient.collaboration.ai.createTask.mutate(input),
  suggestResolution: (threadId: string) => collabTrpcClient.collaboration.ai.suggestResolution.mutate({ threadId }),
  findRelatedThreads: (trialId: string, query: string) =>
    collabTrpcClient.collaboration.ai.findRelatedThreads.query({ trialId, query }),

  logCollabEvent: (input: {
    trialId: string;
    layer: "messages" | "threads" | "inbox";
    eventType: string;
    eventData?: Record<string, unknown>;
    aiInvolved?: boolean;
    aiModel?: string;
    aiLatencyMs?: number;
    aiAccepted?: boolean;
  }) => collabTrpcClient.collaboration.telemetry.log.mutate(input),
};
