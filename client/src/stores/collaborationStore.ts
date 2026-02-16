import { useSyncExternalStore } from "react";
import { collabApi } from "@/lib/collab-api";
import {
  createDefaultInboxTriageSettings,
  loadInboxTriageSettings,
  normalizeInboxTriageSettings,
  saveInboxTriageSettings,
} from "@/lib/inbox-triage-settings";
import type {
  CollaborationLayer,
  CollaborationMessage,
  Conversation,
  CreateThreadInput,
  DraftResult,
  EmailChain,
  InboxAILabel,
  InboxLabelSetting,
  InboxTriageSettings,
  ThreadFilters,
  TrialInbox,
  TrialThread,
} from "@/types/collaboration";

type InboxFolderView = "inbox" | "unread" | "sent" | "drafts";
type DemoDataMode = "sample" | "full" | "building";

type CollaborationStore = {
  dataMode: DemoDataMode;
  setDataMode: (mode: DemoDataMode) => void;
  activeLayer: CollaborationLayer;
  setActiveLayer: (layer: CollaborationLayer) => void;

  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, CollaborationMessage[]>;
  aiIsTyping: boolean;
  setActiveConversation: (conversationId: string | null) => void;
  loadConversations: (trialId: string) => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    content: string,
    embeddedContent?: Record<string, unknown>,
    contentType?: CollaborationMessage["contentType"]
  ) => Promise<void>;
  createDirectConversationWithMember: (
    trialId: string,
    member: { id: string; name: string; email: string }
  ) => Promise<Conversation | null>;

  threads: TrialThread[];
  activeThreadId: string | null;
  threadMessages: Record<string, CollaborationMessage[]>;
  threadFilters: ThreadFilters;
  setActiveThread: (threadId: string | null) => void;
  setThreadFilters: (filters: ThreadFilters) => void;
  loadThreads: (trialId: string, filters?: ThreadFilters) => Promise<void>;
  loadThreadMessages: (threadId: string) => Promise<void>;
  createThread: (data: CreateThreadInput) => Promise<TrialThread | null>;
  resolveThread: (threadId: string, summary: string) => Promise<void>;
  requestAIResolutionSummary: (threadId: string) => Promise<string>;

  inboxConfig: TrialInbox | null;
  emailChains: EmailChain[];
  activeEmailChainId: string | null;
  emailMessages: Record<string, CollaborationMessage[]>;
  activeFolder: InboxFolderView;
  aiDraft: DraftResult | null;
  aiDraftLoading: boolean;
  inboxTriageSettings: InboxTriageSettings;
  setActiveFolder: (folder: InboxFolderView) => void;
  setActiveEmailChain: (chainId: string | null) => void;
  updateInboxTriageLabel: (
    label: InboxAILabel,
    patch: Partial<Omit<InboxLabelSetting, "key">>
  ) => void;
  setInboxTriageConfidence: (confidence: number) => void;
  resetInboxTriageSettings: () => void;
  loadInbox: (trialId: string) => Promise<void>;
  loadEmailChains: (folder?: InboxFolderView) => Promise<void>;
  loadEmailMessages: (chainId: string) => Promise<void>;
  dismissAILabel: (chainId: string, label: string) => Promise<void>;
  requestAIDraft: (chainId: string, instructions?: string) => Promise<DraftResult>;

  spawnThreadFromMessage: (messageId: string, threadData: CreateThreadInput) => Promise<TrialThread | null>;
  linkEmailToThread: (emailChainId: string, threadId: string) => Promise<void>;
  createThreadFromEmail: (emailChainId: string, threadData: CreateThreadInput) => Promise<TrialThread | null>;

  subscribeToUpdates: (trialId: string) => void;
  unsubscribe: () => void;

  isLoading: boolean;
  error: string | null;
};

type LocalDemoInboxDataset = {
  chains: EmailChain[];
  messagesByChain: Record<string, CollaborationMessage[]>;
};

type LocalDemoConversationDataset = {
  seedVersion?: number;
  memberSignature?: string;
  conversations: Conversation[];
  messagesByConversation: Record<string, CollaborationMessage[]>;
};

type LocalDemoThreadDataset = {
  seedVersion?: number;
  memberSignature?: string;
  threads: TrialThread[];
  messagesByThread: Record<string, CollaborationMessage[]>;
};

type DirectConversationMemberInput = {
  id: string;
  name: string;
  email: string;
};

const LOCAL_DEMO_INBOX_PREFIX = "themison-collab-demo-inbox-v3";
const LOCAL_DEMO_CONVERSATION_PREFIX = "themison-collab-demo-conversations-v3";
const LOCAL_DEMO_THREAD_PREFIX = "themison-collab-demo-threads-v1";
const DEMO_SELF_USER_ID = 7101;
const CONVERSATION_DEMO_SEED_VERSION = 3;
const THREAD_DEMO_SEED_VERSION = 4;
const DEMO_STATE_STORAGE_PREFIX = "themison-demo-state";
const DEMO_STATE_ACTIVE_MODE_KEY = `${DEMO_STATE_STORAGE_PREFIX}-active-mode`;
const LEGACY_MEMBER_EMAIL_DOMAIN = "@themison.com";
const CURRENT_MEMBER_EMAIL_DOMAIN = "@azorg.be";

type DemoTeamMemberSeed = {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
};

function normalizeDemoMemberEmail(value: string) {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().endsWith(LEGACY_MEMBER_EMAIL_DOMAIN)) {
    return trimmed;
  }
  return `${trimmed.slice(0, -LEGACY_MEMBER_EMAIL_DOMAIN.length)}${CURRENT_MEMBER_EMAIL_DOMAIN}`;
}

function getRuntimeUserIdentity() {
  if (typeof window === "undefined") {
    return {
      id: DEMO_SELF_USER_ID,
      name: "Kaleb Sanders",
      email: "kaleb.s@azorg.be",
    };
  }

  try {
    const raw = window.localStorage.getItem("manus-runtime-user-info");
    if (!raw) {
      return {
        id: DEMO_SELF_USER_ID,
        name: "Kaleb Sanders",
        email: "kaleb.s@azorg.be",
      };
    }

    const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown; email?: unknown };
    const parsedId = Number(parsed.id);
    return {
      id: Number.isFinite(parsedId) ? parsedId : DEMO_SELF_USER_ID,
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : "Kaleb Sanders",
      email:
        typeof parsed.email === "string" && parsed.email.trim()
          ? normalizeDemoMemberEmail(parsed.email)
          : "kaleb.s@azorg.be",
    };
  } catch {
    return {
      id: DEMO_SELF_USER_ID,
      name: "Kaleb Sanders",
      email: "kaleb.s@azorg.be",
    };
  }
}

function isDemoDataMode(value: string | null): value is DemoDataMode {
  return value === "sample" || value === "full" || value === "building";
}

function getDemoStateStorageKey(mode: DemoDataMode) {
  switch (mode) {
    case "full":
      return `${DEMO_STATE_STORAGE_PREFIX}-full`;
    case "building":
      return `${DEMO_STATE_STORAGE_PREFIX}-building`;
    case "sample":
    default:
      return `${DEMO_STATE_STORAGE_PREFIX}-sample`;
  }
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function toInitials(value: string) {
  const parts = value
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "TM";
}

function getTeamMembersFromDemoState(): DemoTeamMemberSeed[] {
  if (typeof window === "undefined") return [];
  try {
    const activeModeRaw = window.localStorage.getItem(DEMO_STATE_ACTIVE_MODE_KEY);
    const activeMode: DemoDataMode = isDemoDataMode(activeModeRaw) ? activeModeRaw : "sample";
    const key = getDemoStateStorageKey(activeMode);
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as { teamMembers?: unknown };
    if (!Array.isArray(parsed.teamMembers)) return [];

    return parsed.teamMembers
      .map((item, index) => {
        if (!item || typeof item !== "object") return null;
        const member = item as Record<string, unknown>;
        const name = typeof member.name === "string" ? member.name.trim() : "";
        if (!name) return null;

        const idRaw = typeof member.id === "string" || typeof member.id === "number" ? String(member.id) : "";
        const id = idRaw.trim() || `member-${index + 1}`;
        const emailRaw = typeof member.email === "string" ? member.email.trim() : "";
        const email =
          (emailRaw ? normalizeDemoMemberEmail(emailRaw) : "") ||
          `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\.|\.$)/g, "")}@azorg.be`;
        const role = typeof member.role === "string" && member.role.trim() ? member.role.trim() : "Study Team";
        const initials =
          typeof member.initials === "string" && member.initials.trim()
            ? member.initials.trim().toUpperCase()
            : toInitials(name);

        return {
          id,
          name,
          email,
          role,
          initials,
        } as DemoTeamMemberSeed;
      })
      .filter((member): member is DemoTeamMemberSeed => Boolean(member));
  } catch {
    return [];
  }
}

function getFallbackTeamMembers(): DemoTeamMemberSeed[] {
  return [
    {
      id: "member-2",
      name: "Ava Patel",
      email: "ava.patel@azorg.be",
      role: "Sub-Investigator",
      initials: "AP",
    },
    {
      id: "member-3",
      name: "Liam Chen",
      email: "liam.chen@azorg.be",
      role: "Clinical Research Coordinator",
      initials: "LC",
    },
    {
      id: "member-4",
      name: "Maya Rodriguez",
      email: "maya.rodriguez@azorg.be",
      role: "Research Nurse",
      initials: "MR",
    },
    {
      id: "member-5",
      name: "Noah Brooks",
      email: "noah.brooks@azorg.be",
      role: "Data Manager",
      initials: "NB",
    },
  ];
}

function getSeedMembers(runtimeUser: ReturnType<typeof getRuntimeUserIdentity>): DemoTeamMemberSeed[] {
  const runtimeName = normalizeName(runtimeUser.name);
  const runtimeEmail = runtimeUser.email.toLowerCase();
  const allMembers = getTeamMembersFromDemoState();
  const candidates = allMembers.length ? allMembers : getFallbackTeamMembers();

  const withoutSelf = candidates.filter((member) => {
    if (member.email.toLowerCase() === runtimeEmail) return false;
    if (normalizeName(member.name) === runtimeName) return false;
    return true;
  });

  if (withoutSelf.length > 0) return withoutSelf;
  return getFallbackTeamMembers().filter((member) => normalizeName(member.name) !== runtimeName);
}

function getStableMemberUserId(seed: string, index: number, selfId: number) {
  const direct = Number(seed);
  if (Number.isFinite(direct) && direct !== selfId) return direct;

  const trailingDigits = /(\d+)$/.exec(seed);
  if (trailingDigits) {
    const parsed = 8200 + Number(trailingDigits[1]);
    if (parsed !== selfId) return parsed;
  }

  let hash = 0;
  for (const character of seed) {
    hash = (hash * 33 + character.charCodeAt(0)) % 100000;
  }
  const fallback = 10000 + hash + index;
  return fallback === selfId ? fallback + 97 : fallback;
}

function toSlug(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "member";
}

function getConversationMemberSignature(
  runtimeUser: ReturnType<typeof getRuntimeUserIdentity>,
  members: DemoTeamMemberSeed[]
) {
  const encodedMembers = [...members]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((member) => `${member.id}|${normalizeName(member.name)}|${member.email.toLowerCase()}`)
    .join(";");
  return `${CONVERSATION_DEMO_SEED_VERSION}|${runtimeUser.id}|${normalizeName(runtimeUser.name)}|${runtimeUser.email.toLowerCase()}|${encodedMembers}`;
}

function isLikelyDemoInboxError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed query|unknown column|doesn't exist|email_chains|trial_inboxes|messages/i.test(message.toLowerCase());
}

