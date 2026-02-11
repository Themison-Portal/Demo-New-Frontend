import { X } from "lucide-react";

interface AILabelTagProps {
  label: string;
  onDismiss?: () => void;
}

const colorMap: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 border-red-200",
  action_required: "bg-orange-100 text-orange-800 border-orange-200",
  fyi: "bg-slate-100 text-slate-700 border-slate-200",
  sponsor_query: "bg-violet-100 text-violet-800 border-violet-200",
  system_notification: "bg-blue-100 text-blue-800 border-blue-200",
  irb_correspondence: "bg-amber-100 text-amber-800 border-amber-200",
  lab_alert: "bg-rose-100 text-rose-800 border-rose-200",
  enrollment_update: "bg-emerald-100 text-emerald-800 border-emerald-200",
  safety_report: "bg-red-100 text-red-800 border-red-200",
  administrative: "bg-stone-100 text-stone-700 border-stone-200",
  draft: "bg-indigo-100 text-indigo-800 border-indigo-200",
};

function toLabelText(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AILabelTag({ label, onDismiss }: AILabelTagProps) {
  const tone = colorMap[label] || "bg-slate-100 text-slate-700 border-slate-200";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {toLabelText(label)}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="rounded p-0.5 hover:bg-black/10" aria-label={`Dismiss ${label}`}>
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
