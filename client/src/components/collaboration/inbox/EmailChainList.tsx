import type { EmailChain } from "@/types/collaboration";
import { AILabelTag } from "@/components/collaboration/shared/AILabelTag";

interface EmailChainListProps {
  chains: EmailChain[];
  activeChainId: string | null;
  onSelectChain: (chainId: string) => void;
  onDismissLabel: (chainId: string, label: string) => void;
}

function formatTimestamp(value: string | Date) {
  const date = new Date(value);
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function EmailChainList({
  chains,
  activeChainId,
  onSelectChain,
  onDismissLabel,
}: EmailChainListProps) {
  return (
    <div className="h-full overflow-y-auto border-r border-neutral-300 bg-[#f3f4f6] px-2 py-2">
      {chains.map((chain) => {
        const active = chain.id === activeChainId;
        return (
          <button
            key={chain.id}
            type="button"
            onClick={() => onSelectChain(chain.id)}
            className={`mb-2 w-full rounded-xl border border-transparent px-3 py-2.5 text-left ${
              active ? "border-neutral-300 bg-white shadow-sm" : "hover:bg-white/70"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="line-clamp-1 text-sm font-semibold text-neutral-900">{chain.fromName || chain.fromAddress || "Unknown"}</p>
              <span className="text-[11px] text-neutral-500">{formatTimestamp(chain.updatedAt)}</span>
            </div>
            <p className="line-clamp-1 text-sm text-neutral-900">{chain.subject}</p>
            <p className="line-clamp-1 text-xs text-neutral-600">{chain.aiSummary || "No summary"}</p>
            {(chain.aiLabels || []).length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(chain.aiLabels || []).map((label) => (
                  <AILabelTag key={`${chain.id}-${label}`} label={label} onDismiss={() => onDismissLabel(chain.id, label)} />
                ))}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