function getDemoStorageKey(trialId: string) {
  return `${LOCAL_DEMO_INBOX_PREFIX}:${trialId}`;
}

function parseDemoDataset(raw: string | null): LocalDemoInboxDataset | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalDemoInboxDataset;
    if (!parsed || !Array.isArray(parsed.chains) || typeof parsed.messagesByChain !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildDefaultDemoDataset(trialId: string, inboxEmail: string): LocalDemoInboxDataset {
  const now = Date.now();
  const messengerChainId = `${trialId}-demo-messenger-chain`;
  const labAlertChainId = `${trialId}-demo-lab-alert-chain`;
  const draftChainId = `${trialId}-demo-draft-chain`;
  const asIso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60_000).toISOString();

  const chains: EmailChain[] = [
    {
      id: messengerChainId,
      inboxId: `demo-inbox-${trialId}`,
      subject: "Messenger",
      folder: "inbox",
      aiLabels: ["action_required", "protocol_clarification"],
      aiPriority: "high",
      aiSummary: "Frontdesk asks for next patient visit details and raises an issue with patient X.",
      aiSuggestedThreadId: null,
      linkedThreadId: null,
      fromAddress: "frontdesk.ch@site17.example",
      fromName: "Frontdesk CH",
      toAddresses: ["frontdesk.ch@site17.example", "principal.investigator@site17.example"],
      ccAddresses: ["superadmin@azorg.be"],
      messageCount: 4,
      isRead: false,
      isStarred: true,
      createdAt: asIso(13 * 24 * 60),
      updatedAt: asIso(12 * 24 * 60 + 30),
    },
    {
      id: labAlertChainId,
      inboxId: `demo-inbox-${trialId}`,
      subject: "Lab excursion notification",
      folder: "inbox",
      aiLabels: ["lab_alert", "safety_report", "urgent"],
      aiPriority: "high",
      aiSummary: "Central lab flagged a temperature excursion on Sample Kit Batch L-220.",
      aiSuggestedThreadId: null,
      linkedThreadId: null,
      fromAddress: "alerts@central-lab.example",
      fromName: "Central Lab",
      toAddresses: [inboxEmail],
      ccAddresses: ["qa@site17.example"],
      messageCount: 1,
      isRead: false,
      isStarred: false,
      createdAt: asIso(7 * 24 * 60),
      updatedAt: asIso(7 * 24 * 60 - 10),
    },
    {
      id: draftChainId,
      inboxId: `demo-inbox-${trialId}`,
      subject: "Re: Messenger",
      folder: "drafts",
      aiLabels: ["draft"],
      aiPriority: "medium",
      aiSummary: "AI draft prepared for Frontdesk follow-up.",
      aiSuggestedThreadId: null,
      linkedThreadId: null,
      fromAddress: inboxEmail,
      fromName: "Susan Johnson",
      toAddresses: ["frontdesk.ch@site17.example"],
      ccAddresses: ["principal.investigator@site17.example"],
      messageCount: 1,
      isRead: true,
      isStarred: false,
      createdAt: asIso(240),
      updatedAt: asIso(35),
    },
  ];

  const messagesByChain: Record<string, CollaborationMessage[]> = {
    [messengerChainId]: [
      {
        id: `${messengerChainId}-msg-1`,
        conversationId: null,
        threadId: null,
        emailChainId: messengerChainId,
        senderId: null,
        senderType: "email_external",
        senderName: "Frontdesk CH",
        senderEmail: "frontdesk.ch@site17.example",
        content: "Setup",
        contentType: "email",
        embeddedContent: {
          attachments: [
            { name: "Visit3_BloodWindow.pdf", size: "1.8 MB", type: "pdf" },
            { name: "Site17_Onboarding.fig", size: "824 KB", type: "design" },
          ],
        },
        isAiGenerated: false,
        aiModel: null,
        aiLatencyMs: null,
        editedAt: null,
        createdAt: asIso(13 * 24 * 60),
      },
      {
        id: `${messengerChainId}-msg-2`,
        conversationId: null,
        threadId: null,
        emailChainId: messengerChainId,
        senderId: null,
        senderType: "email_external",
        senderName: "Principal Investigator",
        senderEmail: "principal.investigator@site17.example",
        content: "What is the next patient visit?",
        contentType: "email",
        embeddedContent: null,
        isAiGenerated: false,
        aiModel: null,
        aiLatencyMs: null,
        editedAt: null,
        createdAt: asIso(13 * 24 * 60 - 79),
      },
      {
        id: `${messengerChainId}-msg-3`,
        conversationId: null,
        threadId: null,
        emailChainId: messengerChainId,
        senderId: null,
        senderType: "email_external",
        senderName: "Principal Investigator",
        senderEmail: "principal.investigator@site17.example",
        content: "I have an issue with patient X.",
        contentType: "email",
        embeddedContent: null,
        isAiGenerated: false,
        aiModel: null,
        aiLatencyMs: null,
        editedAt: null,
        createdAt: asIso(13 * 24 * 60 - 70),
      },
      {
        id: `${messengerChainId}-msg-4`,
        conversationId: null,
        threadId: null,
        emailChainId: messengerChainId,
        senderId: null,
        senderType: "email_external",
        senderName: "Principal Investigator",
        senderEmail: "principal.investigator@site17.example",
        content: "What is my visit window for Subject 018?",
        contentType: "email",
        embeddedContent: null,
        isAiGenerated: false,
        aiModel: null,
        aiLatencyMs: null,
        editedAt: null,
        createdAt: asIso(12 * 24 * 60 + 30),
      },
    ],
    [labAlertChainId]: [
      {
        id: `${labAlertChainId}-msg-1`,
        conversationId: null,
        threadId: null,
        emailChainId: labAlertChainId,
        senderId: null,
        senderType: "email_external",
        senderName: "Central Lab",
        senderEmail: "alerts@central-lab.example",
        content:
          "Temperature excursion detected for Batch L-220 at 14:03 UTC. Please confirm whether recollection is required.",
        contentType: "email",
        embeddedContent: {
          attachments: [{ name: "Batch_L220_Excursion_Report.pdf", size: "642 KB", type: "pdf" }],
        },
        isAiGenerated: false,
        aiModel: null,
        aiLatencyMs: null,
        editedAt: null,
        createdAt: asIso(7 * 24 * 60 - 10),
      },
    ],
    [draftChainId]: [
      {
        id: `${draftChainId}-msg-1`,
        conversationId: null,
        threadId: null,
        emailChainId: draftChainId,
        senderId: null,
        senderType: "ai",
        senderName: "Themison AI",
        senderEmail: null,
        content:
          "Draft ready: Visit window for Subject 018 is +/-2 hours around scheduled time per Protocol Section 5.5.3.",
        contentType: "email",
        embeddedContent: {
          type: "ai_response",
          sources: [
            {
              document_id: "protocol-main",
              document_name: "Protocol DN-2024-01",
              section_ref: "Section 5.5.3",
              quoted_text:
                "Visit 3 blood samples must be collected within a +/-2 hour window from scheduled collection time.",
              page_number: 64,
            },
          ],
          confidence: 0.9,
          query_intent: "email_draft",
          suggested_actions: [],
        },
        isAiGenerated: true,
        aiModel: "gpt-4-turbo",
        aiLatencyMs: 530,
        editedAt: null,
        createdAt: asIso(12),
      },
    ],
  };

  return { chains, messagesByChain };
}

function loadOrInitDemoDataset(trialId: string, inboxEmail: string): LocalDemoInboxDataset {
  if (typeof window === "undefined") {
    return buildDefaultDemoDataset(trialId, inboxEmail);
  }

  const key = getDemoStorageKey(trialId);
  const existing = parseDemoDataset(window.localStorage.getItem(key));
  if (existing) return existing;

  const created = buildDefaultDemoDataset(trialId, inboxEmail);
  window.localStorage.setItem(key, JSON.stringify(created));
  return created;
}

function isLikelyDemoConversationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed query|unknown column|doesn't exist|conversation|messages|participants|collaboration/i.test(
    message.toLowerCase()
  );
}

function getConversationDemoStorageKey(trialId: string) {
  return `${LOCAL_DEMO_CONVERSATION_PREFIX}:${trialId}`;
}

function parseConversationDemoDataset(raw: string | null): LocalDemoConversationDataset | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalDemoConversationDataset;
    if (!parsed || !Array.isArray(parsed.conversations) || typeof parsed.messagesByConversation !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildConversationScript(
  member: DemoTeamMemberSeed,
  selfFirstName: string,
  memberFirstName: string
) {
  const role = member.role.toLowerCase();

  if (role.includes("regulatory")) {
    return {
      memberOpen: `${selfFirstName}, IRB acknowledged amendment package v3. Do you want me to circulate the signed letter now?`,
      selfReply: `Yes, send it to all site leads and log it under today's regulatory update.`,
      memberClose: "Done. Distribution sent and tracker updated.",
    };
  }

  if (role.includes("data")) {
    return {
      memberOpen: `${selfFirstName}, query backlog for Site 14 is down to 6 items. Should we close the monitoring action once the last two are confirmed?`,
      selfReply: "Close it after you post the final confirmation and attach the query export.",
      memberClose: `Will do. I will send you the closeout note in 20 minutes.`,
    };
  }

  if (role.includes("nurse")) {
    return {
      memberOpen: `${selfFirstName}, Subject 021 can only do the follow-up visit at 14:30 tomorrow. Is that still within protocol timing?`,
      selfReply: "Yes, that slot works. Please keep labs and vitals in the same visit block.",
      memberClose: `Great, I will confirm with the site and update the visit board.`,
    };
  }

  if (role.includes("lab")) {
    return {
      memberOpen: `${selfFirstName}, central lab confirmed replacement kits for the damaged shipment. Do you want me to release them to Copenhagen and Berlin now?`,
      selfReply: "Yes, release both and add the courier tracking numbers in the ops thread.",
      memberClose: "Done. Both shipments are booked for tomorrow morning pickup.",
    };
  }

  if (role.includes("safety") || role.includes("pharmacovigilance")) {
    return {
      memberOpen: `${selfFirstName}, I drafted the SAE follow-up narrative for Subject 008. Can you review before sponsor submission?`,
      selfReply: "Looks good from my side. Submit to sponsor and copy QA.",
      memberClose: "Submitted. I added the final PDF in Safety Documents.",
    };
  }

  if (role.includes("quality")) {
    return {
      memberOpen: `${selfFirstName}, QA finished CAPA review for Site 21. One training action remains open until Friday.`,
      selfReply: "Perfect. Keep CAPA open until training completion is signed off.",
      memberClose: "Understood. I will close it right after completion evidence is uploaded.",
    };
  }

  if (role.includes("site") || role.includes("coordinator") || role.includes("operations") || role.includes("crc")) {
    return {
      memberOpen: `${selfFirstName}, Site 17 asked for a quick clarification on Visit 3 timing before tomorrow's patient slot.`,
      selfReply: "Tell them it remains strict plus/minus 2 hours and ask them to note any exception reasons.",
      memberClose: `${memberFirstName} acknowledged. I will post the same note in the coordinator channel.`,
    };
  }

  return {
    memberOpen: `${selfFirstName}, can I send today's trial status recap to the broader team now?`,
    selfReply: "Yes, send it and include the enrollment and protocol-risk highlights.",
    memberClose: "Sent. I added your comments in the summary section.",
  };
}

function buildDefaultConversationDataset(trialId: string): LocalDemoConversationDataset {
  const runtimeUser = getRuntimeUserIdentity();
  const selfId = runtimeUser.id;
  const selfName = runtimeUser.name;
  const selfEmail = runtimeUser.email;
  const selfFirstName = selfName.trim().split(/\s+/)[0] || selfName;
  const seedMembers = getSeedMembers(runtimeUser).slice(0, 8);
  const memberSignature = getConversationMemberSignature(runtimeUser, seedMembers);
  const now = Date.now();
  const asIso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60_000).toISOString();

  const makeParticipant = (
    conversationId: string,
    userId: number,
    name: string,
    email: string
  ): NonNullable<Conversation["participants"]>[number] => ({
    id: `${conversationId}-participant-${userId}`,
    conversationId,
    userId,
    joinedAt: asIso(22 * 24 * 60),
    lastReadAt: null,
    user: {
      id: userId,
      name,
      email,
    },
  });

  const makeMessage = ({
    id,
    conversationId,
    senderId,
    senderType,
    senderName,
    content,
    createdAt,
    contentType = "text",
    embeddedContent = null,
    isAiGenerated = false,
    aiModel = null,
    aiLatencyMs = null,
  }: {
    id: string;
    conversationId: string;
    senderId: number | null;
    senderType: CollaborationMessage["senderType"];
    senderName: string;
    content: string;
    createdAt: string;
    contentType?: CollaborationMessage["contentType"];
    embeddedContent?: Record<string, unknown> | null;
    isAiGenerated?: boolean;
    aiModel?: string | null;
    aiLatencyMs?: number | null;
  }): CollaborationMessage => ({
    id,
    conversationId,
    threadId: null,
    emailChainId: null,
    senderId,
    senderType,
    senderName,
    senderEmail: null,
    content,
    contentType,
    embeddedContent,
    isAiGenerated,
    aiModel,
    aiLatencyMs,
    editedAt: null,
    createdAt,
  });

  const conversations: Conversation[] = [];
  const messagesByConversation: Record<string, CollaborationMessage[]> = {};

  seedMembers.forEach((member, index) => {
    const memberFirstName = member.name.trim().split(/\s+/)[0] || member.name;
    const conversationId = `${trialId}-dm-${toSlug(member.name)}-${index + 1}`;
    const memberUserId = getStableMemberUserId(member.id, index + 1, selfId);
    const script = buildConversationScript(member, selfFirstName, memberFirstName);
    const latestOffset = 6 + index * 9;

    const messages = [
      makeMessage({
        id: `${conversationId}-m1`,
        conversationId,
        senderId: memberUserId,
        senderType: "user",
        senderName: member.name,
        content: script.memberOpen,
        createdAt: asIso(latestOffset + 11),
      }),
      makeMessage({
        id: `${conversationId}-m2`,
        conversationId,
        senderId: selfId,
        senderType: "user",
        senderName: selfName,
        content: script.selfReply,
        createdAt: asIso(latestOffset + 6),
      }),
      makeMessage({
        id: `${conversationId}-m3`,
        conversationId,
        senderId: memberUserId,
        senderType: "user",
        senderName: member.name,
        content: script.memberClose,
        createdAt: asIso(latestOffset),
      }),
    ];

    messagesByConversation[conversationId] = messages;

    const lastMessage = messages[messages.length - 1];
    conversations.push({
      id: conversationId,
      trialId,
      type: "direct",
      name: null,
      createdBy: selfId,
      createdAt: asIso((24 + index) * 60),
      updatedAt: lastMessage.createdAt,
      unreadCount: index < 4 ? Math.max(1, 4 - index) : 0,
      participants: [
        makeParticipant(conversationId, selfId, selfName, selfEmail),
        makeParticipant(conversationId, memberUserId, member.name, member.email),
      ],
      lastMessage,
    });
  });

  conversations.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

  return {
    seedVersion: CONVERSATION_DEMO_SEED_VERSION,
    memberSignature,
    conversations,
    messagesByConversation,
  };
}

function loadOrInitConversationDataset(trialId: string): LocalDemoConversationDataset {
  if (typeof window === "undefined") {
    return buildDefaultConversationDataset(trialId);
  }

  const key = getConversationDemoStorageKey(trialId);
  const runtimeUser = getRuntimeUserIdentity();
  const expectedSignature = getConversationMemberSignature(runtimeUser, getSeedMembers(runtimeUser).slice(0, 8));
  const existing = parseConversationDemoDataset(window.localStorage.getItem(key));
  if (
    existing &&
    existing.seedVersion === CONVERSATION_DEMO_SEED_VERSION &&
    existing.memberSignature === expectedSignature
  ) {
    return existing;
  }

  const created = buildDefaultConversationDataset(trialId);
  window.localStorage.setItem(key, JSON.stringify(created));
  return created;
}

function saveConversationDemoDataset(trialId: string, dataset: LocalDemoConversationDataset) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getConversationDemoStorageKey(trialId), JSON.stringify(dataset));
}

function appendConversationDemoMessage(
  trialId: string,
  conversationId: string,
  message: CollaborationMessage
): LocalDemoConversationDataset {
  const dataset = loadOrInitConversationDataset(trialId);
  const current = dataset.messagesByConversation[conversationId] || [];
  const nextMessages = [...current, message];

  dataset.messagesByConversation = {
    ...dataset.messagesByConversation,
    [conversationId]: nextMessages,
  };

  dataset.conversations = dataset.conversations.map((conversation) =>
    conversation.id === conversationId
      ? {
          ...conversation,
          lastMessage: message,
          updatedAt: message.createdAt,
        }
      : conversation
  );

  saveConversationDemoDataset(trialId, dataset);
  return dataset;
}

function getOtherParticipantFromConversation(
  conversation: Conversation,
  runtimeUserId: number
) {
  const participants = conversation.participants || [];
  return participants.find((participant) => participant.userId !== runtimeUserId) || participants[0] || null;
}

