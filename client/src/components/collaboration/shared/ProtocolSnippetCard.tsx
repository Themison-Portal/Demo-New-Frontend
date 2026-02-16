import { FileText, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProtocolSnippetCardProps {
  documentName: string;
  sectionRef: string;
  quotedText: string;
  documentLink?: string;
  aiGenerated?: boolean;
  variant?: "default" | "messages";
  compact?: boolean;
}

export function ProtocolSnippetCard({
  documentName,
  sectionRef,
  quotedText,
  documentLink,
  aiGenerated = false,
  variant = "default",
  compact = false,
}: ProtocolSnippetCardProps) {
  const isMessages = variant === "messages";

  return (
    <div
      className={cn(
        isMessages
          ? compact
            ? "w-full max-w-[860px] rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm"
            : "rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
          : "rounded-2xl border border-neutral-300 bg-[#f7f7f8] p-3 shadow-sm",
        aiGenerated
          ? isMessages
            ? "border-l-[3px] border-l-emerald-500"
            : "border-l-4 border-l-emerald-500"
          : isMessages
            ? "border-l-[3px] border-l-blue-500"
            : "border-l-4 border-l-blue-500"
      )}
    >
      <div
        className={
          isMessages
            ? compact
              ? "flex items-center gap-1.5 text-xs font-semibold text-gray-900"
              : "flex items-center gap-2 text-[13px] font-semibold text-gray-900"
            : "flex items-center gap-2 text-base font-semibold text-neutral-900"
        }
      >
        <FileText className={isMessages && compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        <span>{documentName}</span>{" "}
        <span className={isMessages ? "font-normal text-gray-500" : "font-normal text-neutral-600"}>
          {isMessages ? "—" : "-"} {sectionRef}
        </span>
      </div>
      <blockquote
        className={
          isMessages
            ? compact
              ? "mt-1.5 line-clamp-3 text-xs leading-relaxed text-gray-700"
              : "mt-2 text-[13px] leading-relaxed text-gray-700"
            : "mt-2 text-base leading-relaxed text-neutral-700"
        }
      >
        “{quotedText}”
      </blockquote>
      {documentLink ? (
        <a
          href={documentLink}
          className={
            isMessages
              ? compact
                ? "mt-2 inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100"
                : "mt-3 inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
              : "mt-3 inline-flex items-center gap-1 rounded-lg bg-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-300"
          }
        >
          Open in document <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}
