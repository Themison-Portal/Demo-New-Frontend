import { FormEvent, useMemo, useState } from "react";
import { Paperclip, Plus, Send, Sparkles } from "lucide-react";

interface MessageInputProps {
  placeholder?: string;
  onSend: (content: string) => Promise<void> | void;
  disabled?: boolean;
}

export function MessageInput({ placeholder = "Write a message...", onSend, disabled = false }: MessageInputProps) {
  const [value, setValue] = useState("");
  const showAiHint = useMemo(() => /@themison/i.test(value), [value]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    if (!next || disabled) return;
    setValue("");
    await onSend(next);
  };

  return (
    <form onSubmit={submit} className="space-y-1 border-t border-neutral-300 bg-[#f3f4f6] px-6 py-4">
      <div className="rounded-[24px] border border-neutral-300 bg-white p-4">
        <textarea
          className="min-h-[84px] w-full resize-none border-none bg-transparent px-1 py-1 text-base text-neutral-800 outline-none placeholder:text-neutral-400"
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled}
          rows={2}
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50"
              aria-label="Attach"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50"
              aria-label="Add"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <button
            type="submit"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-neutral-300 text-white transition hover:bg-neutral-400 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || !value.trim()}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
      {showAiHint ? (
        <div className="inline-flex items-center gap-1 text-xs text-neutral-500">
          <Sparkles className="h-3.5 w-3.5" />
          Themison AI will respond with trial context
        </div>
      ) : null}
    </form>
  );
}
