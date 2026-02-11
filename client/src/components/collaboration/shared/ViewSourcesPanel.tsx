import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";

interface SourceItem {
  document_name?: string;
  section_ref?: string;
  quoted_text?: string;
  page_number?: number | null;
}

interface ViewSourcesPanelProps {
  sources?: SourceItem[];
  onSourceClick?: (source: SourceItem) => void;
}

export function ViewSourcesPanel({ sources = [], onSourceClick }: ViewSourcesPanelProps) {
  const [open, setOpen] = useState(false);
  const validSources = useMemo(() => sources.filter((source) => source.document_name), [sources]);

  if (!validSources.length) return null;

  return (
    <div className="mt-2 rounded-xl border border-neutral-300 bg-white/90">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-neutral-600"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          View Sources ({validSources.length})
        </span>
      </button>
      {open ? (
        <div className="space-y-2 px-3 pb-3">
          {validSources.map((source, index) => (
            <button
              key={`${source.document_name}-${source.section_ref}-${index}`}
              type="button"
              className="w-full rounded-lg border border-neutral-300 bg-neutral-100 p-2 text-left transition-colors hover:bg-neutral-200"
              onClick={() => onSourceClick?.(source)}
            >
              <div className="flex items-center gap-1 text-xs font-medium text-neutral-800">
                <FileText className="h-3.5 w-3.5" />
                {source.document_name}
                {source.section_ref ? `, ${source.section_ref}` : ""}
              </div>
              {source.quoted_text ? (
                <p className="mt-1 text-xs text-neutral-600">{source.quoted_text}</p>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