function findConversationForMember(
  conversations: Conversation[],
  runtimeUserId: number,
  member: DirectConversationMemberInput
) {
  const targetName = normalizeName(member.name);
  const targetEmail = normalizeDemoMemberEmail(member.email).toLowerCase();
  return conversations.find((conversation) => {
    if (conversation.type !== "direct") return false;
    const other = getOtherParticipantFromConversation(conversation, runtimeUserId);
    if (!other) return false;
    const otherName = normalizeName(other.user?.name || "");
    const otherEmail = normalizeDemoMemberEmail(other.user?.email || "").toLowerCase();
    if (targetEmail && otherEmail === targetEmail) return true;
    if (targetName && otherName === targetName) return true;
    return false;
  });
}

function isLocalConversationId(value: string) {
  return value.startsWith("local-");
}

function createOrGetLocalDirectConversation(
  trialId: string,
  member: DirectConversationMemberInput
): Conversation {
  const runtimeUser = getRuntimeUserIdentity();
  const dataset = loadOrInitConversationDataset(trialId);
  const existing = findConversationForMember(dataset.conversations, runtimeUser.id, member);
  if (existing) return existing;

  const memberName = member.name.trim() || "Team Member";
  const memberEmail =
    normalizeDemoMemberEmail(member.email || "").trim() ||
    `${memberName.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\.|\.$)/g, "")}@azorg.be`;
  const selfId = runtimeUser.id;
  const selfName = runtimeUser.name;
  const selfEmail = runtimeUser.email;
  const memberUserId = getStableMemberUserId(member.id || memberEmail, dataset.conversations.length + 1, selfId);
  const createdAt = new Date().toISOString();
  const conversationId = `local-${trialId}-dm-${toSlug(memberName)}-${Date.now().toString(36)}`;

  const created: Conversation = {
    id: conversationId,
    trialId,
    type: "direct",
    name: null,
    createdBy: selfId,
    createdAt,
    updatedAt: createdAt,
    unreadCount: 0,
    lastMessage: null,
    participants: [
      {
        id: `${conversationId}-participant-${selfId}`,
        conversationId,
        userId: selfId,
        joinedAt: createdAt,
        lastReadAt: null,
        user: {
          id: selfId,
          name: selfName,
          email: selfEmail,
        },
      },
      {
        id: `${conversationId}-participant-${memberUserId}`,
        conversationId,
        userId: memberUserId,
        joinedAt: createdAt,
        lastReadAt: null,
        user: {
          id: memberUserId,
          name: memberName,
          email: memberEmail,
        },
      },
    ],
  };

  dataset.conversations = [created, ...dataset.conversations].sort(
    (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)
  );
  dataset.messagesByConversation = {
    ...dataset.messagesByConversation,
    [conversationId]: [],
  };
  saveConversationDemoDataset(trialId, dataset);
  return created;
}

function getThreadDemoStorageKey(trialId: string) {
  return `${LOCAL_DEMO_THREAD_PREFIX}:${trialId}`;
}

