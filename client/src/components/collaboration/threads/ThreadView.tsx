import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CollaborationMessage, TrialThread } from "@/types/collaboration";
import { ThreadCategoryBadge } from "@/components/collaboration/threads/ThreadCategoryBadge";
import { AnchorTag } from "@/components/collaboration/threads/AnchorTag";
import { AIMessageBubble } from "@/components/collaboration/shared/AIMessageBubble";
import { MessageInput } from "@/components/collaboration/shared/MessageInput";
import { AITypingIndicator } from "@/components/collaboration/shared/AITypingIndicator";
import { ProtocolSnippetCard } from "@/components/collaboration/shared/ProtocolSnippetCard";
import { TaskCard } from "@/components/collaboration/shared/TaskCard";

interface ThreadViewProps {
  thread: TrialThread | null;
  messages: CollaborationMessage[];
  aiIsTyping: boolean;
  currentUserId: number | null;
  onSendMessage: (content: string) => Promise<void>;
  onResolve: (summary: string, useAiSummary: boolean) => Promise<void>;
  onRequestAiSummary: () => Promise<string>;
}

function formatMessageTime(value: string | Date) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ThreadView({
  thread,
  messages,
  aiIsTyping,
  currentUserId,
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

  const resolveSelf = (message: CollaborationMessage) => {
    if (message.senderId != null && currentUserId != null) return message.senderId === currentUserId;
    return false;
  };

  return (
    <div className="flex h-full flex-col bg-[#f6f6f7]">
      <div className="space-y-3 border-b border-neutral-300 bg-[#f3f4f6] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-2xl font-semibold text-neutral-900">{thread.title}</h3>
              <ThreadCategoryBadge category={thread.category} />
            </div>
            {(thread.anchors || []).length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {(thread.anchors || []).map((anchor) => (
                  <AnchorTag key={anchor.id} anchor={anchor} />
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onResolve(resolutionSummary, false)}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            Mark Resolved
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={requestSummary}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            disabled={loadingSummary}
          >
            {loadingSummary ? "Drafting summary..." : "Draft resolution summary with AI"}
          </button>
          <textarea
            className="h-9 min-w-[300px] flex-1 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs"
            placeholder="Resolution summary"
            value={resolutionSummary}
            onChange={(event) => setResolutionSummary(event.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-14 py-8">
        {messages.map((message) => {
          if (message.senderType === "ai") {
            return (
              <div key={message.id} className="flex justify-start">
                <AIMessageBubble message={message} mode="threads" />
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

          return (
            <div key={message.id} className={cn("flex", isSelf ? "justify-end" : "justify-start")}>
              <div className="max-w-[82%] space-y-2">
                {hasTextBubble ? (
                  <div className={cn("rounded-3xl px-5 py-4 text-neutral-900 shadow-sm", isSelf ? "bg-[#1f6feb] text-white" : "bg-[#e8e8ea]")}>
                    <div className={cn("mb-1 text-sm", isSelf ? "text-blue-100" : "text-neutral-500")}>
                      {message.senderName || "Team"}
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                    <div className={cn("mt-2 text-[11px]", isSelf ? "text-blue-100" : "text-neutral-500")}>
                      {formatMessageTime(message.createdAt)}
                    </div>
                  </div>
                ) : null}

                {hasProtocolCard ? (
                  <ProtocolSnippetCard
                    documentName={String(embedded.document_name)}
                    sectionRef={String(embedded.section_ref || "Section")}
                    quotedText={String(embedded.quoted_text || "")}
                    documentLink={embedded.document_link ? String(embedded.document_link) : undefined}
                    aiGenerated={message.isAiGenerated}
                  />
                ) : null}

                {hasTaskCard ? (
                  <TaskCard
                    title={String(embedded.title)}
                    assigneeName={embedded.assignee_name ? String(embedded.assignee_name) : undefined}
                    dueDate={embedded.due_date ? String(embedded.due_date) : undefined}
                    status={embedded.status ? String(embedded.status) : undefined}
                    headline={message.isAiGenerated ? "Action suggestion" : "Task Created"}
                    requiresConfirmation={message.isAiGenerated}
                  />
                ) : null}

                {!hasTextBubble && !hasProtocolCard && !hasTaskCard ? (
                  <div className="rounded-3xl bg-[#e8e8ea] px-5 py-4 text-sm text-neutral-700 shadow-sm">
                    {message.content || "Shared update"}
                  </div>
                ) : null}
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

      <MessageInput placeholder="Reply to this thread" onSend={onSendMessage} />
    </div>
  );
}
