import { CircleHelp, CheckCheck, AlertTriangle, CircleDashed, BadgeCheck, CircleEllipsis } from "lucide-react";
import type { ThreadCategory } from "@/types/collaboration";

const categoryStyles: Record<ThreadCategory, string> = {
  question: "bg-amber-100 text-amber-800 border-amber-200",
  decision: "bg-orange-100 text-orange-800 border-orange-200",
  issue: "bg-red-100 text-red-800 border-red-200",
  action_required: "bg-rose-100 text-rose-800 border-rose-200",
  approval: "bg-emerald-100 text-emerald-800 border-emerald-200",
  clarification: "bg-blue-100 text-blue-800 border-blue-200",
};

const categoryIcons: Record<ThreadCategory, typeof CircleHelp> = {
  question: CircleHelp,
  decision: CheckCheck,
  issue: AlertTriangle,
  action_required: CircleDashed,
  approval: BadgeCheck,
  clarification: CircleEllipsis,
};

function toLabel(value: ThreadCategory) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function ThreadCategoryBadge({ category }: { category: ThreadCategory }) {
  const Icon = categoryIcons[category];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${categoryStyles[category]}`}>
      <Icon className="h-3.5 w-3.5" />
      {toLabel(category)}
    </span>
  );
}