function parseThreadDemoDataset(raw: string | null): LocalDemoThreadDataset | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalDemoThreadDataset;
    if (!parsed || !Array.isArray(parsed.threads) || typeof parsed.messagesByThread !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function hasRequiredThreadDemoData(dataset: LocalDemoThreadDataset) {
  const hasQuestionThread = dataset.threads.some((thread) => thread.category === "question");
  return hasQuestionThread;
}

function getThreadMemberSignature(
  runtimeUser: ReturnType<typeof getRuntimeUserIdentity>,
  members: DemoTeamMemberSeed[]
) {
  return `${THREAD_DEMO_SEED_VERSION}|${getConversationMemberSignature(runtimeUser, members)}`;
}

function buildDefaultThreadDataset(trialId: string): LocalDemoThreadDataset {
  const runtimeUser = getRuntimeUserIdentity();
  const selfId = runtimeUser.id;
  const selfName = runtimeUser.name;
  const selfEmail = runtimeUser.email;
  const seedMembers = getSeedMembers(runtimeUser).slice(0, 6);
  const memberSignature = getThreadMemberSignature(runtimeUser, seedMembers);
  const now = Date.now();
  const asIso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60_000).toISOString();

  const memberAt = (index: number) => seedMembers[index % seedMembers.length];

  const first = memberAt(0);
  const second = memberAt(1);
  const third = memberAt(2);
  const fourth = memberAt(3);
  const fifth = memberAt(4);

  const toMemberUserId = (member: DemoTeamMemberSeed, index: number) =>
    getStableMemberUserId(member.id, 400 + index, selfId);

  const firstId = toMemberUserId(first, 1);
  const secondId = toMemberUserId(second, 2);
  const thirdId = toMemberUserId(third, 3);
  const fourthId = toMemberUserId(fourth, 4);
  const fifthId = toMemberUserId(fifth, 5);

  const makeMessage = ({
    id,
    threadId,
    senderId,
    senderName,
    senderEmail,
    content,
    createdAt,
    contentType = "text",
    embeddedContent = null,
  }: {
    id: string;
    threadId: string;
    senderId: number | null;
    senderName: string;
    senderEmail: string | null;
    content: string;
    createdAt: string;
    contentType?: CollaborationMessage["contentType"];
    embeddedContent?: Record<string, unknown> | null;
  }): CollaborationMessage => ({
    id,
    conversationId: null,
    threadId,
    emailChainId: null,
    senderId,
    senderType: "user",
    senderName,
    senderEmail,
    content,
    contentType,
    embeddedContent,
    isAiGenerated: false,
    aiModel: null,
    aiLatencyMs: null,
    editedAt: null,
    createdAt,
  });

  const makeParticipant = (
    threadId: string,
    userId: number,
    suffix: string,
    name: string,
    email: string
  ) => ({
    id: `${threadId}-participant-${suffix}`,
    threadId,
    userId,
    joinedAt: asIso(3 * 24 * 60),
    lastReadAt: null,
    user: {
      id: userId,
      name,
      email,
    },
  });

  const buildParticipants = (
    threadId: string,
    seeds: Array<{ userId: number; suffix: string; name: string; email: string }>
  ) => {
    const participants: ReturnType<typeof makeParticipant>[] = [];
    const seen = new Set<number>();
    seeds.forEach((seed) => {
      if (seen.has(seed.userId)) return;
      seen.add(seed.userId);
      participants.push(makeParticipant(threadId, seed.userId, seed.suffix, seed.name, seed.email));
    });
    return participants;
  };

  const makeAnchor = (
    threadId: string,
    suffix: string,
    anchorType: "document_section" | "task" | "visit" | "trial_wide" | "therapeutic_area" | "team_member",
    anchorLabel: string
  ) => ({
    id: `${threadId}-anchor-${suffix}`,
    threadId,
    anchorType,
    anchorLabel,
    anchorRefId: null,
    anchorRefType: null,
    createdAt: asIso(3 * 24 * 60),
  });

  const threadOneId = `${trialId}-thread-v3-lab-window`;
  const threadOneMessages: CollaborationMessage[] = [
    makeMessage({
      id: `${threadOneId}-m1`,
      threadId: threadOneId,
      senderId: firstId,
      senderName: first.name,
      senderEmail: first.email,
      content: `@${selfName} Site Copenhagen asked if tomorrow's Visit 3 blood draw can move 90 minutes later due courier pickup.`,
      createdAt: asIso(310),
    }),
    makeMessage({
      id: `${threadOneId}-m2`,
      threadId: threadOneId,
      senderId: selfId,
      senderName: selfName,
      senderEmail: selfEmail,
      content: `@${first.name} thanks. @${second.name}, can you confirm courier and lab intake cut-off from ops?`,
      createdAt: asIso(304),
    }),
    makeMessage({
      id: `${threadOneId}-m3`,
      threadId: threadOneId,
      senderId: secondId,
      senderName: second.name,
      senderEmail: second.email,
      content: "Confirmed. Intake cut-off is 16:30 local, so the +90 minute shift is still feasible.",
      createdAt: asIso(302),
    }),
    makeMessage({
      id: `${threadOneId}-m4`,
      threadId: threadOneId,
      senderId: selfId,
      senderName: selfName,
      senderEmail: selfEmail,
      content: "Adding the protocol section:",
      createdAt: asIso(300),
      contentType: "protocol_snippet",
      embeddedContent: {
        document_name: "Protocol DN-2024-01",
        section_ref: "Section 5.5.3",
        quoted_text:
          "At Visit 3, blood sampling must be completed within a strict +/-2 hour window from scheduled time.",
        document_link: "#",
      },
    }),
    makeMessage({
      id: `${threadOneId}-m5`,
      threadId: threadOneId,
      senderId: selfId,
      senderName: selfName,
      senderEmail: selfEmail,
      content: "And here is the matching SoA row:",
      createdAt: asIso(299),
      contentType: "protocol_snippet",
      embeddedContent: {
        document_name: "Schedule of Activities (SoA)",
        section_ref: "Visit 3 — Labs & Safety Assessments",
        quoted_text:
          "Visit 3: Collect PK sample within a +/-2 hour window from scheduled time, with vitals performed in the same visit block.",
        document_link: "#",
      },
    }),
    makeMessage({
      id: `${threadOneId}-m6`,
      threadId: threadOneId,
      senderId: firstId,
      senderName: first.name,
      senderEmail: first.email,
      content: `Perfect. @${second.name} and I posted this in the site channel and updated tomorrow's run sheet.`,
      createdAt: asIso(294),
    }),
  ];

  const threadTwoId = `${trialId}-thread-consent-language`;
  const threadTwoMessages: CollaborationMessage[] = [
    makeMessage({
      id: `${threadTwoId}-m1`,
      threadId: threadTwoId,
      senderId: secondId,
      senderName: second.name,
      senderEmail: second.email,
      content:
        "The Dutch consent packet at Site Leuven still references v2 footer text while the main body is v3.",
      createdAt: asIso(255),
    }),
    makeMessage({
      id: `${threadTwoId}-m2`,
      threadId: threadTwoId,
      senderId: selfId,
      senderName: selfName,
      senderEmail: selfEmail,
      content: `Good catch. @${third.name}, can you confirm IRB packet footer language before we reopen enrollment?`,
      createdAt: asIso(248),
    }),
    makeMessage({
      id: `${threadTwoId}-m3`,
      threadId: threadTwoId,
      senderId: thirdId,
      senderName: third.name,
      senderEmail: third.email,
      content: "Confirmed. Footer is still v2 in the Dutch packet. We should publish corrected files today.",
      createdAt: asIso(247),
    }),
    makeMessage({
      id: `${threadTwoId}-m4`,
      threadId: threadTwoId,
      senderId: selfId,
      senderName: selfName,
      senderEmail: selfEmail,
      content: "Task created for regulatory follow-up.",
      createdAt: asIso(246),
      contentType: "task_card",
      embeddedContent: {
        title: "Upload corrected Dutch consent packet and document acknowledgment",
        assignee_name: third.name,
        due_date: "Today 5:00 PM",
        status: "Open",
      },
    }),
    makeMessage({
      id: `${threadTwoId}-m5`,
      threadId: threadTwoId,
      senderId: secondId,
      senderName: second.name,
      senderEmail: second.email,
      content: `Understood. @${third.name} and I will share the corrected packet within the hour.`,
      createdAt: asIso(240),
    }),
  ];

  const threadThreeId = `${trialId}-thread-freezer-loggers`;
  const threadThreeMessages: CollaborationMessage[] = [
    makeMessage({
      id: `${threadThreeId}-m1`,
      threadId: threadThreeId,
      senderId: thirdId,
      senderName: third.name,
      senderEmail: third.email,
      content:
        "Two freezer logger kits were damaged in transit for Site Ghent. We have only one backup left onsite.",
      createdAt: asIso(205),
    }),
    makeMessage({
      id: `${threadThreeId}-m2`,
      threadId: threadThreeId,
      senderId: selfId,
      senderName: selfName,
      senderEmail: selfEmail,
      content: `@${third.name} ship replacements today and prioritize Ghent first. @${fourth.name}, please add courier tracking and ETA here.`,
      createdAt: asIso(198),
    }),
    makeMessage({
      id: `${threadThreeId}-m3`,
      threadId: threadThreeId,
      senderId: fourthId,
      senderName: fourth.name,
      senderEmail: fourth.email,
      content: "Booked same-day pickup. Tracking IDs will be posted in 20 minutes.",
      createdAt: asIso(192),
    }),
    makeMessage({
      id: `${threadThreeId}-m4`,
      threadId: threadThreeId,
      senderId: thirdId,
      senderName: third.name,
      senderEmail: third.email,
      content: "Replacement kits packed and handed over to courier.",
      createdAt: asIso(188),
    }),
  ];

  const threadFourId = `${trialId}-thread-weekend-nursing-approval`;
  const threadFourMessages: CollaborationMessage[] = [
    makeMessage({
      id: `${threadFourId}-m1`,
      threadId: threadFourId,
      senderId: fourthId,
      senderName: fourth.name,
      senderEmail: fourth.email,
      content:
        "Can we approve one additional nurse block for Saturday? We have 3 rescheduled infusion visits.",
      createdAt: asIso(160),
    }),
    makeMessage({
      id: `${threadFourId}-m2`,
      threadId: threadFourId,
      senderId: selfId,
      senderName: selfName,
      senderEmail: selfEmail,
      content: `Approved for this weekend only. @${fifth.name}, please update the staffing plan and confirm coverage by noon.`,
      createdAt: asIso(152),
    }),
    makeMessage({
      id: `${threadFourId}-m3`,
      threadId: threadFourId,
      senderId: fifthId,
      senderName: fifth.name,
      senderEmail: fifth.email,
      content: "Staffing plan updated. Coverage confirmed for Saturday morning and afternoon blocks.",
      createdAt: asIso(146),
    }),
    makeMessage({
      id: `${threadFourId}-m4`,
      threadId: threadFourId,
      senderId: fourthId,
      senderName: fourth.name,
      senderEmail: fourth.email,
      content: "Great, nurse roster shared with site managers.",
      createdAt: asIso(143),
    }),
  ];

  const threadFiveId = `${trialId}-thread-lab-order-clarification`;
  const threadFiveMessages: CollaborationMessage[] = [
    makeMessage({
      id: `${threadFiveId}-m1`,
      threadId: threadFiveId,
      senderId: fifthId,
      senderName: fifth.name,
      senderEmail: fifth.email,
      content:
        "For Visit 5 in oncology cohort B, should CBC be collected before ECG or after? Site manual and SoA order differ.",
      createdAt: asIso(120),
    }),
    makeMessage({
      id: `${threadFiveId}-m2`,
      threadId: threadFiveId,
      senderId: selfId,
      senderName: selfName,
      senderEmail: selfEmail,
      content: `Use protocol order: CBC first, then ECG. @${first.name}, please confirm both protocol and SoA wording so we align the site manual today.`,
      createdAt: asIso(112),
    }),
    makeMessage({
      id: `${threadFiveId}-m3`,
      threadId: threadFiveId,
      senderId: selfId,
      senderName: selfName,
      senderEmail: selfEmail,
      content: "Protocol reference:",
      createdAt: asIso(110),
      contentType: "protocol_snippet",
      embeddedContent: {
        document_name: "Protocol DN-2024-01",
        section_ref: "Section 6.2.1 — Visit 5 Assessments",
        quoted_text:
          "At Visit 5, collect CBC before ECG to preserve pre-assessment lab timing and interpretation consistency.",
        document_link: "#",
      },
    }),
    makeMessage({
      id: `${threadFiveId}-m4`,
      threadId: threadFiveId,
      senderId: firstId,
      senderName: first.name,
      senderEmail: first.email,
      content: "SoA confirms the same sequence. Sharing the exact row:",
      createdAt: asIso(109),
      contentType: "protocol_snippet",
      embeddedContent: {
        document_name: "Schedule of Activities (SoA)",
        section_ref: "Visit 5 — Hematology & Cardiac Monitoring",
        quoted_text:
          "Order of procedures: CBC draw first, then ECG, then AE review for oncology cohort B.",
        document_link: "#",
      },
    }),
    makeMessage({
      id: `${threadFiveId}-m5`,
      threadId: threadFiveId,
      senderId: fifthId,
      senderName: fifth.name,
      senderEmail: fifth.email,
      content: "Perfect. I will update the site-facing manual note now.",
      createdAt: asIso(106),
    }),
  ];

  const threadSixId = `${trialId}-thread-visit2-ecg-window-question`;
  const threadSixMessages: CollaborationMessage[] = [
    makeMessage({
      id: `${threadSixId}-m1`,
      threadId: threadSixId,
      senderId: secondId,
      senderName: second.name,
      senderEmail: second.email,
      content: `@${selfName} quick question: Site Antwerp can only run ECG about 30 minutes after predose labs tomorrow for Visit 2. Is that acceptable?`,
      createdAt: asIso(96),
    }),
    makeMessage({
      id: `${threadSixId}-m2`,
      threadId: threadSixId,
      senderId: selfId,
      senderName: selfName,
      senderEmail: selfEmail,
      content: `@${second.name} yes, as long as ECG remains within the protocol predose assessment window. @${first.name}, can you drop the exact references?`,
      createdAt: asIso(90),
    }),
    makeMessage({
      id: `${threadSixId}-m3`,
      threadId: threadSixId,
      senderId: firstId,
      senderName: first.name,
      senderEmail: first.email,
      content: "Protocol reference:",
      createdAt: asIso(88),
      contentType: "protocol_snippet",
      embeddedContent: {
        document_name: "Protocol DN-2024-01",
        section_ref: "Section 7.1 — Predose Assessments",
        quoted_text:
          "Predose procedures at Visit 2 may be completed in sequence within a 60-minute operational window before dosing, provided ordering is documented.",
        document_link: "#",
      },
    }),
    makeMessage({
      id: `${threadSixId}-m4`,
      threadId: threadSixId,
      senderId: firstId,
      senderName: first.name,
      senderEmail: first.email,
      content: "SoA reference:",
      createdAt: asIso(87),
      contentType: "protocol_snippet",
      embeddedContent: {
        document_name: "Schedule of Activities (SoA)",
        section_ref: "Visit 2 — Predose Procedures",
        quoted_text:
          "Visit 2 order: predose labs followed by ECG within the same predose window; site must record actual timestamps for both.",
        document_link: "#",
      },
    }),
    makeMessage({
      id: `${threadSixId}-m5`,
      threadId: threadSixId,
      senderId: secondId,
      senderName: second.name,
      senderEmail: second.email,
      content: "Perfect, thanks. I will confirm this sequence with Antwerp and log the timestamps.",
      createdAt: asIso(82),
    }),
  ];

  const messagesByThread: Record<string, CollaborationMessage[]> = {
    [threadOneId]: threadOneMessages,
    [threadTwoId]: threadTwoMessages,
    [threadThreeId]: threadThreeMessages,
    [threadFourId]: threadFourMessages,
    [threadFiveId]: threadFiveMessages,
    [threadSixId]: threadSixMessages,
  };

  const latest = (rows: CollaborationMessage[]) => rows[rows.length - 1]?.createdAt || asIso(0);

  const threads: TrialThread[] = [
    {
      id: threadOneId,
      trialId,
      title: "Visit 3 lab timing clarification for Copenhagen",
      category: "decision",
      status: "resolved",
      resolvedBy: selfId,
      resolvedAt: latest(threadOneMessages),
      resolutionSummary: "Confirmed that sample timing remains within a strict +/-2 hour window with reason logged.",
      aiContributed: false,
      aiResolutionSuggested: false,
      createdBy: selfId,
      createdAt: asIso(320),
      updatedAt: latest(threadOneMessages),
      anchors: [
        makeAnchor(threadOneId, "1", "visit", "Visit 3"),
        makeAnchor(threadOneId, "2", "document_section", "Protocol 5.5.3"),
      ],
      participants: buildParticipants(threadOneId, [
        { userId: selfId, suffix: "self", name: selfName, email: selfEmail },
        { userId: firstId, suffix: "m1", name: first.name, email: first.email },
        { userId: secondId, suffix: "m2", name: second.name, email: second.email },
      ]),
      replyCount: threadOneMessages.length,
    },
    {
      id: threadTwoId,
      trialId,
      title: "Consent form version mismatch (Leuven)",
      category: "issue",
      status: "pending",
      resolvedBy: null,
      resolvedAt: null,
      resolutionSummary: null,
      aiContributed: false,
      aiResolutionSuggested: false,
      createdBy: selfId,
      createdAt: asIso(266),
      updatedAt: latest(threadTwoMessages),
      anchors: [
        makeAnchor(threadTwoId, "1", "trial_wide", "Trial-wide"),
        makeAnchor(threadTwoId, "2", "task", "Regulatory follow-up"),
      ],
      participants: buildParticipants(threadTwoId, [
        { userId: selfId, suffix: "self", name: selfName, email: selfEmail },
        { userId: secondId, suffix: "m1", name: second.name, email: second.email },
        { userId: thirdId, suffix: "m2", name: third.name, email: third.email },
      ]),
      replyCount: threadTwoMessages.length,
    },
    {
      id: threadThreeId,
      trialId,
      title: "Re-ship freezer logger kits to Ghent",
      category: "action_required",
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      resolutionSummary: null,
      aiContributed: false,
      aiResolutionSuggested: false,
      createdBy: selfId,
      createdAt: asIso(214),
      updatedAt: latest(threadThreeMessages),
      anchors: [
        makeAnchor(threadThreeId, "1", "task", "Cold-chain logistics"),
        makeAnchor(threadThreeId, "2", "visit", "Visit 2"),
      ],
      participants: buildParticipants(threadThreeId, [
        { userId: selfId, suffix: "self", name: selfName, email: selfEmail },
        { userId: thirdId, suffix: "m1", name: third.name, email: third.email },
        { userId: fourthId, suffix: "m2", name: fourth.name, email: fourth.email },
      ]),
      replyCount: threadThreeMessages.length,
    },
    {
      id: threadFourId,
      trialId,
      title: "Budget approval for weekend nursing coverage",
      category: "approval",
      status: "pending",
      resolvedBy: null,
      resolvedAt: null,
      resolutionSummary: null,
      aiContributed: false,
      aiResolutionSuggested: false,
      createdBy: selfId,
      createdAt: asIso(170),
      updatedAt: latest(threadFourMessages),
      anchors: [
        makeAnchor(threadFourId, "1", "trial_wide", "Trial-wide"),
        makeAnchor(threadFourId, "2", "task", "Staffing plan"),
      ],
      participants: buildParticipants(threadFourId, [
        { userId: selfId, suffix: "self", name: selfName, email: selfEmail },
        { userId: fourthId, suffix: "m1", name: fourth.name, email: fourth.email },
        { userId: fifthId, suffix: "m2", name: fifth.name, email: fifth.email },
      ]),
      replyCount: threadFourMessages.length,
    },
    {
      id: threadFiveId,
      trialId,
      title: "Lab order clarification for oncology cohort B",
      category: "clarification",
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      resolutionSummary: null,
      aiContributed: false,
      aiResolutionSuggested: false,
      createdBy: selfId,
      createdAt: asIso(126),
      updatedAt: latest(threadFiveMessages),
      anchors: [
        makeAnchor(threadFiveId, "1", "document_section", "SoA vs Manual"),
        makeAnchor(threadFiveId, "2", "therapeutic_area", "Oncology"),
      ],
      participants: buildParticipants(threadFiveId, [
        { userId: selfId, suffix: "self", name: selfName, email: selfEmail },
        { userId: fifthId, suffix: "m1", name: fifth.name, email: fifth.email },
        { userId: firstId, suffix: "m2", name: first.name, email: first.email },
      ]),
      replyCount: threadFiveMessages.length,
    },
    {
      id: threadSixId,
      trialId,
      title: "Visit 2 ECG timing window question (Antwerp)",
      category: "question",
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      resolutionSummary: null,
      aiContributed: false,
      aiResolutionSuggested: false,
      createdBy: selfId,
      createdAt: asIso(102),
      updatedAt: latest(threadSixMessages),
      anchors: [
        makeAnchor(threadSixId, "1", "visit", "Visit 2"),
        makeAnchor(threadSixId, "2", "document_section", "Predose window"),
      ],
      participants: buildParticipants(threadSixId, [
        { userId: selfId, suffix: "self", name: selfName, email: selfEmail },
        { userId: secondId, suffix: "m1", name: second.name, email: second.email },
        { userId: firstId, suffix: "m2", name: first.name, email: first.email },
      ]),
      replyCount: threadSixMessages.length,
    },
  ];
  threads.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

  return {
    seedVersion: THREAD_DEMO_SEED_VERSION,
    memberSignature,
    threads,
    messagesByThread,
  };
}

