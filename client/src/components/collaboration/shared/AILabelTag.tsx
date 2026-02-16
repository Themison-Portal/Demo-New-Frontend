import { X } from "lucide-react";
import { withHexAlpha } from "@/lib/inbox-triage-settings";

interface AILabelTagProps {
  label: string;
  displayName?: string;
  color?: string;
  textColor?: string;
  onDismiss?: () => void;
}

const colorMap: Record<string, { backgroundColor: string; color: string; borderColor: string }> = {
  urgent: { backgroundColor: "#FEF2F2", color: "#DC2626", borderColor: "#FECACA" },
  action_required: { backgroundColor: "#FFF7ED", color: "#EA580C", borderColor: "#FED7AA" },
  lab_alert: { backgroundColor: "#FEF2F2", color: "#DC2626", borderColor: "#FECACA" },
  safety_report: { backgroundColor: "#FEF2F2", color: "#DC2626", borderColor: "#FECACA" },
  sponsor_query: { backgroundColor: "#F5F3FF", color: "#7C3AED", borderColor: "#DDD6FE" },
  system_notification: { backgroundColor: "#EFF6FF", color: "#2563EB", borderColor: "#BFDBFE" },
  fyi: { backgroundColor: "#F9FAFB", color: "#6B7280", borderColor: "#E5E7EB" },
  protocol_clarification: { backgroundColor: "#ECFDF5", color: "#059669", borderColor: "#A7F3D0" },
  irb_correspondence: { backgroundColor: "#FFFBEB", color: "#D97706", borderColor: "#FDE68A" },
  enrollment_update: { backgroundColor: "#EFF6FF", color: "#2563EB", borderColor: "#BFDBFE" },
  administrative: { backgroundColor: "#F9FAFB", color: "#6B7280", borderColor: "#E5E7EB" },
  draft: { backgroundColor: "#F9FAFB", color: "#6B7280", borderColor: "#E5E7EB" },
};

function toLabelText(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AILabelTag({
  label,
  displayName,
  color,
  textColor,
  onDismiss,
}: AILabelTagProps) {
  const tone = colorMap[label] || colorMap.fyi;
  const useCustomTone = Boolean(color);
  const custom = {
    backgroundColor: withHexAlpha(color || "", "1A"),
    borderColor: withHexAlpha(color || "", "4D"),
    color: textColor || color || undefined,
  };

  return (
    <span
      className="group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium leading-none"
      style={useCustomTone ? custom : tone}
    >
      {displayName || toLabelText(label)}
      {onDismiss ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDismiss();
          }}
          className="hidden h-3.5 w-3.5 items-center justify-center rounded-full opacity-50 transition-opacity duration-150 hover:opacity-100 group-hover:inline-flex"
          aria-label={`Dismiss ${label}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      ) : null}
    </span>
  );
}
