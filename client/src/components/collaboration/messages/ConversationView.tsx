import type { CollaborationMessage, Conversation } from "@/types/collaboration";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { AIMessageBubble } from "@/components/collaboration/shared/AIMessageBubble";
import { AITypingIndicator } from "@/components/collaboration/shared/AITypingIndicator";
import { MessageInput } from "@/components/collaboration/shared/MessageInput";
import { ProtocolSnippetCard } from "@/components/collaboration/shared/ProtocolSnippetCard";
import { TaskCard } from "@/components/collaboration/shared/TaskCard";

interface ConversationViewProps {
  conversation: Conversation | null;
  messages: CollaborationMessage[];
  aiIsTyping: boolean;
  currentUserId: number | null;
  onSend: (content: string) => Promise<void>;
}

function formatLabelDate(value: string | Date) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

export function ConversationView({ conversation, messages, aiIsTyping, currentUserId, onSend }: ConversationViewProps) {
  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a conversation
      </div>
    );
  }

  const displayName = getConversationDisplayName(conversation, currentUserId);

  const primaryParticipant =
    (conversation.participants || []).find((participant) => participant.user?.name)?.user?.name ||
    displayName;

  const selfDisplayName =
    (conversation.participants || []).find((participant) =>
      currentUserId != null ? participant.userId === currentUserId : participant.userId === conversation.createdBy
    )?.user?.name || "You";

  const resolveSelf = (message: CollaborationMessage) => {
    if (message.senderId != null && currentUserId != null) return message.senderId === currentUserId;
    if (message.senderId != null && currentUserId == null) return message.senderId === conversation.createdBy;
    return message.senderName === "You";
  };

  return (
    <div className="flex h-full flex-col bg-[#f6f6f7]">
      <div className="border-b border-neutral-300 bg-[#f3f4f6] px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10 border border-neutral-200 bg-neutral-100">
              <AvatarFallback className="text-xs font-semibold text-neutral-700">
                {initials(primaryParticipant)}
              </AvatarFallback>
            </Avatar>
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-white bg-emerald-500" />
          </div>
          <div>
            <h3 className="text-2xl font-semibold leading-tight text-neutral-900">{displayName}</h3>
            <p className="text-sm text-neutral-700">Active Now</p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-10 py-8">
        {messages.map((message) => {
          if (message.senderType === "ai") {
            return (
              <div key={message.id} className="flex justify-start">
                <AIMessageBubble message={message} mode="messages" />
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
              {!isSelf ? (
                <div className="mr-2 mt-1.5 hidden h-7 w-7 items-center justify-center rounded-full bg-neutral-300 text-[10px] font-semibold text-neutral-700 md:flex">
                  {initials(message.senderName || "TM")}
                </div>
              ) : null}
              <div className="max-w-[80%] space-y-2">
                {hasTextBubble ? (
                  <div
                    className={cn(
                      "rounded-3xl px-5 py-4 shadow-sm",
                      isSelf ? "bg-[#1f6feb] text-white" : "bg-[#e8e8ea] text-neutral-900"
                    )}
                  >
                    {!isSelf && message.senderName ? (
                      <div className="mb-1 text-sm text-neutral-500">{message.senderName}</div>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                    <div className={cn("mt-2 text-[11px]", isSelf ? "text-blue-100" : "text-neutral-500")}>
                      {formatLabelDate(message.createdAt)}
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
              {isSelf ? (
                <div className="ml-2 mt-1.5 hidden h-7 w-7 items-center justify-center rounded-full bg-neutral-300 text-[10px] font-semibold text-neutral-700 md:flex">
                  {initials(selfDisplayName)}
                </div>
              ) : null}
            </div>
          );
        })}

        {aiIsTyping ? (
          <div className="flex justify-start">
            <AITypingIndicator />
          </div>
        ) : null}
      </div>

      <MessageInput placeholder="Message the team" onSend={onSend} />
    </div>
  );
}