function loadOrInitThreadDataset(trialId: string): LocalDemoThreadDataset {
  if (typeof window === "undefined") {
    return buildDefaultThreadDataset(trialId);
  }

  const key = getThreadDemoStorageKey(trialId);
  const runtimeUser = getRuntimeUserIdentity();
  const expectedSignature = getThreadMemberSignature(runtimeUser, getSeedMembers(runtimeUser).slice(0, 6));
  const existing = parseThreadDemoDataset(window.localStorage.getItem(key));
  if (
    existing &&
    existing.seedVersion === THREAD_DEMO_SEED_VERSION &&
    existing.memberSignature === expectedSignature &&
    hasRequiredThreadDemoData(existing)
  ) {
    return existing;
  }

  const created = buildDefaultThreadDataset(trialId);
  window.localStorage.setItem(key, JSON.stringify(created));
  return created;
}

function saveThreadDemoDataset(trialId: string, dataset: LocalDemoThreadDataset) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getThreadDemoStorageKey(trialId), JSON.stringify(dataset));
}

function getChainsForFolder(chains: EmailChain[], folder: InboxFolderView): EmailChain[] {
  if (folder === "unread") return chains.filter((row) => row.folder === "inbox" && !row.isRead);
  if (folder === "inbox" || folder === "sent" || folder === "drafts") {
    return chains.filter((row) => row.folder === folder);
  }
  return chains;
}

const listeners = new Set<() => void>();
let pollTimer: number | null = null;
let subscribedTrialId: string | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

