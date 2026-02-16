export type CollaborationLayer = "messages" | "threads" | "inbox";

export type MessageSenderType = "user" | "ai" | "system" | "email_external";

export type MessageContentType =
  | "text"
  | "protocol_snippet"
  | "task_card"
  | "ai_response"
  | "email";

export type ThreadCategory =
  | "question"
  | "decision"
  | "issue"
  | "action_required"
  | "approval"
  | "clarification";

export type ThreadStatus = "open" | "pending" | "resolved" | "closed";

export type ThreadAnchorType =
  | "document_section"
  | "task"
  | "visit"
  | "trial_wide"
  | "therapeutic_area"
  | "team_member";

export type EmailFolder = "inbox" | "sent" | "drafts" | "archived";

export type EmailPriority = "high" | "medium" | "low";

export type InboxAILabel =
  | "urgent"
  | "action_required"
  | "lab_alert"
  | "safety_report"
  | "sponsor_query"
  | "system_notification"
  | "fyi"
  | "protocol_clarification"
  | "irb_correspondence"
  | "enrollment_update"
  | "administrative"
  | "draft";

export interface InboxLabelSetting {
  key: InboxAILabel;
  enabled: boolean;
  displayName: string;
  color: string;
  textColor: string;
  confidenceThreshold?: number;
}

export interface InboxTriageSettings {
  confidenceThreshold: number;
  autoApplyConfidence?: number;
  labels: InboxLabelSetting[];
}

export interface Conversation {
  id: string;
  trialId: string;
  type: "direct" | "group";
  name: string | null;
  createdBy: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  participants?: ConversationParticipantWithUser[];
  lastMessage?: CollaborationMessage | null;
  unreadCount?: number;
}

export interface ConversationParticipant {
  id: string;
  conversationId: string;
  userId: number;
  joinedAt: string | Date;
  lastReadAt: string | Date | null;
}

export interface ConversationParticipantWithUser extends ConversationParticipant {
  user?: {
    id: number;
    name: string | null;
    email: string | null;
  } | null;
}

export interface CollaborationMessage {
  id: string;
  conversationId: string | null;
  threadId: string | null;
  emailChainId: string | null;
  senderId: number | null;
  senderType: MessageSenderType;
  senderName: string | null;
  senderEmail: string | null;
  content: string;
  contentType: MessageContentType;
  embeddedContent: Record<string, unknown> | null;
  isAiGenerated: boolean;
  aiModel: string | null;
  aiLatencyMs: number | null;
  editedAt: string | Date | null;
  createdAt: string | Date;
}

export interface TrialThread {
  id: string;
  trialId: string;
  title: string;
  category: ThreadCategory;
  status: ThreadStatus;
  resolvedBy: number | null;
  resolvedAt: string | Date | null;
  resolutionSummary: string | null;
  aiContributed: boolean;
  aiResolutionSuggested: boolean;
  createdBy: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  anchors?: ThreadAnchor[];
  participants?: ThreadParticipant[];
  messages?: CollaborationMessage[];
  replyCount?: number;
}

export interface ThreadAnchor {
  id: string;
  threadId: string;
  anchorType: ThreadAnchorType;
  anchorLabel: string;
  anchorRefId: string | null;
  anchorRefType: string | null;
  createdAt: string | Date;
}

export interface ThreadParticipant {
  id: string;
  threadId: string;
  userId: number;
  joinedAt: string | Date;
  lastReadAt: string | Date | null;
  user?: {
    id: number;
    name: string | null;
    email: string | null;
  } | null;
}

export interface TrialInbox {
  id: string;
  trialId: string;
  emailAddress: string;
  isActive: boolean;
  createdAt: string | Date;
}

export interface EmailChain {
  id: string;
  inboxId: string;
  subject: string;
  folder: EmailFolder;
  aiLabels: string[] | null;
  aiPriority: EmailPriority | null;
  aiSummary: string | null;
  aiSuggestedThreadId: string | null;
  linkedThreadId: string | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string[] | null;
  ccAddresses: string[] | null;
  messageCount: number;
  isRead: boolean;
  isStarred: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
  messages?: CollaborationMessage[];
}

export interface CrossReference {
  id: string;
  sourceType: "message" | "thread" | "email_chain" | "task";
  sourceId: string;
  targetType: "message" | "thread" | "email_chain" | "task";
  targetId: string;
  refType: "manual" | "ai_suggested" | "spawned_from";
  createdBy: number | null;
  createdAt: string | Date;
}

export interface DraftResult {
  subject: string;
  body: string;
  protocol_refs: Array<{
    section?: string;
    quoted_text?: string;
  }>;
}

export interface ThreadFilters {
  category?: ThreadCategory;
  status?: ThreadStatus;
  anchorType?: ThreadAnchorType;
}

export interface CreateThreadInput {
  trialId: string;
  title: string;
  category: ThreadCategory;
  anchors?: Array<{
    anchorType: ThreadAnchorType;
    anchorLabel: string;
    anchorRefId?: string;
    anchorRefType?: string;
  }>;
}
