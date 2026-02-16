import type { CollaborationMessage, Conversation } from "@/types/collaboration";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { AIMessageBubble } from "@/components/collaboration/shared/AIMessageBubble";
import { AITypingIndicator } from "@/components/collaboration/shared/AITypingIndicator";
import { MessageInput } from "@/components/collaboration/shared/MessageInput";
import { ProtocolSnippetCard } from "@/components/collaboration/shared/ProtocolSnippetCard";
import { TaskCard } from "@/components/collaboration/shared/TaskCard";

type StructuredConversationMessage = {
  content: string;
  contentType: "protocol_snippet" | "task_card";
  embeddedContent: Record<string, unknown>;
};

interface ConversationViewProps {
  conversation: Conversation | null;
  messages: CollaborationMessage[];
  aiIsTyping: boolean;
  currentUserId: number | null;
  resolveAvatar?: (name?: string | null, email?: string | null) => string | null;
  onSend: (content: string) => Promise<void>;
  onStructuredSend?: (payload: StructuredConversationMessage) => Promise<void>;
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

function getPrimaryParticipantRecord(conversation: Conversation, currentUserId: number | null) {
  const participants = (conversation.participants || []).filter((participant) => participant.user?.name);
  if (!participants.length) return null;

  if (currentUserId != null) {
    const other = participants.find((participant) => participant.userId !== currentUserId);
    if (other) return other;
  } else {
    const other = participants.find((participant) => participant.userId !== conversation.createdBy);
    if (other) return other;
  }

  return participants[0] || null;
}

export function ConversationView({
  conversation,
  messages,
  aiIsTyping,
  currentUserId,
  resolveAvatar,
  onSend,
  onStructuredSend,
}: ConversationViewProps) {
  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-sm text-gray-500">
        Select a conversation to view.
      </div>
    );
  }

  const displayName = getConversationDisplayName(conversation, currentUserId);

  const primaryParticipantRecord = getPrimaryParticipantRecord(conversation, currentUserId);
  const primaryParticipant = primaryParticipantRecord?.user?.name || displayName;
  const primaryAvatar = resolveAvatar?.(primaryParticipantRecord?.user?.name || primaryParticipant, primaryParticipantRecord?.user?.email || null) || null;

  const selfDisplayName =
    (conversation.participants || []).find((participant) =>
      currentUserId != null ? participant.userId === currentUserId : participant.userId === conversation.createdBy
    )?.user?.name || "Kaleb Sanders";

  const resolveSelf = (message: CollaborationMessage) => {
    if (message.senderId != null && currentUserId != null && message.senderId === currentUserId) return true;
    if (message.senderId != null && message.senderId === conversation.createdBy) return true;
    return /^(you|kaleb sanders)$/i.test(message.senderName || "");
  };

  const orderedMessages = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-gray-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10 rounded-lg border border-gray-200 bg-gray-100">
              <AvatarImage src={primaryAvatar || undefined} alt={primaryParticipant} className="rounded-lg object-cover" />
              <AvatarFallback className="rounded-lg text-xs font-semibold text-gray-700">
                {initials(primaryParticipant)}
              </AvatarFallback>
            </Avatar>
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
          </div>
          <div>
            <h3 className="text-base font-semibold leading-tight text-gray-900">{displayName}</h3>
          </div>
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
            const reactions = Array.isArray(embedded.reactions)
              ? (embedded.reactions as Array<{ emoji?: string; count?: number }>).filter((item) => item?.emoji)
              : [];
            const senderLabel = isSelf ? selfDisplayName : message.senderName || primaryParticipant;
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
                        className={cn(
                          "inline-block w-fit max-w-full rounded-md px-4 py-2",
                          isSelf ? "ml-auto" : ""
                        )}
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
                        className={cn(
                          "inline-block w-fit max-w-full rounded-md px-4 py-2",
                          isSelf ? "ml-auto" : ""
                        )}
                        style={{
                          backgroundColor: isSelf ? "#1570EF" : "#F1F1F1",
                          color: isSelf ? "#FFFFFF" : "#111827",
                        }}
                      >
                        <p className="text-sm leading-[1.45]">{message.content || "Shared update"}</p>
                      </div>
                    ) : null}

                    {reactions.length > 0 ? (
                      <div className={cn("flex flex-wrap items-center gap-2 pt-1", isSelf ? "justify-end" : "")}>
                        {reactions.map((reaction, reactionIndex) => (
                          <span
                            key={`${message.id}-reaction-${reactionIndex}`}
                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700"
                          >
                            <span>{reaction.emoji}</span>
                            <span>{reaction.count ?? 1}</span>
                          </span>
                        ))}
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

      <MessageInput
        placeholder="Reply to this thread"
        onSend={onSend}
        onStructuredSend={onStructuredSend}
        variant="messages"
      />
    </div>
  );
}
