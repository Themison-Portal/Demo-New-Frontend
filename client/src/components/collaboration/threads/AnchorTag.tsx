import { Link2 } from "lucide-react";
import type { ThreadAnchor } from "@/types/collaboration";

interface AnchorTagProps {
  anchor: ThreadAnchor;
  onClick?: (anchor: ThreadAnchor) => void;
}

export function AnchorTag({ anchor, onClick }: AnchorTagProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(anchor)}
      className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-neutral-200/70 px-2.5 py-0.5 text-sm text-neutral-700 hover:bg-neutral-200"
    >
      <Link2 className="h-3.5 w-3.5" />
      {anchor.anchorLabel}
    </button>
  );
}
