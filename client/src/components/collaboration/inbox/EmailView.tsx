import { useState } from "react";
import type { CollaborationMessage, DraftResult, EmailChain } from "@/types/collaboration";
import { AISummaryBanner } from "@/components/collaboration/shared/AISummaryBanner";

interface EmailViewProps {
  chain: EmailChain | null;
  messages: CollaborationMessage[];
  onReply: (content: string, aiMeta?: { generated: boolean; editedDistance?: number }) => Promise<void>;
  onDraftWithAI: (instructions?: string) => Promise<DraftResult>;
  onLinkThread?: (threadId: string) => Promise<void>;
}

function formatEmailTime(value: string | Date) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EmailView({ chain, messages, onReply, onDraftWithAI, onLinkThread }: EmailViewProps) {
  const [reply, setReply] = useState("");
  const [instructions, setInstructions] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);

  if (!chain) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a conversation to view.
      </div>
    );
  }

  const generateDraft = async () => {
    setDraftLoading(true);
    try {
      const draft = await onDraftWithAI(instructions || undefined);
      setReply(draft.body);
    } finally {
      setDraftLoading(false);
    }
  };

  const sendReply = async () => {
    const next = reply.trim();
    if (!next) return;
    const aiGenerated = Boolean(chain.aiSummary || instructions || /\[VERIFY\]/.test(next));
    await onReply(next, aiGenerated ? { generated: true, editedDistance: 0 } : undefined);
    setReply("");
  };

  return (
    <div className="flex h-full flex-col bg-[#f6f6f7]">
      <div className="border-b border-neutral-300 bg-[#f3f4f6] px-4 py-3">
        <h3 className="text-lg font-semibold text-neutral-900">{chain.subject}</h3>
        <p className="text-sm text-neutral-600">{chain.fromName || chain.fromAddress || "Unknown sender"}</p>
        {chain.linkedThreadId ? (
          <button
            type="button"
            onClick={() => onLinkThread?.(chain.linkedThreadId!)}
            className="mt-1 text-xs font-medium text-blue-600 hover:underline"
          >
            Related Thread: {chain.linkedThreadId}
          </button>
        ) : null}
        {!chain.linkedThreadId && chain.aiSuggestedThreadId ? (
          <div className="mt-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-xs text-violet-800">
            AI suggested related thread: {chain.aiSuggestedThreadId}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {chain.aiSummary ? <AISummaryBanner summary={chain.aiSummary} /> : null}

        <div className="space-y-3">
          {messages.map((message) => (
            <article key={message.id} className="rounded-2xl border border-neutral-300 bg-white p-3 shadow-sm">
              <div className="text-xs text-neutral-500">
                {message.senderName || message.senderEmail || "Unknown"} · {formatEmailTime(message.createdAt)}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-800">{message.content}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-neutral-300 bg-[#f3f4f6] p-3">
        <button
          type="button"
          onClick={generateDraft}
          disabled={draftLoading}
          className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
        >
          {draftLoading ? "Drafting..." : "Draft with AI"}
        </button>
        <input
          className="h-9 w-full rounded-lg border border-neutral-300 bg-white px-2 text-xs"
          placeholder="Any specific instructions?"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
        <textarea
          className="min-h-[110px] w-full rounded-xl border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          placeholder="Reply"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
        />
        <button type="button" onClick={sendReply} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
          Send Reply
        </button>
      </div>
    </div>
  );
}
