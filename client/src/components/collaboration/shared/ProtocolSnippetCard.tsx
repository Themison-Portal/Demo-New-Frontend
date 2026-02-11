import { FileText, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProtocolSnippetCardProps {
  documentName: string;
  sectionRef: string;
  quotedText: string;
  documentLink?: string;
  aiGenerated?: boolean;
}

export function ProtocolSnippetCard({
  documentName,
  sectionRef,
  quotedText,
  documentLink,
  aiGenerated = false,
}: ProtocolSnippetCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-neutral-300 bg-[#f7f7f8] p-3 shadow-sm",
        aiGenerated ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-blue-500"
      )}
    >
      <div className="flex items-center gap-2 text-base font-semibold text-neutral-900">
        <FileText className="h-4 w-4" />
        <span>{documentName}</span> <span className="font-normal text-neutral-600">- {sectionRef}</span>
      </div>
      <blockquote className="mt-2 text-base leading-relaxed text-neutral-700">
        “{quotedText}”
      </blockquote>
      {documentLink ? (
        <a
          href={documentLink}
          className="mt-3 inline-flex items-center gap-1 rounded-lg bg-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-300"
        >
          Open in document <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}
