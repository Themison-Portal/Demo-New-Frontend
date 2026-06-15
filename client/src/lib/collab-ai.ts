import { collabApi } from "@/lib/apiClient";

export async function classifyCollabIntent(content: string) {
    return collabApi.classifyIntent(content);
}

export async function requestCollabAIResponse(input: {
    trialId: string;
    layer: "messages" | "threads" | "inbox";
    question: string;
    conversationId?: string;
    threadId?: string;
    emailChainId?: string;
}) {
    return collabApi.aiRespond(input);
}

export async function triageInboxEmail(chainId: string) {
    return collabApi.triageEmail(chainId);
}

export async function draftInboxEmail(chainId: string, instructions?: string) {
    return collabApi.draftEmail(chainId, instructions);
}

export async function suggestThreadResolution(threadId: string) {
    return collabApi.suggestResolution(threadId);
}

export async function createAITaskProposal(input: {
    trialId: string;
    content: string;
    conversationId?: string;
    threadId?: string;
    sourceMessageId?: string;
}) {
    return collabApi.createTaskProposal(input);
}
