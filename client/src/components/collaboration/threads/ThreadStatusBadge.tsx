import { CircleCheck, CircleDot, CircleOff } from "lucide-react";
import type { ThreadStatus } from "@/types/collaboration";

const statusStyles: Record<ThreadStatus, string> = {
  open: "bg-slate-100 text-slate-800 border-slate-200",
  pending: "bg-red-100 text-red-800 border-red-200",
  resolved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  closed: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

const icons: Record<ThreadStatus, typeof CircleDot> = {
  open: CircleDot,
  pending: CircleDot,
  resolved: CircleCheck,
  closed: CircleOff,
};

export function ThreadStatusBadge({ status }: { status: ThreadStatus }) {
  const Icon = icons[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusStyles[status]}`}>
      <Icon className="h-3.5 w-3.5" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
