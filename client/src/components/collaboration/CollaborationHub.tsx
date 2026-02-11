import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Inbox, MailPlus, MessageCircle, MessagesSquare, Plus, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { collabApi } from "@/lib/collab-api";
import { useCollaborationStore } from "@/stores/collaborationStore";
import { useRealtimeCollab } from "@/hooks/useRealtimeCollab";
import type { Conversation, ThreadCategory, TrialThread } from "@/types/collaboration";
import { ConversationView } from "@/components/collaboration/messages/ConversationView";
import { ThreadView } from "@/components/collaboration/threads/ThreadView";
import { EmailView } from "@/components/collaboration/inbox/EmailView";
import { ComposeEmail } from "@/components/collaboration/inbox/ComposeEmail";
import { ThreadCategoryBadge } from "@/components/collaboration/threads/ThreadCategoryBadge";
import { ThreadStatusBadge } from "@/components/collaboration/threads/ThreadStatusBadge";
import { useLocation } from "wouter";

interface CollaborationHubProps {
  trialId: string;
}

type DetailMode = "conversation" | "thread" | "email";

function formatTime(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelative(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const now = Date.now();
  const diff = Math.max(1, Math.round((now - date.getTime()) / 60000));
  if (diff < 60) return `${diff}m`;
  if (diff < 24 * 60) return `${Math.round(diff / 60)}h`;
  return `${Math.round(diff / (24 * 60))}d`;
}

function initials(value: string) {
  const parts = value
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts[0]?.[0] || "?") + (parts[1]?.[0] || "");
}

function getConversationDisplayName(conversation: Conversation, currentUserId: number | null) {
  if (conversation.type === "group") {
    return conversation.name || "Group Conversation";
  }

  const participants = (conversation.participants || []).filter((participant) => participant.user?.name);
  if (!participants.length) return conversation.name || "Conversation";

  if (currentUserId != null) {
    const other = participants.find((participant) => participant.userId !== currentUserId);
    if (other?.user?.name) return other.user.name;
  } else {
    const other = participants.find((participant) => participant.userId !== conversation.createdBy);
    if (other?.user?.name) return other.user.name;
  }

  return participants[0]?.user?.name || conversation.name || "Conversation";
}

