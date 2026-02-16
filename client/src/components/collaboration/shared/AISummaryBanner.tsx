import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, X } from "lucide-react";

interface AISummaryBannerProps {
  summary: string;
}

export function AISummaryBanner({ summary }: AISummaryBannerProps) {
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !summary) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-[#FFFBEB] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex items-center gap-2 text-[13px] font-semibold text-[#92400E]"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Brain className="h-3.5 w-3.5" />
          Themison AI Summary
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-1 text-[#92400E] transition-colors duration-150 hover:bg-amber-100 hover:text-[#78350F]"
          aria-label="Dismiss Themison AI summary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {open ? <p className="mt-2 text-[13px] leading-[1.5] text-[#78350F]">{summary}</p> : null}
    </div>
  );
}
