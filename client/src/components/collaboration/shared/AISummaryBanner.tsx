import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles, X } from "lucide-react";

interface AISummaryBannerProps {
  summary: string;
}

export function AISummaryBanner({ summary }: AISummaryBannerProps) {
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !summary) return null;

  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium text-amber-900"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Sparkles className="h-4 w-4" />
          AI Summary
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-1 text-amber-900 hover:bg-amber-100"
          aria-label="Dismiss AI summary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {open ? <p className="mt-2 text-sm text-amber-900">{summary}</p> : null}
    </div>
  );
}