export function CollaborationHub({ trialId }: CollaborationHubProps) {
  const [, navigate] = useLocation();
  const setActiveLayer = useCollaborationStore((store) => store.setActiveLayer);

  const conversations = useCollaborationStore((store) => store.conversations);
  const activeConversationId = useCollaborationStore((store) => store.activeConversationId);
  const setActiveConversation = useCollaborationStore((store) => store.setActiveConversation);
  const conversationMessagesMap = useCollaborationStore((store) => store.messages);
  const loadConversations = useCollaborationStore((store) => store.loadConversations);
  const loadConversationMessages = useCollaborationStore((store) => store.loadMessages);
  const sendConversationMessage = useCollaborationStore((store) => store.sendMessage);
  const aiIsTyping = useCollaborationStore((store) => store.aiIsTyping);

  const threads = useCollaborationStore((store) => store.threads);
  const activeThreadId = useCollaborationStore((store) => store.activeThreadId);
  const setActiveThread = useCollaborationStore((store) => store.setActiveThread);
  const threadMessages = useCollaborationStore((store) => store.threadMessages);
  const loadThreads = useCollaborationStore((store) => store.loadThreads);
  const loadThreadMessages = useCollaborationStore((store) => store.loadThreadMessages);
  const createThread = useCollaborationStore((store) => store.createThread);
  const resolveThread = useCollaborationStore((store) => store.resolveThread);
  const requestAIResolutionSummary = useCollaborationStore((store) => store.requestAIResolutionSummary);
  const threadFilters = useCollaborationStore((store) => store.threadFilters);

  const inboxConfig = useCollaborationStore((store) => store.inboxConfig);
  const loadInbox = useCollaborationStore((store) => store.loadInbox);
  const emailChains = useCollaborationStore((store) => store.emailChains);
  const loadEmailChains = useCollaborationStore((store) => store.loadEmailChains);
  const activeEmailChainId = useCollaborationStore((store) => store.activeEmailChainId);
  const setActiveEmailChain = useCollaborationStore((store) => store.setActiveEmailChain);
  const emailMessagesMap = useCollaborationStore((store) => store.emailMessages);
  const loadEmailMessages = useCollaborationStore((store) => store.loadEmailMessages);
  const activeFolder = useCollaborationStore((store) => store.activeFolder);
  const setActiveFolder = useCollaborationStore((store) => store.setActiveFolder);
  const requestAIDraft = useCollaborationStore((store) => store.requestAIDraft);
  const linkEmailToThread = useCollaborationStore((store) => store.linkEmailToThread);

  const [showCompose, setShowCompose] = useState(false);
  const [detailMode, setDetailMode] = useState<DetailMode>("conversation");
  const [dmSearch, setDmSearch] = useState("");

  useRealtimeCollab(trialId);

  useEffect(() => {
    void collabApi.seedDemoData(trialId).catch(() => null);
    void Promise.all([loadConversations(trialId), loadThreads(trialId), loadInbox(trialId)]);
  }, [loadConversations, loadInbox, loadThreads, trialId]);

  useEffect(() => {
    if (!activeConversationId && conversations.length) {
      setActiveConversation(conversations[0].id);
    }
  }, [activeConversationId, conversations, setActiveConversation]);

  useEffect(() => {
    if (activeConversationId) {
      void loadConversationMessages(activeConversationId);
    }
  }, [activeConversationId, loadConversationMessages]);

  useEffect(() => {
    if (!activeThreadId && threads.length) {
      setActiveThread(threads[0].id);
    }
  }, [activeThreadId, setActiveThread, threads]);

  useEffect(() => {
    if (activeThreadId) {
      void loadThreadMessages(activeThreadId);
    }
  }, [activeThreadId, loadThreadMessages]);

  useEffect(() => {
    if (inboxConfig) {
      void loadEmailChains(activeFolder);
    }
  }, [activeFolder, inboxConfig, loadEmailChains]);

  useEffect(() => {
    if (!activeEmailChainId && emailChains.length) {
      setActiveEmailChain(emailChains[0].id);
    }
  }, [activeEmailChainId, emailChains, setActiveEmailChain]);

  useEffect(() => {
    if (activeEmailChainId) {
      void loadEmailMessages(activeEmailChainId);
    }
  }, [activeEmailChainId, loadEmailMessages]);

  useEffect(() => {
    if (detailMode === "conversation" && !activeConversationId && activeThreadId) {
      setDetailMode("thread");
      return;
    }
    if (detailMode === "thread" && !activeThreadId && activeEmailChainId) {
      setDetailMode("email");
      return;
    }
    if (detailMode === "email" && !activeEmailChainId && activeConversationId) {
      setDetailMode("conversation");
    }
  }, [activeConversationId, activeEmailChainId, activeThreadId, detailMode]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || null,
    [activeConversationId, conversations]
  );

  const activeThread = useMemo<TrialThread | null>(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [activeThreadId, threads]
  );

  const activeEmailChain = useMemo(
    () => emailChains.find((chain) => chain.id === activeEmailChainId) || null,
    [activeEmailChainId, emailChains]
  );

  const inboxCounts = useMemo(() => {
    const unread = emailChains.filter((chain) => !chain.isRead).length;
    const sent = emailChains.filter((chain) => chain.folder === "sent").length;
    const drafts = emailChains.filter((chain) => chain.folder === "drafts").length;
    const inbox = emailChains.filter((chain) => chain.folder === "inbox").length;
    return { unread, sent, drafts, inbox };
  }, [emailChains]);

  const currentUserId = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem("manus-runtime-user-info");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { id?: unknown };
      const id = Number(parsed?.id);
      return Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
  }, []);

  const filteredConversations = useMemo(() => {
    const normalized = dmSearch.trim().toLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((conversation) => {
      const name = getConversationDisplayName(conversation, currentUserId).toLowerCase();
      const preview = String(conversation.lastMessage?.content || "").toLowerCase();
      return `${name} ${preview}`.includes(normalized);
    });
  }, [conversations, currentUserId, dmSearch]);

  const sortedEmailChains = useMemo(
    () => [...emailChains].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [emailChains]
  );

  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [threads]
  );

  const folderTabs = [
    { key: "inbox", label: "Inbox", count: inboxCounts.inbox },
    { key: "unread", label: "Unread", count: inboxCounts.unread },
    { key: "sent", label: "Sent", count: inboxCounts.sent },
    { key: "drafts", label: "Drafts", count: inboxCounts.drafts },
  ] as const;

  const activeFolderLabel = folderTabs.find((tab) => tab.key === activeFolder)?.label || "Inbox";
  const isInboxMode = detailMode === "email";

  const createQuickThread = async () => {
    const title = window.prompt("Thread title")?.trim();
    if (!title) return;
    const category = (
      window.prompt(
        "Category (question/decision/issue/action_required/approval/clarification)",
        "question"
      ) || "question"
    ) as ThreadCategory;
    await createThread({ trialId, title, category });
    await loadThreads(trialId, threadFilters);
  };

  const createQuickConversation = async () => {
    const name = window.prompt("Group conversation name")?.trim();
    if (!name) return;
    await collabApi.createConversation({
      trialId,
      type: "group",
      name,
      participantUserIds: [],
    });
    await loadConversations(trialId);
  };

  const sendThreadMessage = async (content: string) => {
    if (!activeThreadId) return;
    await collabApi.addThreadMessage({ threadId: activeThreadId, content });
    await loadThreadMessages(activeThreadId);
    await loadThreads(trialId, threadFilters);
  };

  const resolveActiveThread = async (summary: string, useAiSummary: boolean) => {
    if (!activeThreadId) return;
    await collabApi.resolveThread(activeThreadId, summary, useAiSummary);
    await loadThreads(trialId, threadFilters);
    await loadThreadMessages(activeThreadId);
  };

  const requestThreadSummary = async () => {
    if (!activeThreadId) return "";
    return requestAIResolutionSummary(activeThreadId);
  };

  const replyEmail = async (content: string, aiMeta?: { generated: boolean; editedDistance?: number }) => {
    if (!activeEmailChainId) return;
    await collabApi.replyEmail({ chainId: activeEmailChainId, content, aiDraftMeta: aiMeta });
    await loadEmailMessages(activeEmailChainId);
    await loadEmailChains(activeFolder);
  };

  const sendComposedEmail = async (input: { to: string[]; cc: string[]; subject: string; body: string }) => {
    if (!inboxConfig) return;
    await collabApi.composeEmail({ trialId: inboxConfig.trialId, ...input });
    setShowCompose(false);
    setDetailMode("email");
    setActiveLayer("inbox");
    await loadEmailChains(activeFolder);
  };

  const selectEmail = (emailChainId: string) => {
    setShowCompose(false);
    setDetailMode("email");
    setActiveLayer("inbox");
    setActiveEmailChain(emailChainId);
  };

  const selectConversation = (conversationId: string) => {
    setShowCompose(false);
    setDetailMode("conversation");
    setActiveLayer("messages");
    setActiveConversation(conversationId);
  };

  const selectThread = (threadId: string) => {
    setShowCompose(false);
    setDetailMode("thread");
    setActiveLayer("threads");
    setActiveThread(threadId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <div className="flex h-11 items-center gap-6 rounded-lg border border-gray-200 bg-white px-5 py-0">
          <button
            type="button"
            onClick={() => navigate("/trial-workspace")}
            className="flex items-center gap-2 border-r border-gray-200 pr-5 text-xs text-gray-500 transition-colors hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>All Trials</span>
          </button>

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => {
                setShowCompose(false);
                setDetailMode("email");
                setActiveLayer("inbox");
              }}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors",
                detailMode === "email"
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              )}
            >
              <Inbox className="h-4 w-4" />
              <span>Inbox</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCompose(false);
                setDetailMode("conversation");
                setActiveLayer("messages");
              }}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors",
                detailMode === "conversation"
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              )}
            >
              <MessageCircle className="h-4 w-4" />
              <span>Messages</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCompose(false);
                setDetailMode("thread");
                setActiveLayer("threads");
              }}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors",
                detailMode === "thread"
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              )}
            >
              <MessagesSquare className="h-4 w-4" />
              <span>Threads</span>
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div className="flex h-full min-h-0 overflow-hidden rounded-lg border border-gray-200 bg-background">
        {isInboxMode ? (
          <>
            <aside className="flex w-[250px] min-w-[232px] flex-col border-r border-border bg-background">
              <div className="border-b border-border px-3 py-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#0E0017]">Folders</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCompose(true);
                      setDetailMode("email");
                      setActiveLayer("inbox");
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-[#0E0017]/70 hover:bg-accent hover:text-[#0E0017]"
                  >
                    <MailPlus className="h-3.5 w-3.5" />
                    New
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-2">
                {folderTabs.map((folder) => (
                  <button
                    key={folder.key}
                    type="button"
                    onClick={() => {
                      setShowCompose(false);
                      setActiveFolder(folder.key);
                      setDetailMode("email");
                      setActiveLayer("inbox");
                      void loadEmailChains(folder.key);
                    }}
                    className={cn(
                      "mb-1 flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition",
                      activeFolder === folder.key
                        ? "bg-[#ECEEF1] font-medium text-[#0E0017]"
                        : "text-[#0E0017]/70 hover:bg-accent hover:text-[#0E0017]"
                    )}
                  >
                    <span>{folder.label}</span>
                    <span className="text-xs text-[#0E0017]/55">{folder.count}</span>
                  </button>
                ))}
              </div>
            </aside>

            <aside className="flex w-[360px] min-w-[320px] flex-col border-r border-border bg-background">
              <div className="border-b border-border px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#0E0017]">{activeFolderLabel}</h3>
                  <span className="text-xs text-[#0E0017]/55">{sortedEmailChains.length} items</span>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {sortedEmailChains.map((chain) => (
                  <button
                    key={chain.id}
                    type="button"
                    onClick={() => selectEmail(chain.id)}
                    className={cn(
                      "mb-1 w-full rounded-md border border-transparent px-2 py-2 text-left transition",
                      activeEmailChainId === chain.id && !showCompose
                        ? "border-border bg-accent"
                        : "hover:bg-accent/70"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-1 text-xs font-semibold text-[#0E0017]">
                        {chain.fromName || chain.fromAddress || "Unknown sender"}
                      </p>
                      <span className="shrink-0 text-[10px] text-[#0E0017]/55">
                        {formatRelative(chain.updatedAt)}
                      </span>
                    </div>
                    <p className="line-clamp-1 text-xs font-medium text-[#0E0017]/85">{chain.subject}</p>
                    <p className="line-clamp-1 text-[11px] text-[#0E0017]/55">
                      {chain.aiSummary || chain.messages?.[0]?.content || "No preview available"}
                    </p>
                    {(chain.aiLabels?.length || 0) > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {chain.aiLabels!.slice(0, 2).map((label) => (
                          <span
                            key={label}
                            className="rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-[#0E0017]/65"
                          >
                            {label.replaceAll("_", " ")}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            </aside>

            <main className="min-w-0 flex-1 bg-background">
              {showCompose ? (
                <div className="h-full overflow-y-auto p-4">
                  <ComposeEmail
                    onSend={sendComposedEmail}
                    onDraftWithAI={async (instructions) => {
                      if (!activeEmailChainId) {
                        return {
                          subject: "",
                          body: "",
                          protocol_refs: [],
                        };
                      }
                      return requestAIDraft(activeEmailChainId, instructions);
                    }}
                  />
                </div>
              ) : (
                <EmailView
                  chain={activeEmailChain}
                  messages={activeEmailChainId ? emailMessagesMap[activeEmailChainId] || [] : []}
                  onReply={replyEmail}
                  onDraftWithAI={(instructions) =>
                    activeEmailChainId
                      ? requestAIDraft(activeEmailChainId, instructions)
                      : Promise.resolve({ subject: "", body: "", protocol_refs: [] })
                  }
                  onLinkThread={async (threadId) => {
                    if (!activeEmailChainId) return;
                    await linkEmailToThread(activeEmailChainId, threadId);
                  }}
                />
              )}
            </main>
          </>
        ) : null}

        {detailMode === "conversation" ? (
          <>
            <aside className="flex w-[324px] min-w-[300px] flex-col border-r border-border bg-background">
              <section className="border-b border-border px-3 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[#0E0017]/65">
                    Direct Messages
                  </h3>
                  <button
                    type="button"
                    onClick={() => void createQuickConversation()}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-[#0E0017]/70 hover:bg-accent hover:text-[#0E0017]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New
                  </button>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#0E0017]/45" />
                  <input
                    value={dmSearch}
                    onChange={(event) => setDmSearch(event.target.value)}
                    placeholder="Search messages"
                    className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs text-[#0E0017] placeholder:text-[#0E0017]/45"
                  />
                </div>
              </section>

              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
                {filteredConversations.slice(0, 24).map((conversation) => {
                  const displayName = getConversationDisplayName(conversation, currentUserId);
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => selectConversation(conversation.id)}
                      className={cn(
                        "w-full rounded-md border border-transparent px-2 py-1.5 text-left transition",
                        activeConversationId === conversation.id ? "border-border bg-accent" : "hover:bg-accent/70"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <Avatar className="h-6 w-6 border border-border bg-muted">
                          <AvatarFallback className="text-[10px] font-semibold text-foreground">
                            {initials(displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-[#0E0017]">{displayName}</p>
                            <span className="text-[10px] text-[#0E0017]/55">
                              {formatTime(conversation.lastMessage?.createdAt)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <p className="line-clamp-1 text-[10px] text-[#0E0017]/55">
                              {conversation.lastMessage?.content || "No messages yet"}
                            </p>
                            {(conversation.unreadCount || 0) > 0 ? (
                              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                                {conversation.unreadCount}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <main className="min-w-0 flex-1 bg-background">
              <ConversationView
                conversation={activeConversation}
                messages={activeConversationId ? conversationMessagesMap[activeConversationId] || [] : []}
                aiIsTyping={aiIsTyping && detailMode === "conversation"}
                currentUserId={currentUserId}
                onSend={(content) =>
                  activeConversationId ? sendConversationMessage(activeConversationId, content) : Promise.resolve()
                }
              />
            </main>
          </>
        ) : null}

        {detailMode === "thread" ? (
          <>
            <aside className="flex w-[360px] min-w-[332px] flex-col border-r border-border bg-background">
              <section className="border-b border-border px-3 py-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#0E0017]">Threads</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#0E0017]/55">{sortedThreads.length} items</span>
                    <button
                      type="button"
                      onClick={() => void createQuickThread()}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-[#0E0017]/70 hover:bg-accent hover:text-[#0E0017]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New
                    </button>
                  </div>
                </div>
              </section>

              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
                {sortedThreads.slice(0, 24).map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => selectThread(thread.id)}
                    className={cn(
                      "w-full rounded-md border border-transparent px-2 py-1.5 text-left transition",
                      activeThreadId === thread.id ? "border-border bg-accent" : "hover:bg-accent/70"
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <ThreadCategoryBadge category={thread.category} />
                      <ThreadStatusBadge status={thread.status} />
                    </div>
                    <p className="line-clamp-1 text-xs font-semibold text-[#0E0017]">{thread.title}</p>
                    <p className="text-[10px] text-[#0E0017]/55">
                      {thread.replyCount || 0} replies · {formatRelative(thread.updatedAt)}
                    </p>
                  </button>
                ))}
              </div>
            </aside>

            <main className="min-w-0 flex-1 bg-background">
              <ThreadView
                thread={activeThread}
                messages={activeThreadId ? threadMessages[activeThreadId] || [] : []}
                aiIsTyping={aiIsTyping && detailMode === "thread"}
                currentUserId={currentUserId}
                onSendMessage={sendThreadMessage}
                onResolve={resolveActiveThread}
                onRequestAiSummary={requestThreadSummary}
              />
            </main>
          </>
        ) : null}
        </div>
      </div>
    </div>
  );
}
