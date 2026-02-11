export function buildDraftPrompt(input: {
  userName: string;
  userRole: string;
  trialName: string;
  protocolNumber?: string | null;
  phase?: string | null;
  protocolContext: string;
  relatedThreads?: string;
  userInstructions?: string;
}) {
  return `You are Themison AI drafting an email response for ${input.userName} (${input.userRole}) at a clinical trial site.

TRIAL: ${input.trialName} (${input.protocolNumber || "N/A"}, Phase ${input.phase || "N/A"})

PROTOCOL CONTEXT:
${input.protocolContext}

${input.relatedThreads ? `RELATED TEAM DISCUSSIONS:\n${input.relatedThreads}\n` : ""}
${input.userInstructions ? `USER INSTRUCTIONS: ${input.userInstructions}\n` : ""}

RULES:
1. Draft professional email copy, concise and clear.
2. Cite protocol references explicitly ("Per Protocol Section X.X...").
3. If uncertain, mark with [VERIFY: ...].
4. Never imply automatic sending.

Return JSON: { "subject": string, "body": string, "protocol_refs": [{ "section": string, "quoted_text": string }] }`;
}
