import { useMemo, useState } from "react";
import { Inbox, MessageSquarePlus, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { CollaborationLayer, Conversation } from "@/types/collaboration";

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  activeLayer: CollaborationLayer;
  currentUserId: number | null;
  onSelect: (conversationId: string) => void;
  onCreateGroup?: () => void;
  onChangeLayer: (layer: CollaborationLayer) => void;
}

function formatTime(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getInitials(value: string) {
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

export function ConversationList({
  conversations,
  activeConversationId,
  activeLayer,
  currentUserId,
  onSelect,
  onCreateGroup,
  onChangeLayer,
}: ConversationListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;

    return conversations.filter((conversation) => {
      const participantNames = (conversation.participants || [])
        .map((participant) => participant.user?.name || "")
        .join(" ")
        .toLowerCase();
      const haystack = `${conversation.name || ""} ${participantNames} ${conversation.lastMessage?.content || ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [conversations, query]);

  return (
    <div className="flex h-full flex-col border-r border-neutral-300 bg-[#f3f4f6]">
      <div className="grid grid-cols-[1fr_1fr_auto] border-b border-neutral-300 bg-[#ececef]">
        <button
          type="button"
          onClick={() => onChangeLayer("messages")}
          className={cn(
            "h-14 border-b-2 text-sm font-medium text-neutral-600 transition-colors",
            activeLayer === "messages"
              ? "border-blue-500 bg-[#f3f4f6] text-neutral-900"
              : "border-transparent hover:bg-[#efeff2]"
          )}
        >
          Message
        </button>
        <button
          type="button"
          onClick={() => onChangeLayer("threads")}
          className={cn(
            "h-14 border-b-2 text-sm font-medium text-neutral-600 transition-colors",
            activeLayer === "threads"
              ? "border-blue-500 bg-[#f3f4f6] text-neutral-900"
              : "border-transparent hover:bg-[#efeff2]"
          )}
        >
          Threads
        </button>
        <button
          type="button"
          onClick={() => onChangeLayer("inbox")}
          className="m-2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50"
          title="Inbox"
          aria-label="Open inbox"
        >
          <Inbox className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 border-b border-neutral-300 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            className="h-10 w-full rounded-xl border border-neutral-300 bg-[#f8f8f9] pl-9 pr-3 text-sm text-neutral-800 outline-none placeholder:text-neutral-500 focus:border-neutral-400"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
          />
        </div>

        <button
          type="button"
          onClick={onCreateGroup}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Compose
        </button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {filtered.map((conversation) => {
          const active = conversation.id === activeConversationId;
          const displayName = getConversationDisplayName(conversation, currentUserId);

          return (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation.id)}
              className={cn(
                "w-full rounded-xl px-2.5 py-2.5 text-left transition",
                active ? "bg-white shadow-sm" : "hover:bg-white/70"
              )}
            >
              <div className="flex items-start gap-2.5">
                <div className="relative mt-0.5">
                  <Avatar className="h-10 w-10 border border-neutral-200 bg-neutral-100">
                    <AvatarFallback className="text-xs font-semibold text-neutral-700">
                      {getInitials(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-white bg-emerald-500" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[15px] font-semibold text-neutral-900">{displayName}</p>
                    <span className="text-xs font-medium text-neutral-700">
                      {formatTime(conversation.lastMessage?.createdAt)}
                    </span>
                  </div>

                  <div className="mt-0.5 flex items-start justify-between gap-2">
                    <p className="line-clamp-1 text-sm text-neutral-700">
                      {conversation.lastMessage?.content || "No messages yet"}
                    </p>
                    {(conversation.unreadCount || 0) > 0 ? (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">
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
    </div>
  );
}
