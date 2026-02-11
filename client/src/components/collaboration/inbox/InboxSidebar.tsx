import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CollaborationLayer } from "@/types/collaboration";

interface InboxSidebarProps {
  activeLayer: CollaborationLayer;
  activeFolder: "inbox" | "unread" | "sent" | "drafts";
  counts: {
    inbox: number;
    unread: number;
    sent: number;
    drafts: number;
  };
  onSelectFolder: (folder: "inbox" | "unread" | "sent" | "drafts") => void;
  onCompose: () => void;
  onChangeLayer: (layer: CollaborationLayer) => void;
}

const folderLabels: Array<{ key: "inbox" | "unread" | "sent" | "drafts"; label: string }> = [
  { key: "inbox", label: "Inbox" },
  { key: "unread", label: "Unread" },
  { key: "sent", label: "Sent" },
  { key: "drafts", label: "Drafts" },
];

export function InboxSidebar({
  activeLayer,
  activeFolder,
  counts,
  onSelectFolder,
  onCompose,
  onChangeLayer,
}: InboxSidebarProps) {
  return (
    <div className="flex h-full flex-col border-r border-neutral-300 bg-[#f3f4f6]">
      <div className="grid grid-cols-3 border-b border-neutral-300 bg-[#ececef]">
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
          className={cn(
            "h-14 border-b-2 text-sm font-medium transition-colors",
            activeLayer === "inbox"
              ? "border-blue-500 bg-[#f3f4f6] text-neutral-900"
              : "border-transparent text-neutral-600 hover:bg-[#efeff2]"
          )}
        >
          <span className="inline-flex items-center gap-1">
            <Inbox className="h-4 w-4" />
            Inbox
          </span>
        </button>
      </div>

      <div className="border-b border-neutral-300 p-3">
        <div className="mb-2 text-sm font-semibold text-neutral-900">Inbox</div>
        <button
          type="button"
          onClick={onCompose}
          className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          + New
        </button>
      </div>

      <div className="flex-1 space-y-1 p-2">
        {folderLabels.map((folder) => (
          <button
            key={folder.key}
            type="button"
            onClick={() => onSelectFolder(folder.key)}
            className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm ${
              activeFolder === folder.key ? "bg-white font-medium text-neutral-900" : "text-neutral-700 hover:bg-white/70"
            }`}
          >
            <span>{folder.label}</span>
            <span className="text-xs text-muted-foreground">{counts[folder.key]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
