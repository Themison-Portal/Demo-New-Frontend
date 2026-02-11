import { Sparkles } from "lucide-react";

export function AITypingIndicator() {
  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-700 shadow-sm">
      <Sparkles className="h-3.5 w-3.5" />
      <span>Themison AI is typing...</span>
      <span className="inline-flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500 [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500 [animation-delay:240ms]" />
      </span>
    </div>
  );
}
