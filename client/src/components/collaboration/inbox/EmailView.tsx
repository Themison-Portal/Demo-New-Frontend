import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  CalendarDays,
  ChevronDown,
  CornerUpLeft,
  Download,
  Image,
  Link2,
  Mail,
  Maximize2,
  MoreVertical,
  Paperclip,
  PenLine,
  SmilePlus,
  Trash2,
} from "lucide-react";
import type { CollaborationMessage, DraftResult, EmailChain } from "@/types/collaboration";
import { toast } from "sonner";
import { AISummaryBanner } from "@/components/collaboration/shared/AISummaryBanner";
import { AILabelTag } from "@/components/collaboration/shared/AILabelTag";

interface EmailViewProps {
  chain: EmailChain | null;
  messages: CollaborationMessage[];
  onReply: (content: string, aiMeta?: { generated: boolean; editedDistance?: number }) => Promise<void>;
  onDraftWithAI: (instructions?: string) => Promise<DraftResult>;
  onLinkThread?: (threadId: string) => Promise<void>;
}

type AttachmentItem = {
  name: string;
  size: string;
  type: string;
};

function formatEmailTime(value: string | Date) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeOnly(value: string | Date) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelativeTime(value: string | Date) {
  const date = new Date(value).getTime();
  const diffMinutes = Math.max(1, Math.floor((Date.now() - date) / 60000));
  if (diffMinutes < 60) return `${diffMinutes} mins ago`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  return `${parts[0][0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function addressList(value: string[] | null | undefined) {
  if (!value || value.length === 0) return "—";
  return value.join(", ");
}

function readAttachmentTone(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes("pdf")) {
    return "border-red-100 bg-red-50 text-red-600";
  }
  if (normalized.includes("fig") || normalized.includes("design")) {
    return "border-violet-100 bg-violet-50 text-violet-600";
  }
  if (normalized.includes("img") || normalized.includes("png") || normalized.includes("jpg")) {
    return "border-blue-100 bg-blue-50 text-blue-600";
  }
  return "border-gray-200 bg-gray-50 text-gray-600";
}

function extractAttachments(messages: CollaborationMessage[]): AttachmentItem[] {
  const attachments: AttachmentItem[] = [];

  for (const message of messages) {
    const payload = message.embeddedContent;
    if (!payload || typeof payload !== "object") continue;
    const raw = (payload as { attachments?: unknown }).attachments;
    if (!Array.isArray(raw)) continue;

    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as { name?: unknown; size?: unknown; type?: unknown };
      const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "Attachment";
      const size = typeof record.size === "string" && record.size.trim() ? record.size.trim() : "Unknown size";
      const type = typeof record.type === "string" && record.type.trim() ? record.type.trim() : "file";
      attachments.push({ name, size, type });
    }
  }

  return attachments;
}

export function EmailView({ chain, messages, onReply, onDraftWithAI, onLinkThread }: EmailViewProps) {
  const [reply, setReply] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftWasAi, setDraftWasAi] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [messages]
  );
  const attachments = useMemo(() => extractAttachments(sortedMessages), [sortedMessages]);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerText !== reply) {
      editorRef.current.innerText = reply;
    }
  }, [reply]);

  useEffect(() => {
    // Keep builder/reply mode clean when switching conversations.
    setReply("");
    setDraftWasAi(false);
    if (editorRef.current) {
      editorRef.current.innerText = "";
    }
  }, [chain?.id]);

  if (!chain) {
    return (
      <div className="flex h-full items-center justify-center bg-white p-6">
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-gray-50">
            <Mail className="h-6 w-6 text-gray-300" />
          </div>
          <p className="text-[15px] font-medium text-gray-500">Select a conversation to view.</p>
          <p className="text-[13px] text-gray-400">Open a thread from the middle pane to review details and reply.</p>
        </div>
      </div>
    );
  }

  const generateDraft = async () => {
    setDraftLoading(true);
    try {
      const draft = await onDraftWithAI();
      setReply(draft.body);
      setDraftWasAi(true);
    } finally {
      setDraftLoading(false);
    }
  };

  const sendReply = async () => {
    const next = reply.trim();
    if (!next) return;
    await onReply(next, draftWasAi ? { generated: true, editedDistance: 0 } : undefined);
    setReply("");
    setDraftWasAi(false);
  };

  const senderName = chain.fromName || "Unknown sender";
  const senderEmail = chain.fromAddress || "unknown@sender.local";
  const headerTime = chain.updatedAt || chain.createdAt;
  const replyRecipients = (chain.toAddresses || []).length > 0 ? chain.toAddresses || [] : [senderEmail];

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="min-h-full bg-white">
        <header className="border-b border-gray-100 px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-[13px] font-semibold text-gray-700">
                {initials(senderName)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-gray-900">{senderName}</p>
                <p className="truncate text-[13px] text-gray-500">{senderEmail}</p>
              </div>
            </div>
            <p className="shrink-0 text-right text-[13px] text-gray-500">
              {formatTimeOnly(headerTime)} ({formatRelativeTime(headerTime)})
            </p>
          </div>
          <h2 className="mt-4 text-xl font-bold leading-tight text-gray-900">{chain.subject}</h2>
          {(chain.aiLabels || []).length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(chain.aiLabels || []).map((label) => (
                <AILabelTag key={`detail-${chain.id}-${label}`} label={label} />
              ))}
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-[44px_1fr] gap-x-3 gap-y-1 text-[13px]">
            <span className="font-medium text-gray-500">To:</span>
            <span className="text-gray-700">{addressList(chain.toAddresses)}</span>
            <span className="font-medium text-gray-500">CC:</span>
            <span className="text-gray-700">{addressList(chain.ccAddresses)}</span>
            <span className="font-medium text-gray-500">Date:</span>
            <span className="text-gray-700">{formatEmailTime(headerTime)}</span>
          </div>
        </header>

        <section className="px-6 pb-6 pt-5">
          {chain.aiSummary ? <AISummaryBanner summary={chain.aiSummary} /> : null}

          <div className="mt-5 space-y-6">
            {sortedMessages.map((message) => (
              <article key={message.id} className="flex gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold ${
                    message.isAiGenerated
                      ? "border-violet-200 bg-violet-50 text-violet-700"
                      : "border-gray-200 bg-gray-50 text-gray-700"
                  }`}
                >
                  {message.isAiGenerated ? <Brain className="h-4 w-4" /> : initials(message.senderName || message.senderEmail || null)}
                </div>
                <div className="min-w-0 flex-1 max-w-[640px]">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-[15px] font-semibold text-gray-900">
                      {message.senderName || message.senderEmail || "Unknown"}
                    </p>
                    <span className="text-[13px] text-gray-500">{formatEmailTime(message.createdAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.65] text-gray-700">{message.content}</p>
                </div>
              </article>
            ))}
          </div>

          {attachments.length > 0 ? (
            <div className="mt-6 rounded-lg border border-gray-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-gray-700">
                  {attachments.length} Attachment{attachments.length > 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-blue-600 transition-colors duration-150 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download All
                </button>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {attachments.map((attachment, index) => (
                  <div
                    key={`${attachment.name}-${index}`}
                    className="flex h-16 min-w-[220px] items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 shadow-sm transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50"
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold uppercase ${readAttachmentTone(
                        attachment.type
                      )}`}
                    >
                      {attachment.type.slice(0, 3).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-gray-700">{attachment.name}</p>
                      <p className="text-xs text-gray-400">{attachment.size}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {chain.linkedThreadId ? (
            <button
              type="button"
              onClick={() => onLinkThread?.(chain.linkedThreadId!)}
              className="mt-5 inline-flex items-center gap-1 text-[13px] font-medium text-blue-600 transition-colors duration-150 hover:text-blue-700 hover:underline"
            >
              <Link2 className="h-3.5 w-3.5" />
              Related Thread: {chain.linkedThreadId}
            </button>
          ) : null}
          {!chain.linkedThreadId && chain.aiSuggestedThreadId ? (
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[12px] font-medium text-blue-600">
              <Brain className="h-3.5 w-3.5" />
              Themison AI suggested thread: {chain.aiSuggestedThreadId}
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={generateDraft}
              disabled={draftLoading}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3.5 text-[13px] font-medium text-gray-700 transition-colors duration-150 hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Brain className={`h-3.5 w-3.5 text-indigo-600 ${draftLoading ? "animate-pulse" : ""}`} />
              {draftLoading ? "Generating with Themison AI..." : "Draft with Themison AI"}
            </button>
            <span className="text-xs italic text-gray-400">Themison AI drafts are suggestions. Review before sending.</span>
          </div>

          <div className="mt-3 rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow duration-150 focus-within:shadow-md focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-1">
            <div className="flex items-center gap-3 border-b border-gray-200 px-3 py-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-gray-700 transition-colors duration-150 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
              >
                <CornerUpLeft className="h-3.5 w-3.5" />
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <span className="text-[13px] text-gray-500">To:</span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {replyRecipients.slice(0, 3).map((recipient) => (
                  <span
                    key={recipient}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                  >
                    {recipient}
                    <span className="text-gray-500">×</span>
                  </span>
                ))}
                {replyRecipients.length > 3 ? (
                  <span className="text-xs text-gray-500">+{replyRecipients.length - 3}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="text-[13px] text-gray-500 transition-colors duration-150 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
              >
                Cc
              </button>
              <button
                type="button"
                className="text-[13px] text-gray-500 transition-colors duration-150 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
              >
                Bcc
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                aria-label="Expand composer"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="relative min-h-[120px] border-b border-gray-200">
              {!reply.trim() && !composerFocused ? (
                <span className="pointer-events-none absolute left-4 top-4 text-sm text-gray-400">
                  Type your reply...
                </span>
              ) : null}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-[120px] whitespace-pre-wrap px-4 py-4 text-sm leading-[1.65] text-gray-700 outline-none"
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                onInput={(event) => {
                  const text = event.currentTarget.innerText;
                  setReply(text);
                  if (!text.trim()) {
                    setDraftWasAi(false);
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  aria-label="Attach file"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  aria-label="Insert link"
                >
                  <Link2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  aria-label="Insert image"
                >
                  <Image className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  aria-label="Insert signature"
                >
                  <PenLine className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  aria-label="Insert emoji"
                >
                  <SmilePlus className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setReply("");
                    setDraftWasAi(false);
                    if (editorRef.current) editorRef.current.innerText = "";
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  aria-label="Clear draft"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  aria-label="More options"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                <div className="inline-flex rounded-md shadow-sm">
                  <button
                    type="button"
                    onClick={sendReply}
                    disabled={!reply.trim()}
                    className="inline-flex h-8 items-center justify-center rounded-l-md bg-blue-600 px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    Send now
                  </button>
                  <button
                    type="button"
                    onClick={() => toast.info("Schedule send is coming soon.")}
                    disabled={!reply.trim()}
                    title="Schedule send"
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-r-md border-l border-white/20 bg-blue-600 px-2.5 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-blue-300"
                    aria-label="Schedule send (coming soon)"
                  >
                    <CalendarDays className="h-4 w-4" />
                    Schedule
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
