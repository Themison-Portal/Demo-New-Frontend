import { Inbox } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { CollaborationLayer, ThreadAnchorType, ThreadCategory, ThreadStatus, TrialThread } from "@/types/collaboration";
import { ThreadCategoryBadge } from "@/components/collaboration/threads/ThreadCategoryBadge";
import { ThreadStatusBadge } from "@/components/collaboration/threads/ThreadStatusBadge";
import { AnchorTag } from "@/components/collaboration/threads/AnchorTag";

interface ThreadListProps {
  threads: TrialThread[];
  activeThreadId: string | null;
  activeLayer: CollaborationLayer;
  categoryFilter?: ThreadCategory;
  anchorTypeFilter?: ThreadAnchorType;
  statusFilter?: ThreadStatus;
  onSelect: (threadId: string) => void;
  onFilterChange: (filters: { category?: ThreadCategory; anchorType?: ThreadAnchorType; status?: ThreadStatus }) => void;
  onCreateThread?: () => void;
  onChangeLayer: (layer: CollaborationLayer) => void;
}

function initials(value: string) {
  const parts = value
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts[0]?.[0] || "?") + (parts[1]?.[0] || "");
}

export function ThreadList({
  threads,
  activeThreadId,
  activeLayer,
  categoryFilter,
  anchorTypeFilter,
  statusFilter,
  onSelect,
  onFilterChange,
  onCreateThread,
  onChangeLayer,
}: ThreadListProps) {
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

      <div className="space-y-3 border-b border-neutral-300 p-3">
        <div className="flex items-center justify-between">
          <button className="inline-flex h-9 items-center gap-1 rounded-xl border border-neutral-300 bg-white px-3 text-sm text-neutral-700">
            Trials Type
          </button>
          <button
            type="button"
            onClick={onCreateThread}
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-neutral-300 bg-white px-3 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            + New
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <select
            className="h-10 rounded-xl border border-neutral-300 bg-white px-2 text-sm text-neutral-700"
            value={categoryFilter || ""}
            onChange={(event) =>
              onFilterChange({
                category: (event.target.value || undefined) as ThreadCategory | undefined,
                anchorType: anchorTypeFilter,
                status: statusFilter,
              })
            }
          >
            <option value="">Query Type</option>
            <option value="question">Question</option>
            <option value="decision">Decision</option>
            <option value="issue">Issue</option>
            <option value="action_required">Action Required</option>
            <option value="approval">Approval</option>
            <option value="clarification">Clarification</option>
          </select>
          <select
            className="h-10 rounded-xl border border-neutral-300 bg-white px-2 text-sm text-neutral-700"
            value={anchorTypeFilter || ""}
            onChange={(event) =>
              onFilterChange({
                category: categoryFilter,
                anchorType: (event.target.value || undefined) as ThreadAnchorType | undefined,
                status: statusFilter,
              })
            }
          >
            <option value="">Anchor Type</option>
            <option value="document_section">Document</option>
            <option value="task">Task</option>
            <option value="visit">Visit</option>
            <option value="trial_wide">Trial-wide</option>
            <option value="therapeutic_area">Therapeutic Area</option>
            <option value="team_member">Team member</option>
          </select>
          <select
            className="h-10 rounded-xl border border-neutral-300 bg-white px-2 text-sm text-neutral-700"
            value={statusFilter || ""}
            onChange={(event) =>
              onFilterChange({
                category: categoryFilter,
                anchorType: anchorTypeFilter,
                status: (event.target.value || undefined) as ThreadStatus | undefined,
              })
            }
          >
            <option value="">Message</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {threads.map((thread) => {
          const isActive = thread.id === activeThreadId;
          return (
            <button
              key={thread.id}
              type="button"
              onClick={() => onSelect(thread.id)}
              className={cn(
                "mb-2 w-full rounded-xl border border-transparent p-3 text-left transition-colors",
                isActive ? "border-neutral-300 bg-white shadow-sm" : "hover:bg-white/70"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <ThreadCategoryBadge category={thread.category} />
                    <ThreadStatusBadge status={thread.status} />
                  </div>
                  <p className="line-clamp-2 text-xl font-semibold leading-snug text-neutral-900">{thread.title}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {(thread.anchors || []).slice(0, 2).map((anchor) => (
                      <AnchorTag key={anchor.id} anchor={anchor} />
                    ))}
                  </div>
                </div>
                <span className="text-xs text-neutral-500">{thread.replyCount || 0} replies</span>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <div className="flex -space-x-2">
                  <Avatar className="h-6 w-6 border border-white bg-neutral-200">
                    <AvatarFallback className="text-[10px] text-neutral-700">
                      {initials("Susan Johnson")}
                    </AvatarFallback>
                  </Avatar>
                  <Avatar className="h-6 w-6 border border-white bg-neutral-200">
                    <AvatarFallback className="text-[10px] text-neutral-700">
                      {initials("Allan Cook")}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <span className="text-xs text-neutral-500">
                  {thread.status === "resolved" ? "Resolved" : "2h ago"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
