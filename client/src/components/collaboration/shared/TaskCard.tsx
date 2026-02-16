import { CheckCircle2, CalendarClock, UserRound, ExternalLink } from "lucide-react";

interface TaskCardProps {
  title: string;
  assigneeName?: string | null;
  dueDate?: string | null;
  status?: string | null;
  headline?: string;
  requiresConfirmation?: boolean;
  onConfirm?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  variant?: "default" | "messages";
  compact?: boolean;
}

export function TaskCard({
  title,
  assigneeName,
  dueDate,
  status,
  headline = "Task Created",
  requiresConfirmation = false,
  onConfirm,
  onEdit,
  onCancel,
  variant = "default",
  compact = false,
}: TaskCardProps) {
  const isMessages = variant === "messages";

  return (
    <div
      className={
        isMessages
          ? compact
            ? "w-full max-w-[760px] rounded-xl border border-gray-200 border-l-[3px] border-l-blue-500 bg-white shadow-sm"
            : "rounded-xl border border-gray-200 border-l-[3px] border-l-blue-500 bg-white shadow-sm"
          : "rounded-2xl border border-neutral-300 border-l-4 border-l-blue-500 bg-[#f7f7f8]"
      }
    >
      <div
        className={
          isMessages
            ? compact
              ? "flex items-center justify-between border-b border-gray-200 px-3 py-2"
              : "flex items-center justify-between border-b border-gray-200 px-3.5 py-2.5"
            : "flex items-center justify-between border-b border-neutral-300 px-4 py-2.5"
        }
      >
        <div
          className={
            isMessages
              ? compact
                ? "flex items-center gap-1.5 text-xs font-semibold text-blue-600"
                : "flex items-center gap-2 text-[13px] font-semibold text-blue-600"
              : "flex items-center gap-2 text-lg font-semibold text-blue-600"
          }
        >
          <CheckCircle2 className={isMessages && compact ? "h-3.5 w-3.5" : isMessages ? "h-4 w-4" : "h-5 w-5"} />
          {headline}
        </div>
        <span className={isMessages ? (compact ? "text-[11px] text-gray-500" : "text-xs text-gray-500") : "text-xs text-neutral-500"}>
          {status || "Proposed"}
        </span>
      </div>
      <div className={isMessages ? (compact ? "space-y-2.5 px-3 py-2.5" : "space-y-3 px-3.5 py-3") : "space-y-3 px-4 py-3"}>
        <p className={isMessages ? (compact ? "line-clamp-2 text-xs text-gray-800" : "text-[13px] text-gray-800") : "text-base text-neutral-800"}>{title}</p>
        <div className={isMessages ? (compact ? "flex flex-wrap gap-1.5 text-[11px] text-gray-600" : "flex flex-wrap gap-2 text-xs text-gray-600") : "flex flex-wrap gap-2 text-sm text-neutral-600"}>
          <span className={isMessages ? (compact ? "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5" : "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1") : "inline-flex items-center gap-1 rounded-lg bg-neutral-200 px-2.5 py-1"}>
            <UserRound className={isMessages ? "h-3.5 w-3.5" : "h-4 w-4"} />
            {assigneeName || "Unassigned"}
          </span>
          <span className={isMessages ? (compact ? "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5" : "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1") : "inline-flex items-center gap-1 rounded-lg bg-neutral-200 px-2.5 py-1"}>
            <CalendarClock className={isMessages ? "h-3.5 w-3.5" : "h-4 w-4"} />
            Due: {dueDate || "Not set"}
          </span>
          <span className={isMessages ? (compact ? "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5" : "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1") : "inline-flex items-center gap-1 rounded-lg bg-neutral-200 px-2.5 py-1"}>
            <ExternalLink className={isMessages ? "h-3.5 w-3.5" : "h-4 w-4"} />
            View Task
          </span>
        </div>
      </div>
      {requiresConfirmation ? (
        <div className={isMessages ? (compact ? "flex items-center gap-2 border-t border-gray-200 px-3 py-2.5" : "flex items-center gap-2 border-t border-gray-200 px-3.5 py-3") : "flex items-center gap-2 border-t border-neutral-300 px-4 py-3"}>
          <button
            type="button"
            onClick={onConfirm}
            className={
              isMessages
                ? compact
                  ? "rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                  : "rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                : "rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            }
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onEdit}
            className={
              isMessages
                ? compact
                  ? "rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  : "rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                : "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            }
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={
              isMessages
                ? compact
                  ? "rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  : "rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                : "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            }
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
