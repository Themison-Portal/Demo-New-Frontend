import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CollaborationMessage, TrialThread } from "@/types/collaboration";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThreadCategoryBadge } from "@/components/collaboration/threads/ThreadCategoryBadge";
import { AnchorTag } from "@/components/collaboration/threads/AnchorTag";
import { AIMessageBubble } from "@/components/collaboration/shared/AIMessageBubble";
import { MessageInput } from "@/components/collaboration/shared/MessageInput";
import { AITypingIndicator } from "@/components/collaboration/shared/AITypingIndicator";
import { ProtocolSnippetCard } from "@/components/collaboration/shared/ProtocolSnippetCard";
import { TaskCard } from "@/components/collaboration/shared/TaskCard";
import { matchesCollaborationIdentity } from "@/lib/collaborationIdentity";

interface ThreadViewProps {
  thread: TrialThread | null;
  messages: CollaborationMessage[];
  aiIsTyping: boolean;
  currentUserId: number | null;
  currentUserName?: string | null;
  currentUserEmail?: string | null;
  resolveAvatar?: (name?: string | null, email?: string | null) => string | null;
  onSendMessage: (content: string) => Promise<void>;
  onResolve: (summary: string, useAiSummary: boolean) => Promise<void>;
  onRequestAiSummary: () => Promise<string>;
}

function formatLabelDate(value: string | Date) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayKey(value: string | Date) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDayDivider(value: string | Date) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (dayKey(date) === dayKey(today)) return "Today";
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function initials(value: string) {
  const parts = value
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts[0]?.[0] || "?") + (parts[1]?.[0] || "");
}

