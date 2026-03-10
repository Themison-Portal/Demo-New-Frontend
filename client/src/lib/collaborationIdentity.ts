import type { Conversation } from "@/types/collaboration";

export type CollaborationIdentity = {
  id?: string | number | null;
  name?: string | null;
  email?: string | null;
};

export type CollaborationIdentityLike = CollaborationIdentity & {
  userId?: string | number | null;
  user?: CollaborationIdentity | null;
};

export function normalizeCollaborationName(value: unknown) {
  return typeof value === "string" ? value.toLowerCase().replace(/\s+/g, " ").trim() : "";
}

export function normalizeCollaborationEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeCollaborationId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim().toLowerCase();
  return "";
}

export function getCollaborationIdentityId(
  value: CollaborationIdentityLike | null | undefined
): string | number | null {
  return value?.userId ?? value?.id ?? value?.user?.id ?? null;
}

export function getCollaborationIdentityName(
  value: CollaborationIdentityLike | null | undefined
): string | null {
  return value?.user?.name ?? value?.name ?? null;
}

export function getCollaborationIdentityEmail(
  value: CollaborationIdentityLike | null | undefined
): string | null {
  return value?.user?.email ?? value?.email ?? null;
}

export function collaborationIdsMatch(left: unknown, right: unknown) {
  const leftNormalized = normalizeCollaborationId(left);
  const rightNormalized = normalizeCollaborationId(right);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;

  const leftNumber = Number(leftNormalized);
  const rightNumber = Number(rightNormalized);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
}

export function matchesCollaborationIdentity(
  candidate: CollaborationIdentityLike | null | undefined,
  currentUser: CollaborationIdentity | null | undefined
) {
  if (!candidate || !currentUser) return false;

  if (collaborationIdsMatch(getCollaborationIdentityId(candidate), currentUser.id)) {
    return true;
  }

  const candidateEmail = normalizeCollaborationEmail(getCollaborationIdentityEmail(candidate));
  const currentEmail = normalizeCollaborationEmail(currentUser.email);
  if (candidateEmail && currentEmail && candidateEmail === currentEmail) {
    return true;
  }

  const candidateName = normalizeCollaborationName(getCollaborationIdentityName(candidate));
  const currentName = normalizeCollaborationName(currentUser.name);
  return Boolean(candidateName && currentName && candidateName === currentName);
}

export function isLegacyDemoUserName(value: unknown) {
  return normalizeCollaborationName(value) === "demo user";
}

export function getOtherConversationParticipant(
  conversation: Conversation,
  currentUser: CollaborationIdentity | null | undefined
) {
  const participants = conversation.participants || [];
  if (!participants.length) return null;

  if (currentUser) {
    return participants.find((participant) => !matchesCollaborationIdentity(participant, currentUser)) || null;
  }

  return (
    participants.find((participant) => !collaborationIdsMatch(participant.userId, conversation.createdBy)) ||
    participants[0] ||
    null
  );
}

export function getConversationDisplayName(
  conversation: Conversation,
  currentUser: CollaborationIdentity | null | undefined
) {
  if (conversation.type === "group") {
    return conversation.name || "Group Conversation";
  }

  const otherParticipant = getOtherConversationParticipant(conversation, currentUser);
  if (otherParticipant?.user?.name) return otherParticipant.user.name;

  const participants = (conversation.participants || []).filter((participant) => participant.user?.name);
  return participants[0]?.user?.name || conversation.name || "Conversation";
}
