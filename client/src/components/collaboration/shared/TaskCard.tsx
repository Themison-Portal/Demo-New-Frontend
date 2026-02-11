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
}: TaskCardProps) {
  return (
    <div className="rounded-2xl border border-neutral-300 border-l-4 border-l-blue-500 bg-[#f7f7f8]">
      <div className="flex items-center justify-between border-b border-neutral-300 px-4 py-2.5">
        <div className="flex items-center gap-2 text-lg font-semibold text-blue-600">
          <CheckCircle2 className="h-5 w-5" />
          {headline}
        </div>
        <span className="text-xs text-neutral-500">{status || "Proposed"}</span>
      </div>
      <div className="space-y-3 px-4 py-3">
        <p className="text-base text-neutral-800">{title}</p>
        <div className="flex flex-wrap gap-2 text-sm text-neutral-600">
          <span className="inline-flex items-center gap-1 rounded-lg bg-neutral-200 px-2.5 py-1">
            <UserRound className="h-4 w-4" />
            {assigneeName || "Unassigned"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-lg bg-neutral-200 px-2.5 py-1">
            <CalendarClock className="h-4 w-4" />
            Due: {dueDate || "Not set"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-lg bg-neutral-200 px-2.5 py-1">
            <ExternalLink className="h-4 w-4" />
            View Task
          </span>
        </div>
      </div>
      {requiresConfirmation ? (
        <div className="flex items-center gap-2 border-t border-neutral-300 px-4 py-3">
          <button type="button" onClick={onConfirm} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
            Confirm
          </button>
          <button type="button" onClick={onEdit} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
            Edit
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
