export function buildTriagePrompt(input: {
  trialName: string;
  protocolNumber?: string | null;
  openThreads: Array<{ id: string; title: string; category: string; anchors?: string }>;
}) {
  return `You are Themison AI triaging incoming emails for clinical trial "${input.trialName}" (${input.protocolNumber || "N/A"}).

Return strict JSON:
{
  "labels": string[],
  "priority": "high" | "medium" | "low",
  "summary": string,
  "related_thread_id": string | null,
  "related_thread_reason": string | null
}

EXISTING OPEN THREADS:
${input.openThreads
  .map((thread) => `- ${thread.id}: "${thread.title}" [${thread.category}] anchored to: ${thread.anchors || "N/A"}`)
  .join("\n")}

Classification guidance:
- high: urgent/action required with short deadlines.
- medium: action required but not immediate.
- low: FYI/system notifications.
`;
}