export function ThreadView({
  thread,
  messages,
  aiIsTyping,
  currentUserId,
  currentUserName,
  currentUserEmail,
  resolveAvatar,
  onSendMessage,
  onResolve,
  onRequestAiSummary,
}: ThreadViewProps) {
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a thread
      </div>
    );
  }

  const requestSummary = async () => {
    setLoadingSummary(true);
    try {
      const summary = await onRequestAiSummary();
      setResolutionSummary(summary);
    } finally {
      setLoadingSummary(false);
    }
  };

  const currentUserIdentity = {
    id: currentUserId,
    name: currentUserName,
    email: currentUserEmail,
  };

  const selfDisplayName =
    currentUserName?.trim() ||
    (thread.participants || []).find((participant) => matchesCollaborationIdentity(participant, currentUserIdentity))?.user?.name ||
    "You";

  const resolveSelf = (message: CollaborationMessage) => matchesCollaborationIdentity(message, currentUserIdentity);

  const orderedMessages = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="space-y-2 border-b border-gray-200 bg-white px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="line-clamp-1 text-base font-semibold text-gray-900">{thread.title}</h3>
              <ThreadCategoryBadge category={thread.category} />
            </div>
            {(thread.anchors || []).length ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(thread.anchors || []).map((anchor) => (
                  <AnchorTag key={anchor.id} anchor={anchor} />
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onResolve(resolutionSummary, false)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Mark Resolved
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={requestSummary}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50"
            disabled={loadingSummary}
          >
            {loadingSummary ? "Drafting summary..." : "Draft summary with Themison AI"}
          </button>
          <input
            className="h-8 min-w-[220px] flex-1 rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-700 outline-none placeholder:text-gray-400"
            placeholder="Resolution summary"
            value={resolutionSummary}
            onChange={(event) => setResolutionSummary(event.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-5">
        <div className="space-y-7">
        {orderedMessages.map((message, index) => {
          const previous = orderedMessages[index - 1];
          const showDayDivider = index === 0 || dayKey(previous.createdAt) !== dayKey(message.createdAt);

          if (message.senderType === "ai") {
            return (
              <div key={message.id} className="space-y-4">
                {showDayDivider ? (
                  <div className="relative py-1">
                    <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gray-200" />
                    <div className="relative flex w-full justify-center">
                      <div className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-5 py-1 text-[11px] font-medium text-gray-700">
                        {formatDayDivider(message.createdAt)}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="-mx-6 px-6 py-2">
                  <div className="flex justify-start">
                    <AIMessageBubble message={message} mode="messages" />
                  </div>
                </div>
              </div>
            );
          }

          const isSelf = resolveSelf(message);
          const embedded = (message.embeddedContent || {}) as Record<string, unknown>;
          const hasProtocolCard =
            message.contentType === "protocol_snippet" && typeof embedded.document_name === "string";
          const hasTaskCard =
            message.contentType === "task_card" && typeof embedded.title === "string";
          const hasTextBubble =
            Boolean(message.content?.trim()) &&
            (message.contentType === "text" || message.contentType === "email" || message.contentType === "ai_response");
          const senderLabel = isSelf ? selfDisplayName : message.senderName || "Team";
          const senderAvatar = !isSelf ? resolveAvatar?.(senderLabel, message.senderEmail) || null : null;

          return (
            <div key={message.id} className="space-y-4">
              {showDayDivider ? (
                <div className="relative py-1">
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gray-200" />
                  <div className="relative flex w-full justify-center">
                    <div className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-5 py-1 text-[11px] font-medium text-gray-700">
                      {formatDayDivider(message.createdAt)}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="-mx-6 px-6 py-2">
                <div className={cn("flex w-full items-start", isSelf ? "justify-end" : "gap-3")}>
                  {!isSelf ? (
                    <Avatar className="h-11 w-11 rounded-lg border border-gray-200 bg-gray-100">
                      <AvatarImage src={senderAvatar || undefined} alt={senderLabel} className="rounded-lg object-cover" />
                      <AvatarFallback className="rounded-lg text-[12px] font-semibold text-gray-700">
                        {initials(senderLabel)}
                      </AvatarFallback>
                    </Avatar>
                  ) : null}

                  <div className={cn("min-w-0 space-y-2 pr-1", isSelf ? "max-w-[78%] text-right" : "flex-1")}>
                    <div className={cn("flex items-center gap-2", isSelf ? "justify-end" : "")}>
                      <p className="truncate text-sm font-semibold leading-none text-gray-900">{senderLabel}</p>
                      <p className="text-xs font-normal leading-none text-gray-500">
                        {formatLabelDate(message.createdAt)}
                      </p>
                    </div>

                    {hasTextBubble ? (
                      <div
                        className={cn("inline-block w-fit max-w-full rounded-md px-4 py-2", isSelf ? "ml-auto" : "")}
                        style={{
                          backgroundColor: isSelf ? "#1570EF" : "#F1F1F1",
                          color: isSelf ? "#FFFFFF" : "#111827",
                        }}
                      >
                        <p className="whitespace-pre-wrap text-sm leading-[1.45]">{message.content}</p>
                      </div>
                    ) : null}

                {hasProtocolCard ? (
                      <div className="pt-0.5">
                        <ProtocolSnippetCard
                          documentName={String(embedded.document_name)}
                          sectionRef={String(embedded.section_ref || "Section")}
                          quotedText={String(embedded.quoted_text || "")}
                          documentLink={embedded.document_link ? String(embedded.document_link) : undefined}
                          aiGenerated={message.isAiGenerated}
                          variant="messages"
                          compact
                        />
                      </div>
                ) : null}

                {hasTaskCard ? (
                      <div className="pt-0.5">
                        <TaskCard
                          title={String(embedded.title)}
                          assigneeName={embedded.assignee_name ? String(embedded.assignee_name) : undefined}
                          dueDate={embedded.due_date ? String(embedded.due_date) : undefined}
                          status={embedded.status ? String(embedded.status) : undefined}
                          headline={message.isAiGenerated ? "Action suggestion" : "Task Created"}
                          requiresConfirmation={message.isAiGenerated}
                          variant="messages"
                          compact
                        />
                      </div>
                ) : null}

                {!hasTextBubble && !hasProtocolCard && !hasTaskCard ? (
                      <div
                        className={cn("inline-block w-fit max-w-full rounded-md px-4 py-2", isSelf ? "ml-auto" : "")}
                        style={{
                          backgroundColor: isSelf ? "#1570EF" : "#F1F1F1",
                          color: isSelf ? "#FFFFFF" : "#111827",
                        }}
                      >
                        <p className="text-sm leading-[1.45]">{message.content || "Shared update"}</p>
                      </div>
                ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {aiIsTyping ? (
          <div className="flex justify-start">
            <AITypingIndicator />
          </div>
        ) : null}
        </div>
      </div>

      <MessageInput placeholder="Reply to this thread" onSend={onSendMessage} variant="messages" />
    </div>
  );
}