const state: CollaborationStore = {
  dataMode: "sample",
  setDataMode(mode) {
    state.dataMode = mode;
    if (mode === "building") {
      state.conversations = [];
      state.activeConversationId = null;
      state.messages = {};
      state.threads = [];
      state.activeThreadId = null;
      state.threadMessages = {};
      state.emailChains = [];
      state.activeEmailChainId = null;
      state.emailMessages = {};
      state.aiDraft = null;
      state.error = null;
      if (state.inboxConfig) {
        state.inboxConfig = {
          ...state.inboxConfig,
          isActive: false,
        };
      }
    }
    emit();
  },
  activeLayer: "messages",
  setActiveLayer(layer) {
    state.activeLayer = layer;
    emit();
  },

  conversations: [],
  activeConversationId: null,
  messages: {},
  aiIsTyping: false,
  setActiveConversation(conversationId) {
    state.activeConversationId = conversationId;
    emit();
  },
  async loadConversations(trialId) {
    if (state.dataMode === "building") {
      state.conversations = [];
      state.activeConversationId = null;
      state.messages = {};
      state.error = null;
      emit();
      return;
    }
    if (state.dataMode === "sample") {
      state.conversations = loadOrInitConversationDataset(trialId).conversations;
      if (
        state.activeConversationId &&
        !state.conversations.some((conversation) => conversation.id === state.activeConversationId)
      ) {
        state.activeConversationId = state.conversations[0]?.id || null;
      }
      state.error = null;
      emit();
      return;
    }
    state.isLoading = true;
    state.error = null;
    emit();
    try {
      let rows = (await collabApi.listConversations(trialId)) as Conversation[];
      if (rows.length === 0) {
        rows = loadOrInitConversationDataset(trialId).conversations;
      }
      const localOnlyRows = loadOrInitConversationDataset(trialId).conversations.filter((conversation) =>
        isLocalConversationId(String(conversation.id || ""))
      );
      if (localOnlyRows.length) {
        const byId = new Map(rows.map((conversation) => [conversation.id, conversation] as const));
        localOnlyRows.forEach((conversation) => {
          if (!byId.has(conversation.id)) {
            byId.set(conversation.id, conversation);
          }
        });
        rows = Array.from(byId.values()).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      }
      state.conversations = rows;
      if (
        state.activeConversationId &&
        !state.conversations.some((conversation) => conversation.id === state.activeConversationId)
      ) {
        state.activeConversationId = state.conversations[0]?.id || null;
      }
      state.error = null;
    } catch (error) {
      if (isLikelyDemoConversationError(error)) {
        state.conversations = loadOrInitConversationDataset(trialId).conversations;
        state.error = null;
      } else {
        state.error = error instanceof Error ? error.message : "Failed to load conversations";
      }
    } finally {
      state.isLoading = false;
      emit();
    }
  },
  async loadMessages(conversationId) {
    if (state.dataMode === "building") {
      state.messages[conversationId] = [];
      state.error = null;
      emit();
      return;
    }
    if (state.dataMode === "sample") {
      const trialId =
        state.conversations.find((conversation) => conversation.id === conversationId)?.trialId ||
        subscribedTrialId;
      if (trialId) {
        state.messages[conversationId] =
          loadOrInitConversationDataset(trialId).messagesByConversation[conversationId] || [];
      } else {
        state.messages[conversationId] = state.messages[conversationId] || [];
      }
      state.error = null;
      emit();
      return;
    }
    try {
      const localConversation = state.conversations.find(
        (conversation) => conversation.id === conversationId && isLocalConversationId(conversation.id)
      );
      if (localConversation) {
        const localDataset = loadOrInitConversationDataset(localConversation.trialId);
        state.messages[conversationId] = localDataset.messagesByConversation[conversationId] || [];
        state.error = null;
        emit();
        return;
      }

      let rows = (await collabApi.getConversationMessages(conversationId, 120)) as CollaborationMessage[];
      if (!rows.length) {
        const trialId =
          state.conversations.find((conversation) => conversation.id === conversationId)?.trialId ||
          subscribedTrialId;
        if (trialId) {
          rows = loadOrInitConversationDataset(trialId).messagesByConversation[conversationId] || rows;
        }
      }
      state.messages[conversationId] = rows;
      state.error = null;
      emit();
    } catch (error) {
      const trialId =
        state.conversations.find((conversation) => conversation.id === conversationId)?.trialId ||
        subscribedTrialId;
      if (trialId && isLikelyDemoConversationError(error)) {
        state.messages[conversationId] =
          loadOrInitConversationDataset(trialId).messagesByConversation[conversationId] || [];
        state.error = null;
      } else {
        state.error = error instanceof Error ? error.message : "Failed to load messages";
      }
      emit();
    }
  },
  async sendMessage(conversationId, content, embeddedContent, contentType = "text") {
    if (!content.trim()) return;
    const runtimeUser = getRuntimeUserIdentity();
    const selfId = runtimeUser.id;
    const selfName = runtimeUser.name;
    const nowIso = new Date().toISOString();
    const optimistic: CollaborationMessage = {
      id: `tmp-${Date.now()}`,
      conversationId,
      threadId: null,
      emailChainId: null,
      senderId: selfId,
      senderType: "user",
      senderName: selfName,
      senderEmail: null,
      content,
      contentType,
      embeddedContent: embeddedContent ?? null,
      isAiGenerated: false,
      aiModel: null,
      aiLatencyMs: null,
      editedAt: null,
      createdAt: nowIso,
    };

    state.messages[conversationId] = [...(state.messages[conversationId] || []), optimistic];
    state.aiIsTyping = true;
    emit();

    const targetConversation = state.conversations.find((conversation) => conversation.id === conversationId);
    const trialId = targetConversation?.trialId || subscribedTrialId;
    const isLocalConversation = Boolean(targetConversation && isLocalConversationId(targetConversation.id));

    if (state.dataMode === "sample" || isLocalConversation) {
      const persisted: CollaborationMessage = {
        ...optimistic,
        id: `demo-${Date.now()}`,
        createdAt: nowIso,
      };

      if (trialId) {
        const dataset = appendConversationDemoMessage(trialId, conversationId, persisted);
        if (dataset.messagesByConversation[conversationId]) {
          state.messages[conversationId] = dataset.messagesByConversation[conversationId];
        } else {
          state.messages[conversationId] = (state.messages[conversationId] || []).map((message) =>
            message.id === optimistic.id ? persisted : message
          );
        }
        state.conversations = dataset.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                lastMessage: persisted,
                updatedAt: persisted.createdAt,
              }
            : conversation
        );
      } else {
        state.messages[conversationId] = (state.messages[conversationId] || []).map((message) =>
          message.id === optimistic.id ? persisted : message
        );
        state.conversations = state.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                lastMessage: persisted,
                updatedAt: persisted.createdAt,
              }
            : conversation
        );
      }

      state.error = null;
      state.aiIsTyping = false;
      emit();
      return;
    }

    try {
      await collabApi.sendConversationMessage({
        conversationId,
        content,
        contentType,
        embeddedContent,
      });
      await state.loadMessages(conversationId);
      if (subscribedTrialId) {
        await state.loadConversations(subscribedTrialId);
      }
    } catch (error) {
      const trialId =
        state.conversations.find((conversation) => conversation.id === conversationId)?.trialId ||
        subscribedTrialId;

      if (trialId && isLikelyDemoConversationError(error)) {
        const persisted: CollaborationMessage = {
          ...optimistic,
          id: `demo-${Date.now()}`,
          senderId: selfId,
          createdAt: nowIso,
        };
        const dataset = appendConversationDemoMessage(trialId, conversationId, persisted);
        state.messages[conversationId] = dataset.messagesByConversation[conversationId] || [persisted];
        state.conversations = dataset.conversations;
        state.error = null;
      } else {
        state.error = error instanceof Error ? error.message : "Failed to send message";
      }
    } finally {
      state.aiIsTyping = false;
      emit();
    }
  },
  async createDirectConversationWithMember(trialId, member) {
    try {
      const created = createOrGetLocalDirectConversation(trialId, member);
      await state.loadConversations(trialId);
      return created;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to create local direct conversation";
      emit();
      return null;
    }
  },

  threads: [],
  activeThreadId: null,
  threadMessages: {},
  threadFilters: {},
  setActiveThread(threadId) {
    state.activeThreadId = threadId;
    emit();
  },
  setThreadFilters(filters) {
    state.threadFilters = { ...filters };
    emit();
  },
  async loadThreads(trialId, filters) {
    if (state.dataMode === "building") {
      state.threadFilters = filters ?? state.threadFilters;
      state.threads = [];
      state.activeThreadId = null;
      state.threadMessages = {};
      state.error = null;
      emit();
      return;
    }
    if (state.dataMode === "sample") {
      const dataset = loadOrInitThreadDataset(trialId);
      state.threadFilters = filters ?? state.threadFilters;
      const filtered = dataset.threads.filter((thread) => {
        if (state.threadFilters.category && thread.category !== state.threadFilters.category) return false;
        if (state.threadFilters.status && thread.status !== state.threadFilters.status) return false;
        return true;
      });
      state.threads = filtered;
      if (state.activeThreadId && !filtered.some((thread) => thread.id === state.activeThreadId)) {
        state.activeThreadId = filtered[0]?.id || null;
      }
      state.error = null;
      emit();
      return;
    }
    state.isLoading = true;
    state.error = null;
    emit();
    try {
      state.threadFilters = filters ?? state.threadFilters;
      let rows = (await collabApi.listThreads(trialId, state.threadFilters)) as TrialThread[];
      if (!rows.length) {
        rows = loadOrInitThreadDataset(trialId).threads;
      }
      state.threads = rows;
      state.error = null;
    } catch (error) {
      if (isLikelyDemoConversationError(error)) {
        state.threads = loadOrInitThreadDataset(trialId).threads;
        state.error = null;
      } else {
        state.error = error instanceof Error ? error.message : "Failed to load threads";
      }
    } finally {
      state.isLoading = false;
      emit();
    }
  },
  async loadThreadMessages(threadId) {
    if (state.dataMode === "building") {
      state.threadMessages[threadId] = [];
      state.error = null;
      emit();
      return;
    }
    if (state.dataMode === "sample") {
      const trialId = state.threads.find((thread) => thread.id === threadId)?.trialId || subscribedTrialId;
      if (trialId) {
        state.threadMessages[threadId] = loadOrInitThreadDataset(trialId).messagesByThread[threadId] || [];
      } else {
        state.threadMessages[threadId] = [];
      }
      state.error = null;
      emit();
      return;
    }
    try {
      const thread = (await collabApi.getThread(threadId)) as TrialThread | null;
      let rows = (thread?.messages || []) as CollaborationMessage[];
      if (!rows.length) {
        const trialId = state.threads.find((item) => item.id === threadId)?.trialId || subscribedTrialId;
        if (trialId) {
          rows = loadOrInitThreadDataset(trialId).messagesByThread[threadId] || [];
        }
      }
      state.threadMessages[threadId] = rows;
      state.error = null;
      emit();
    } catch (error) {
      const trialId = state.threads.find((thread) => thread.id === threadId)?.trialId || subscribedTrialId;
      if (trialId && isLikelyDemoConversationError(error)) {
        state.threadMessages[threadId] = loadOrInitThreadDataset(trialId).messagesByThread[threadId] || [];
        state.error = null;
      } else {
        state.error = error instanceof Error ? error.message : "Failed to load thread messages";
      }
      emit();
    }
  },
  async createThread(data) {
    if (state.dataMode === "sample") {
      const dataset = loadOrInitThreadDataset(data.trialId);
      const nowIso = new Date().toISOString();
      const threadId = `local-thread-${Date.now().toString(36)}`;
      const created: TrialThread = {
        id: threadId,
        trialId: data.trialId,
        title: data.title,
        category: data.category,
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
        resolutionSummary: null,
        aiContributed: false,
        aiResolutionSuggested: false,
        createdBy: getRuntimeUserIdentity().id,
        createdAt: nowIso,
        updatedAt: nowIso,
        anchors:
          data.anchors?.map((anchor, index) => ({
            id: `local-anchor-${Date.now().toString(36)}-${index + 1}`,
            threadId,
            anchorType: anchor.anchorType,
            anchorLabel: anchor.anchorLabel,
            anchorRefId: anchor.anchorRefId || null,
            anchorRefType: anchor.anchorRefType || null,
            createdAt: nowIso,
          })) || [],
        participants: [],
        replyCount: 0,
      };
      dataset.threads = [created, ...dataset.threads].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      dataset.messagesByThread = { ...dataset.messagesByThread, [created.id]: [] };
      saveThreadDemoDataset(data.trialId, dataset);
      state.threads = dataset.threads;
      state.threadMessages[created.id] = [];
      state.activeThreadId = created.id;
      state.error = null;
      emit();
      return created;
    }
    try {
      const created = await collabApi.createThread(data);
      await state.loadThreads(data.trialId);
      if (!created?.id) return null;
      const thread = (await collabApi.getThread(created.id)) as TrialThread | null;
      return thread;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to create thread";
      emit();
      return null;
    }
  },
  async resolveThread(threadId, summary) {
    if (state.dataMode === "sample") {
      const target = state.threads.find((thread) => thread.id === threadId);
      if (!target) return;
      const dataset = loadOrInitThreadDataset(target.trialId);
      const nowIso = new Date().toISOString();
      dataset.threads = dataset.threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              status: "resolved",
              resolutionSummary: summary || thread.resolutionSummary,
              resolvedBy: getRuntimeUserIdentity().id,
              resolvedAt: nowIso,
              updatedAt: nowIso,
            }
          : thread
      );
      saveThreadDemoDataset(target.trialId, dataset);
      await state.loadThreads(target.trialId, state.threadFilters);
      await state.loadThreadMessages(threadId);
      return;
    }
    try {
      await collabApi.resolveThread(threadId, summary, false);
      const activeThread = state.threads.find((thread) => thread.id === threadId);
      if (activeThread) {
        await state.loadThreads(activeThread.trialId, state.threadFilters);
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to resolve thread";
      emit();
    }
  },
  async requestAIResolutionSummary(threadId) {
    if (state.dataMode === "sample") {
      const thread = state.threads.find((item) => item.id === threadId);
      if (!thread) return "";
      return `Resolved by aligning ${thread.title.toLowerCase()} with protocol requirements, assigning owners, and confirming site-level follow-up.`;
    }
    try {
      const result = await collabApi.suggestResolution(threadId);
      return String(result.summary || "");
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to generate AI summary";
      emit();
      return "";
    }
  },

  inboxConfig: null,
  emailChains: [],
  activeEmailChainId: null,
  emailMessages: {},
  activeFolder: "inbox",
  aiDraft: null,
  aiDraftLoading: false,
  inboxTriageSettings: loadInboxTriageSettings(),
  setActiveFolder(folder) {
    state.activeFolder = folder;
    emit();
  },
  setActiveEmailChain(chainId) {
    state.activeEmailChainId = chainId;
    emit();
  },
  updateInboxTriageLabel(label, patch) {
    state.inboxTriageSettings = normalizeInboxTriageSettings({
      ...state.inboxTriageSettings,
      labels: state.inboxTriageSettings.labels.map((item) =>
        item.key === label ? { ...item, ...patch } : item
      ),
    });
    saveInboxTriageSettings(state.inboxTriageSettings);
    emit();
  },
  setInboxTriageConfidence(confidence) {
    state.inboxTriageSettings = normalizeInboxTriageSettings({
      ...state.inboxTriageSettings,
      autoApplyConfidence: confidence,
    });
    saveInboxTriageSettings(state.inboxTriageSettings);
    emit();
  },
  resetInboxTriageSettings() {
    state.inboxTriageSettings = createDefaultInboxTriageSettings();
    saveInboxTriageSettings(state.inboxTriageSettings);
    emit();
  },
  async loadInbox(trialId) {
    if (state.dataMode === "building") {
      state.inboxConfig = {
        id: `building-inbox-${trialId}`,
        trialId,
        emailAddress: `${trialId}@inbox.themison.local`,
        isActive: false,
        createdAt: new Date().toISOString(),
      };
      state.emailChains = [];
      state.activeEmailChainId = null;
      state.emailMessages = {};
      state.error = null;
      emit();
      return;
    }
    state.isLoading = true;
    state.error = null;
    emit();
    try {
      state.inboxConfig = (await collabApi.getInboxConfig(trialId)) as TrialInbox;
    } catch (error) {
      if (isLikelyDemoInboxError(error)) {
        state.inboxConfig = {
          id: `demo-inbox-${trialId}`,
          trialId,
          emailAddress: `${trialId}@inbox.themison.local`,
          isActive: true,
          createdAt: new Date().toISOString(),
        };
        state.error = null;
      } else {
        state.error = error instanceof Error ? error.message : "Failed to load inbox";
      }
    } finally {
      state.isLoading = false;
      emit();
    }
  },
  async loadEmailChains(folder) {
    const selected = folder ?? state.activeFolder;
    state.activeFolder = selected;
    if (state.dataMode === "building") {
      state.emailChains = [];
      state.activeEmailChainId = null;
      state.error = null;
      emit();
      return;
    }
    if (!state.inboxConfig) return;

    const folderFilter = selected === "unread" ? "inbox" : selected;
    try {
      let rows = (await collabApi.listEmailChains({
        trialId: state.inboxConfig.trialId,
        folder: folderFilter === "inbox" || folderFilter === "sent" || folderFilter === "drafts" || folderFilter === "archived"
          ? folderFilter
          : undefined,
      })) as EmailChain[];

      if (rows.length === 0) {
        const demo = loadOrInitDemoDataset(state.inboxConfig.trialId, state.inboxConfig.emailAddress);
        rows = getChainsForFolder(demo.chains, selected);
      }

      state.emailChains = selected === "unread" ? rows.filter((row) => !row.isRead) : rows;
      state.error = null;
      emit();
    } catch (error) {
      if (state.inboxConfig && isLikelyDemoInboxError(error)) {
        const demo = loadOrInitDemoDataset(state.inboxConfig.trialId, state.inboxConfig.emailAddress);
        state.emailChains = getChainsForFolder(demo.chains, selected);
        state.error = null;
      } else {
        state.error = error instanceof Error ? error.message : "Failed to load email chains";
      }
      emit();
    }
  },
  async loadEmailMessages(chainId) {
    if (state.dataMode === "building") {
      state.emailMessages[chainId] = [];
      state.error = null;
      emit();
      return;
    }
    try {
      const chain = (await collabApi.getEmailChain(chainId)) as EmailChain | null;
      let rows = (chain?.messages || []) as CollaborationMessage[];
      if (!rows.length && state.inboxConfig) {
        const demo = loadOrInitDemoDataset(state.inboxConfig.trialId, state.inboxConfig.emailAddress);
        rows = (demo.messagesByChain[chainId] || []) as CollaborationMessage[];
      }
      state.emailMessages[chainId] = rows;
      state.error = null;
      emit();
    } catch (error) {
      if (state.inboxConfig && isLikelyDemoInboxError(error)) {
        const demo = loadOrInitDemoDataset(state.inboxConfig.trialId, state.inboxConfig.emailAddress);
        state.emailMessages[chainId] = (demo.messagesByChain[chainId] || []) as CollaborationMessage[];
        state.error = null;
      } else {
        state.error = error instanceof Error ? error.message : "Failed to load email messages";
      }
      emit();
    }
  },
  async dismissAILabel(chainId, label) {
    try {
      await collabApi.dismissAILabel(chainId, label);
      await state.loadEmailChains(state.activeFolder);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to dismiss label";
      emit();
    }
  },
  async requestAIDraft(chainId, instructions) {
    state.aiDraftLoading = true;
    emit();
    try {
      const draft = (await collabApi.draftWithAI(chainId, instructions)) as DraftResult;
      state.aiDraft = draft;
      return draft;
    } finally {
      state.aiDraftLoading = false;
      emit();
    }
  },

  async spawnThreadFromMessage(messageId, threadData) {
    try {
      const created = await collabApi.startThreadFromMessage(messageId, threadData.title, threadData.category);
      await state.loadThreads(threadData.trialId, state.threadFilters);
      if (!created?.threadId) return null;
      return (await collabApi.getThread(created.threadId)) as TrialThread | null;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to spawn thread";
      emit();
      return null;
    }
  },
  async linkEmailToThread(emailChainId, threadId) {
    try {
      await collabApi.linkEmailThread(emailChainId, threadId);
      await state.loadEmailChains(state.activeFolder);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to link email to thread";
      emit();
    }
  },
  async createThreadFromEmail(emailChainId, threadData) {
    try {
      const created = await collabApi.createThreadFromEmail(emailChainId, threadData.title, threadData.category);
      await Promise.all([
        state.loadThreads(threadData.trialId, state.threadFilters),
        state.loadEmailChains(state.activeFolder),
      ]);
      if (!created?.threadId) return null;
      return (await collabApi.getThread(created.threadId)) as TrialThread | null;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to create thread from email";
      emit();
      return null;
    }
  },

  subscribeToUpdates(trialId) {
    subscribedTrialId = trialId;
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }

    const tick = async () => {
      if (!subscribedTrialId) return;
      try {
        await Promise.all([
          state.loadConversations(subscribedTrialId),
          state.loadThreads(subscribedTrialId, state.threadFilters),
          state.loadInbox(subscribedTrialId),
        ]);

        await state.loadEmailChains(state.activeFolder);

        await Promise.all([
          state.activeConversationId ? state.loadMessages(state.activeConversationId) : Promise.resolve(),
          state.activeThreadId ? state.loadThreadMessages(state.activeThreadId) : Promise.resolve(),
          state.activeEmailChainId ? state.loadEmailMessages(state.activeEmailChainId) : Promise.resolve(),
        ]);
      } catch {
        // noop: polling errors are captured in state.error in individual calls
      }
    };

    pollTimer = window.setInterval(tick, 3500);
    void tick();
  },
  unsubscribe() {
    subscribedTrialId = null;
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  },

  isLoading: false,
  error: null,
};

const store = state;

export function useCollaborationStore<T>(selector: (snapshot: CollaborationStore) => T) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => selector(store),
    () => selector(store)
  );
}

export function getCollaborationStore() {
  return store;
}
