import { useCallback } from "react";
import { classifyCollabIntent, createAITaskProposal, draftInboxEmail, requestCollabAIResponse, suggestThreadResolution, triageInboxEmail } from "@/lib/collab-ai";
import { useCollaborationStore } from "@/stores/collaborationStore";
import type { CollaborationLayer } from "@/types/collaboration";

export function useCollabAI() {
  const setActiveLayer = useCollaborationStore((store) => store.setActiveLayer);

  const classifyIntent = useCallback(async (content: string) => {
    return classifyCollabIntent(content);
  }, []);

  const requestResponse = useCallback(
    async (input: {
      trialId: string;
      layer: CollaborationLayer;
      question: string;
      conversationId?: string;
      threadId?: string;
      emailChainId?: string;
    }) => {
      setActiveLayer(input.layer);
      return requestCollabAIResponse(input);
    },
    [setActiveLayer]
  );

  const triageEmail = useCallback(async (chainId: string) => {
    return triageInboxEmail(chainId);
  }, []);

  const draftEmail = useCallback(async (chainId: string, instructions?: string) => {
    return draftInboxEmail(chainId, instructions);
  }, []);

  const createTaskProposal = useCallback(
    async (input: {
      trialId: string;
      content: string;
      conversationId?: string;
      threadId?: string;
      sourceMessageId?: string;
    }) => {
      return createAITaskProposal(input);
    },
    []
  );

  const requestResolutionSummary = useCallback(async (threadId: string) => {
    return suggestThreadResolution(threadId);
  }, []);

  return {
    classifyIntent,
    requestResponse,
    triageEmail,
    draftEmail,
    createTaskProposal,
    requestResolutionSummary,
  };
}
