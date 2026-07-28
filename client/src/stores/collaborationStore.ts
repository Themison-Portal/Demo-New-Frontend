import { useSyncExternalStore } from "react";
import { collabApi } from "@/lib/apiClient";
import {
    createDefaultInboxTriageSettings,
    loadInboxTriageSettings,
    normalizeInboxTriageSettings,
    saveInboxTriageSettings,
} from "@/lib/inbox-triage-settings";
import {
    collaborationIdsMatch,
    getCollaborationIdentityEmail,
    getCollaborationIdentityId,
    getCollaborationIdentityName,
    getOtherConversationParticipant,
    isLegacyDemoUserName,
} from "@/lib/collaborationIdentity";
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
    folderCounts: { inbox: number; unread: number; sent: number; draft: number };
    setActiveLayer: (layer: CollaborationLayer) => void;

    conversations: Conversation[];
    activeConversationId: string | null;
    messages: Record<string, CollaborationMessage[]>;
    aiIsTyping: boolean;
    setActiveConversation: (conversationId: string | null) => void;
    loadConversations: (trialId: string) => Promise<void>;
    loadMessages: (conversationId: string) => Promise<void>;
    loadFolderCounts: () => Promise<void>;
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
const CONVERSATION_DEMO_SEED_VERSION = 6;
const THREAD_DEMO_SEED_VERSION = 5;
const DEMO_STATE_STORAGE_PREFIX = "themison-demo-state";
const DEMO_STATE_ACTIVE_MODE_KEY = `${DEMO_STATE_STORAGE_PREFIX}-active-mode`;
const LEGACY_MEMBER_EMAIL_DOMAIN = "@themison.com";
const CURRENT_MEMBER_EMAIL_DOMAIN = "@azorg.be";
const LEGACY_DEMO_SELF_USER_ID = 1;
const conversationDatasetMemoryCache = new Map<string, LocalDemoConversationDataset>();

function readActiveDemoModeFromStorage(): DemoDataMode {
    if (typeof window === "undefined") return "sample";
    const raw = window.localStorage.getItem(DEMO_STATE_ACTIVE_MODE_KEY);
    return raw === "sample" || raw === "full" || raw === "building" ? raw : "sample";
}

function readCurrentConversationDatasetMode(): DemoDataMode {
    try {
        const modeFromStore = state?.dataMode;
        if (modeFromStore === "sample" || modeFromStore === "full" || modeFromStore === "building") {
            return modeFromStore;
        }
    } catch {
        // Store is not initialized yet; fallback to persisted mode.
    }
    return readActiveDemoModeFromStorage();
}

// Demo team profile IDs — match DB seed data
const DEMO_PROFILE_MAP: Record<string, string> = {};

function getDemoProfileId(name: string): string | null {
    return DEMO_PROFILE_MAP[name.toLowerCase().trim()] ?? null;
}

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
    const defaultIdentity = {
        id: DEMO_SELF_USER_ID,
        name: "Kaleb Sanders",
        email: "kaleb.s@azorg.be",
    };

    let runtimeIdentity = defaultIdentity;

    if (typeof window === "undefined") {
        return runtimeIdentity;
    }

    try {
        const raw = window.localStorage.getItem("manus-runtime-user-info");
        if (!raw) return runtimeIdentity;

        const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown; email?: unknown };
        const parsedId = Number(parsed.id);
        runtimeIdentity = {
            id: Number.isFinite(parsedId) ? parsedId : DEMO_SELF_USER_ID,
            name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : "Kaleb Sanders",
            email:
                typeof parsed.email === "string" && parsed.email.trim()
                    ? normalizeDemoMemberEmail(parsed.email)
                    : "kaleb.s@azorg.be",
        };
    } catch {
        runtimeIdentity = defaultIdentity;
    }

    const members = getTeamMembersFromDemoState();
    if (!members.length) return runtimeIdentity;

    const runtimeEmail = normalizeComparableEmail(runtimeIdentity.email);
    const runtimeName = normalizeName(runtimeIdentity.name);
    const matchedByEmail = members.find((member) => normalizeComparableEmail(member.email) === runtimeEmail);
    const matchedByName = members.find((member) => namesLikelyMatch(member.name, runtimeName));
    const effectiveMember = matchedByEmail || matchedByName || members[0];
    if (!effectiveMember) return runtimeIdentity;

    return {
        id: runtimeIdentity.id,
        name: effectiveMember.name,
        email: normalizeDemoMemberEmail(effectiveMember.email),
    };
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
    return value
        .toLowerCase()
        .replace(/\((you|me)\)/g, " ")
        .replace(/[^a-z0-9\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isWithinOneEditDistance(left: string, right: string) {
    if (left === right) return true;
    const leftLength = left.length;
    const rightLength = right.length;
    if (Math.abs(leftLength - rightLength) > 1) return false;

    let leftIndex = 0;
    let rightIndex = 0;
    let edits = 0;

    while (leftIndex < leftLength && rightIndex < rightLength) {
        if (left[leftIndex] === right[rightIndex]) {
            leftIndex += 1;
            rightIndex += 1;
            continue;
        }
        edits += 1;
        if (edits > 1) return false;
        if (leftLength > rightLength) {
            leftIndex += 1;
        } else if (rightLength > leftLength) {
            rightIndex += 1;
        } else {
            leftIndex += 1;
            rightIndex += 1;
        }
    }

    return true;
}

function namesLikelyMatch(left: string | null | undefined, right: string | null | undefined) {
    const normalizedLeft = normalizeName(String(left || ""));
    const normalizedRight = normalizeName(String(right || ""));
    if (!normalizedLeft || !normalizedRight) return false;
    if (normalizedLeft === normalizedRight) return true;

    const leftParts = normalizedLeft.split(" ").filter(Boolean);
    const rightParts = normalizedRight.split(" ").filter(Boolean);
    if (!leftParts.length || !rightParts.length) return false;

    const leftFirst = leftParts[0];
    const rightFirst = rightParts[0];
    if (leftFirst !== rightFirst) return false;

    const leftLast = leftParts[leftParts.length - 1];
    const rightLast = rightParts[rightParts.length - 1];
    if (leftLast === rightLast) return true;
    if (leftLast.startsWith(rightLast) || rightLast.startsWith(leftLast)) return true;
    return isWithinOneEditDistance(leftLast, rightLast);
}

function normalizeStoredEmail(value: string | null | undefined) {
    return normalizeDemoMemberEmail(String(value || "").trim()).toLowerCase();
}

function normalizeComparableEmail(value: string | null | undefined) {
    const normalized = normalizeStoredEmail(value);
    if (!normalized) return "";
    const atIndex = normalized.lastIndexOf("@");
    if (atIndex <= 0 || atIndex >= normalized.length - 1) return normalized;
    const local = normalized.slice(0, atIndex).replace(/\+.*/g, "").replace(/[._-]/g, "");
    const domain = normalized.slice(atIndex + 1);
    return `${local}@${domain}`;
}

function matchesRuntimeUser(
    candidate:
        | {
            id?: string | number | null;
            userId?: string | number | null;
            name?: string | null;
            email?: string | null;
            user?: { id?: string | number | null; name?: string | null; email?: string | null } | null;
        }
        | null
        | undefined,
    runtimeUser: ReturnType<typeof getRuntimeUserIdentity>,
    options?: {
        extraIds?: Array<string | number | null | undefined>;
        allowLegacyDemoUser?: boolean;
    }
) {
    if (!candidate) return false;

    const candidateId = getCollaborationIdentityId(candidate);
    if (collaborationIdsMatch(candidateId, runtimeUser.id)) {
        return true;
    }

    const extraIds = options?.extraIds || [];
    if (candidateId != null && extraIds.some((extraId) => collaborationIdsMatch(candidateId, extraId))) {
        return true;
    }

    const candidateEmail = normalizeComparableEmail(getCollaborationIdentityEmail(candidate));
    const runtimeEmail = normalizeComparableEmail(runtimeUser.email);
    if (candidateEmail && runtimeEmail && candidateEmail === runtimeEmail) {
        return true;
    }

    if (namesLikelyMatch(getCollaborationIdentityName(candidate), runtimeUser.name)) {
        return true;
    }

    const candidateName = normalizeName(getCollaborationIdentityName(candidate) || "");
    return Boolean(options?.allowLegacyDemoUser && isLegacyDemoUserName(candidateName));
}

function toInitials(value: string) {
    const parts = value
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "TM";
}

const HARDCODED_MOCK_NAMES = new Set([
    "kaleb sanders",
    "ava patel",
    "liam chen",
    "maya rodriguez",
    "noah brooks",
    "olivia hart",
    "sofia alvarez",
    "daniel nguyen",
    "priya nair",
    "lucas meyer",
    "isabelle laurent",
    "jordan reed",
    "zara malik",
    "hannah park",
    "marco silva",
    "rina sato",
    "owen price",
    "camila duarte",
    "isaac walker",
    "jordan de boer",
    "daniel van dijk",
]);

function isHardcodedMockMember(member: { id?: unknown; name?: unknown; email?: unknown }) {
    if (!member) return false;
    const id = String(member.id || "").trim();
    if (/^member-\d+$/i.test(id)) return true;
    const name = String(member.name || "").trim().toLowerCase();
    if (Array.from(HARDCODED_MOCK_NAMES).some(mockName => name.includes(mockName))) return true;
    const email = String(member.email || "").trim().toLowerCase();
    if (/^(ava\.patel|liam\.chen|maya\.rodriguez|noah\.brooks|kaleb|olivia\.hart|sofia\.alvarez|daniel\.nguyen|priya\.nair|lucas\.meyer|isabelle\.laurent|jordan\.reed|zara\.malik|hannah\.park|marco\.silva|rina\.sato|owen\.price|camila\.duarte|isaac\.walker)/i.test(email)) {
        return true;
    }
    return false;
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
                if (isHardcodedMockMember(member)) return null;

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
            .filter((member): member is DemoTeamMemberSeed => Boolean(member) && !isHardcodedMockMember(member!));
    } catch {
        return [];
    }
}

function getFallbackTeamMembers(): DemoTeamMemberSeed[] {
    return [];
}

function getSeedMembers(runtimeUser: ReturnType<typeof getRuntimeUserIdentity>): DemoTeamMemberSeed[] {
    const runtimeName = normalizeName(runtimeUser.name);
    const runtimeEmail = runtimeUser.email.toLowerCase();
    const allMembers = getTeamMembersFromDemoState();
    const candidates = allMembers.length ? allMembers : getFallbackTeamMembers();

    const withoutSelf = candidates.filter((member) => {
        if (
            matchesRuntimeUser(member, runtimeUser, {
                extraIds: [LEGACY_DEMO_SELF_USER_ID],
                allowLegacyDemoUser: true,
            })
        ) {
            return false;
        }
        if (collaborationIdsMatch(member.id, runtimeUser.id)) return false;
        if (normalizeComparableEmail(member.email) === normalizeComparableEmail(runtimeEmail)) return false;
        if (namesLikelyMatch(member.name, runtimeName)) return false;
        return true;
    });

    if (withoutSelf.length > 0) return withoutSelf;
    return getFallbackTeamMembers().filter((member) => !namesLikelyMatch(member.name, runtimeName));
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

function getConversationDemoStorageKey(trialId: string, mode: DemoDataMode = readCurrentConversationDatasetMode()) {
    return `${LOCAL_DEMO_CONVERSATION_PREFIX}:${mode}:${trialId}`;
}

function getLegacyConversationDemoStorageKey(trialId: string) {
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

function buildConversationProtocolSnippet(member: DemoTeamMemberSeed, trialId: string) {
    const role = member.role.toLowerCase();

    if (role.includes("regulatory")) {
        return {
            document_name: "Protocol Amendment Guide",
            section_ref: "Section 2.4 — IRB & Regulatory Distribution",
            quoted_text:
                "Circulate approved amendment packets to all participating sites within one business day and retain receipt acknowledgment.",
            document_link: `#${trialId}-regulatory-distribution`,
        };
    }

    if (role.includes("data")) {
        return {
            document_name: "EDC Completion Guide",
            section_ref: "Section 5.2 — Query Turnaround",
            quoted_text:
                "Resolve routine data queries within 48 hours and document rationale for any delays beyond the window.",
            document_link: `#${trialId}-query-turnaround`,
        };
    }

    if (role.includes("nurse") || role.includes("lab")) {
        return {
            document_name: "Schedule of Activities (SoA)",
            section_ref: "Visit 3 — Labs & Safety",
            quoted_text:
                "Visit 3 blood and safety assessments must be completed within the protocol-defined operational window and timestamped in source notes.",
            document_link: `#${trialId}-visit3-labs`,
        };
    }

    if (role.includes("safety") || role.includes("pharmacovigilance")) {
        return {
            document_name: "Safety Reporting Manual",
            section_ref: "Section 3.1 — SAE Follow-up",
            quoted_text:
                "Submit SAE follow-up narratives to sponsor within 24 hours of receiving clinically relevant updates.",
            document_link: `#${trialId}-sae-followup`,
        };
    }

    return {
        document_name: "Protocol DN-2024-01",
        section_ref: "Section 5.5.3",
        quoted_text:
            "At Visit 3, blood sampling must be completed within a strict +/-2 hour window from scheduled time.",
        document_link: `#${trialId}-protocol-5-5-3`,
    };
}

function buildConversationTaskCard(member: DemoTeamMemberSeed, memberFirstName: string) {
    const role = member.role.toLowerCase();

    if (role.includes("regulatory")) {
        return {
            title: "Publish amendment receipt log to all active sites",
            assignee_name: member.name,
            due_date: "Today 17:00",
            status: "Open",
        };
    }

    if (role.includes("data")) {
        return {
            title: "Close remaining EDC queries for Site 14",
            assignee_name: member.name,
            due_date: "Tomorrow 12:00",
            status: "Open",
        };
    }

    if (role.includes("nurse") || role.includes("site") || role.includes("coordinator") || role.includes("operations")) {
        return {
            title: `Confirm Visit 3 operational window with ${memberFirstName}'s site team`,
            assignee_name: member.name,
            due_date: "Tomorrow",
            status: "Open",
        };
    }

    if (role.includes("lab")) {
        return {
            title: "Post courier tracking for replacement kits in ops thread",
            assignee_name: member.name,
            due_date: "Today 16:00",
            status: "Open",
        };
    }

    return {
        title: `Send trial status recap and open risks with ${memberFirstName}`,
        assignee_name: member.name,
        due_date: "Today",
        status: "Open",
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
        senderEmail = null,
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
        senderEmail?: string | null;
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
        senderEmail,
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
        const protocolSnippet = buildConversationProtocolSnippet(member, trialId);
        const taskCard = buildConversationTaskCard(member, memberFirstName);
        const latestOffset = 6 + index * 9;
        let messageCounter = 4;
        let nextOffset = Math.max(0, latestOffset - 1);
        const shouldShareProtocol = index % 2 === 0;
        const shouldCreateTask = index === 0 || index % 3 === 1;

        const messages: CollaborationMessage[] = [
            makeMessage({
                id: `${conversationId}-m1`,
                conversationId,
                senderId: memberUserId,
                senderType: "user",
                senderName: member.name,
                senderEmail: member.email,
                content: script.memberOpen,
                createdAt: asIso(latestOffset + 11),
            }),
            makeMessage({
                id: `${conversationId}-m2`,
                conversationId,
                senderId: selfId,
                senderType: "user",
                senderName: selfName,
                senderEmail: selfEmail,
                content: script.selfReply,
                createdAt: asIso(latestOffset + 6),
            }),
            makeMessage({
                id: `${conversationId}-m3`,
                conversationId,
                senderId: memberUserId,
                senderType: "user",
                senderName: member.name,
                senderEmail: member.email,
                content: script.memberClose,
                createdAt: asIso(latestOffset),
            }),
        ];

        if (shouldShareProtocol) {
            messages.push(
                makeMessage({
                    id: `${conversationId}-m${messageCounter++}`,
                    conversationId,
                    senderId: selfId,
                    senderType: "user",
                    senderName: selfName,
                    senderEmail: selfEmail,
                    content: "Sharing the protocol reference here so we stay aligned:",
                    createdAt: asIso(nextOffset),
                    contentType: "protocol_snippet",
                    embeddedContent: protocolSnippet,
                })
            );
            nextOffset = Math.max(0, nextOffset - 1);
            messages.push(
                makeMessage({
                    id: `${conversationId}-m${messageCounter++}`,
                    conversationId,
                    senderId: memberUserId,
                    senderType: "user",
                    senderName: member.name,
                    senderEmail: member.email,
                    content: "Confirmed. I will apply this wording in the site update now.",
                    createdAt: asIso(nextOffset),
                })
            );
            nextOffset = Math.max(0, nextOffset - 1);
        }

        if (shouldCreateTask) {
            messages.push(
                makeMessage({
                    id: `${conversationId}-m${messageCounter++}`,
                    conversationId,
                    senderId: selfId,
                    senderType: "user",
                    senderName: selfName,
                    senderEmail: selfEmail,
                    content: "Added an action item so this does not get missed:",
                    createdAt: asIso(nextOffset),
                    contentType: "task_card",
                    embeddedContent: taskCard,
                })
            );
            nextOffset = Math.max(0, nextOffset - 1);
            messages.push(
                makeMessage({
                    id: `${conversationId}-m${messageCounter++}`,
                    conversationId,
                    senderId: memberUserId,
                    senderType: "user",
                    senderName: member.name,
                    senderEmail: member.email,
                    content: "Perfect, I will complete it and post confirmation in this thread.",
                    createdAt: asIso(nextOffset),
                })
            );
        }

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

function sanitizeConversationMessage(
    message: CollaborationMessage,
    conversationId: string,
    runtimeUser: ReturnType<typeof getRuntimeUserIdentity>,
    selfIdHints: Array<string | number | null | undefined>
): CollaborationMessage {
    const isSelf = matchesRuntimeUser(message, runtimeUser, {
        extraIds: selfIdHints,
        allowLegacyDemoUser: true,
    });

    return {
        ...message,
        conversationId,
        senderId: isSelf ? runtimeUser.id : message.senderId,
        senderName: isSelf ? runtimeUser.name : message.senderName,
        senderEmail: isSelf ? runtimeUser.email : normalizeDemoMemberEmail(String(message.senderEmail || "").trim()) || null,
    };
}

function sanitizeConversationDemoDataset(
    dataset: LocalDemoConversationDataset,
    mode: DemoDataMode = readCurrentConversationDatasetMode()
): LocalDemoConversationDataset {
    const runtimeUser = getRuntimeUserIdentity();
    const nextMessagesByConversation: Record<string, CollaborationMessage[]> = {};

    const nextConversations = dataset.conversations
        .map((conversation) => {
            const selfIdHints = [runtimeUser.id, conversation.createdBy, LEGACY_DEMO_SELF_USER_ID];
            const rawParticipants = conversation.participants || [];
            const normalizedParticipants = rawParticipants.map((participant, index) => {
                const isSelf = matchesRuntimeUser(participant, runtimeUser, {
                    extraIds: selfIdHints,
                    allowLegacyDemoUser: true,
                });
                const normalizedEmail = normalizeDemoMemberEmail(String(participant.user?.email || "").trim()) || null;
                const userId = isSelf ? runtimeUser.id : participant.userId;
                const user = {
                    id: isSelf ? runtimeUser.id : participant.user?.id ?? userId,
                    name: isSelf ? runtimeUser.name : participant.user?.name || null,
                    email: isSelf ? runtimeUser.email : normalizedEmail,
                };

                return {
                    ...participant,
                    id: participant.id || `${conversation.id}-participant-${isSelf ? runtimeUser.id : index + 1}`,
                    conversationId: conversation.id,
                    userId,
                    user,
                };
            });

            const dedupedParticipants = normalizedParticipants.filter((participant, index, rows) => {
                const isSelf = matchesRuntimeUser(participant, runtimeUser, { extraIds: selfIdHints });
                return rows.findIndex((candidate) => {
                    if (isSelf) {
                        return matchesRuntimeUser(candidate, runtimeUser, { extraIds: selfIdHints });
                    }

                    const sameId = collaborationIdsMatch(candidate.userId, participant.userId);
                    const sameEmail =
                        normalizeStoredEmail(candidate.user?.email) &&
                        normalizeStoredEmail(candidate.user?.email) === normalizeStoredEmail(participant.user?.email);
                    const sameName =
                        normalizeName(candidate.user?.name || "") &&
                        normalizeName(candidate.user?.name || "") === normalizeName(participant.user?.name || "");
                    return sameId || sameEmail || sameName;
                }) === index;
            });

            const directParticipants =
                conversation.type === "direct"
                    ? [
                        ...(dedupedParticipants
                            .filter((participant) => matchesRuntimeUser(participant, runtimeUser, { extraIds: selfIdHints }))
                            .slice(0, 1).length
                            ? dedupedParticipants
                                .filter((participant) => matchesRuntimeUser(participant, runtimeUser, { extraIds: selfIdHints }))
                                .slice(0, 1)
                            : [
                                {
                                    id: `${conversation.id}-participant-${runtimeUser.id}`,
                                    conversationId: conversation.id,
                                    userId: runtimeUser.id,
                                    joinedAt: conversation.createdAt,
                                    lastReadAt: null,
                                    user: {
                                        id: runtimeUser.id,
                                        name: runtimeUser.name,
                                        email: runtimeUser.email,
                                    },
                                },
                            ]),
                        ...dedupedParticipants.filter(
                            (participant) => !matchesRuntimeUser(participant, runtimeUser, { extraIds: selfIdHints })
                        ).slice(0, 1),
                    ]
                    : dedupedParticipants;

            const otherParticipant =
                conversation.type === "direct"
                    ? directParticipants.find(
                        (participant) => !matchesRuntimeUser(participant, runtimeUser, { extraIds: selfIdHints })
                    ) || null
                    : null;

            if (conversation.type === "direct" && !otherParticipant) {
                return null;
            }

            const rawMessages = dataset.messagesByConversation[conversation.id] || [];
            const sanitizedMessages = rawMessages.map((message) =>
                sanitizeConversationMessage(message, conversation.id, runtimeUser, selfIdHints)
            );
            nextMessagesByConversation[conversation.id] = sanitizedMessages;

            const sanitizedLastMessage = conversation.lastMessage
                ? sanitizeConversationMessage(conversation.lastMessage, conversation.id, runtimeUser, selfIdHints)
                : null;
            const lastMessage = sanitizedMessages[sanitizedMessages.length - 1] || sanitizedLastMessage;

            return {
                ...conversation,
                createdBy: runtimeUser.id,
                participants: directParticipants,
                lastMessage,
                updatedAt: lastMessage?.createdAt || conversation.updatedAt,
            };
        })
        .filter(Boolean) as Conversation[];

    nextConversations.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

    if (mode === "building") {
        const localConversations = nextConversations.filter((conversation) =>
            isLocalConversationId(String(conversation.id || ""))
        );
        const localMessagesByConversation = localConversations.reduce<Record<string, CollaborationMessage[]>>(
            (acc, conversation) => {
                acc[conversation.id] = nextMessagesByConversation[conversation.id] || [];
                return acc;
            },
            {}
        );

        return {
            ...dataset,
            conversations: localConversations,
            messagesByConversation: localMessagesByConversation,
        };
    }

    return {
        ...dataset,
        conversations: nextConversations,
        messagesByConversation: nextMessagesByConversation,
    };
}

function loadOrInitConversationDataset(
    trialId: string,
    mode: DemoDataMode = readCurrentConversationDatasetMode()
): LocalDemoConversationDataset {
    if (typeof window === "undefined") {
        return sanitizeConversationDemoDataset(buildDefaultConversationDataset(trialId), mode);
    }

    const key = getConversationDemoStorageKey(trialId, mode);
    const cached = conversationDatasetMemoryCache.get(key);
    if (cached) {
        return cached;
    }
    const runtimeUser = getRuntimeUserIdentity();
    const expectedSignature = getConversationMemberSignature(runtimeUser, getSeedMembers(runtimeUser).slice(0, 8));
    const existing =
        parseConversationDemoDataset(window.localStorage.getItem(key)) ||
        (mode === "sample"
            ? parseConversationDemoDataset(window.localStorage.getItem(getLegacyConversationDemoStorageKey(trialId)))
            : null);
    if (
        existing &&
        existing.seedVersion === CONVERSATION_DEMO_SEED_VERSION &&
        existing.memberSignature === expectedSignature
    ) {
        const sanitized = sanitizeConversationDemoDataset(existing, mode);
        conversationDatasetMemoryCache.set(key, sanitized);
        if (JSON.stringify(sanitized) !== JSON.stringify(existing)) {
            try {
                window.localStorage.setItem(key, JSON.stringify(sanitized));
            } catch {
                // Fallback to memory cache when localStorage is unavailable or full.
            }
        }
        return sanitized;
    }

    const created = sanitizeConversationDemoDataset(buildDefaultConversationDataset(trialId), mode);
    conversationDatasetMemoryCache.set(key, created);
    try {
        window.localStorage.setItem(key, JSON.stringify(created));
    } catch {
        // Fallback to memory cache when localStorage is unavailable or full.
    }
    return created;
}

function saveConversationDemoDataset(
    trialId: string,
    dataset: LocalDemoConversationDataset,
    mode: DemoDataMode = readCurrentConversationDatasetMode()
) {
    if (typeof window === "undefined") return;
    const key = getConversationDemoStorageKey(trialId, mode);
    const sanitized = sanitizeConversationDemoDataset(dataset, mode);
    conversationDatasetMemoryCache.set(key, sanitized);
    try {
        window.localStorage.setItem(key, JSON.stringify(sanitized));
    } catch {
        // Fallback to memory cache when localStorage is unavailable or full.
    }
}

function appendConversationDemoMessage(
    trialId: string,
    conversationId: string,
    message: CollaborationMessage,
    mode: DemoDataMode = readCurrentConversationDatasetMode()
): LocalDemoConversationDataset {
    const dataset = loadOrInitConversationDataset(trialId, mode);
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

    saveConversationDemoDataset(trialId, dataset, mode);
    return dataset;
}

function findConversationForMember(
    conversations: Conversation[],
    runtimeUser: ReturnType<typeof getRuntimeUserIdentity>,
    member: DirectConversationMemberInput
) {
    const targetName = normalizeName(member.name);
    const targetEmail = normalizeDemoMemberEmail(member.email).toLowerCase();
    return conversations.find((conversation) => {
        if (conversation.type !== "direct") return false;
        const other = getOtherConversationParticipant(conversation, runtimeUser);
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

function getTrialIdFromLocalConversationId(value: string) {
    if (!isLocalConversationId(value)) return null;
    const withoutPrefix = value.slice("local-".length);
    const markerIndex = withoutPrefix.indexOf("-dm-");
    if (markerIndex <= 0) return null;
    const trialId = withoutPrefix.slice(0, markerIndex).trim();
    return trialId || null;
}

function createOrGetLocalDirectConversation(
    trialId: string,
    member: DirectConversationMemberInput,
    mode: DemoDataMode = readCurrentConversationDatasetMode()
): Conversation {
    const runtimeUser = getRuntimeUserIdentity();
    const dataset = loadOrInitConversationDataset(trialId, mode);
    if (matchesRuntimeUser(member, runtimeUser, { extraIds: [LEGACY_DEMO_SELF_USER_ID] })) {
        throw new Error("Cannot start a direct conversation with the active user.");
    }

    const existing = findConversationForMember(dataset.conversations, runtimeUser, member);
    if (existing && (mode !== "building" || isLocalConversationId(existing.id))) return existing;

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
    saveConversationDemoDataset(trialId, dataset, mode);
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

function sanitizeThreadMessage(
    message: CollaborationMessage,
    threadId: string,
    runtimeUser: ReturnType<typeof getRuntimeUserIdentity>,
    selfIdHints: Array<string | number | null | undefined>
): CollaborationMessage {
    const isSelf = matchesRuntimeUser(message, runtimeUser, {
        extraIds: selfIdHints,
        allowLegacyDemoUser: true,
    });

    return {
        ...message,
        threadId,
        senderId: isSelf ? runtimeUser.id : message.senderId,
        senderName: isSelf ? runtimeUser.name : message.senderName,
        senderEmail: isSelf ? runtimeUser.email : normalizeDemoMemberEmail(String(message.senderEmail || "").trim()) || null,
    };
}

function sanitizeThreadDemoDataset(dataset: LocalDemoThreadDataset): LocalDemoThreadDataset {
    const runtimeUser = getRuntimeUserIdentity();
    const nextMessagesByThread: Record<string, CollaborationMessage[]> = {};

    const nextThreads = dataset.threads
        .map((thread) => {
            const selfIdHints = [runtimeUser.id, thread.createdBy, LEGACY_DEMO_SELF_USER_ID];
            const normalizedParticipants = (thread.participants || []).map((participant, index) => {
                const isSelf = matchesRuntimeUser(participant, runtimeUser, {
                    extraIds: selfIdHints,
                    allowLegacyDemoUser: true,
                });

                return {
                    ...participant,
                    id: participant.id || `${thread.id}-participant-${isSelf ? runtimeUser.id : index + 1}`,
                    threadId: thread.id,
                    userId: isSelf ? runtimeUser.id : participant.userId,
                    user: {
                        id: isSelf ? runtimeUser.id : participant.user?.id ?? participant.userId,
                        name: isSelf ? runtimeUser.name : participant.user?.name || null,
                        email: isSelf
                            ? runtimeUser.email
                            : normalizeDemoMemberEmail(String(participant.user?.email || "").trim()) || null,
                    },
                };
            });

            const dedupedParticipants = normalizedParticipants.filter((participant, index, rows) => {
                const isSelf = matchesRuntimeUser(participant, runtimeUser, { extraIds: selfIdHints });
                return rows.findIndex((candidate) => {
                    if (isSelf) {
                        return matchesRuntimeUser(candidate, runtimeUser, { extraIds: selfIdHints });
                    }

                    const sameId = collaborationIdsMatch(candidate.userId, participant.userId);
                    const sameEmail =
                        normalizeStoredEmail(candidate.user?.email) &&
                        normalizeStoredEmail(candidate.user?.email) === normalizeStoredEmail(participant.user?.email);
                    const sameName =
                        normalizeName(candidate.user?.name || "") &&
                        normalizeName(candidate.user?.name || "") === normalizeName(participant.user?.name || "");
                    return sameId || sameEmail || sameName;
                }) === index;
            });

            const nextParticipants = dedupedParticipants.some((participant) =>
                matchesRuntimeUser(participant, runtimeUser, { extraIds: selfIdHints })
            )
                ? dedupedParticipants
                : [
                    {
                        id: `${thread.id}-participant-${runtimeUser.id}`,
                        threadId: thread.id,
                        userId: runtimeUser.id,
                        joinedAt: thread.createdAt,
                        lastReadAt: null,
                        user: {
                            id: runtimeUser.id,
                            name: runtimeUser.name,
                            email: runtimeUser.email,
                        },
                    },
                    ...dedupedParticipants,
                ];

            const rawMessages = dataset.messagesByThread[thread.id] || [];
            const sanitizedMessages = rawMessages.map((message) =>
                sanitizeThreadMessage(message, thread.id, runtimeUser, selfIdHints)
            );
            nextMessagesByThread[thread.id] = sanitizedMessages;

            return {
                ...thread,
                createdBy: matchesRuntimeUser({ id: thread.createdBy }, runtimeUser, { extraIds: [LEGACY_DEMO_SELF_USER_ID] })
                    ? runtimeUser.id
                    : thread.createdBy,
                participants: nextParticipants,
                updatedAt: sanitizedMessages[sanitizedMessages.length - 1]?.createdAt || thread.updatedAt,
            };
        })
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

    return {
        ...dataset,
        threads: nextThreads,
        messagesByThread: nextMessagesByThread,
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
        const sanitized = sanitizeThreadDemoDataset(existing);
        if (JSON.stringify(sanitized) !== JSON.stringify(existing)) {
            window.localStorage.setItem(key, JSON.stringify(sanitized));
        }
        return sanitized;
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
    folderCounts: { inbox: 0, unread: 0, sent: 0, draft: 0 },
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
        // if (state.dataMode === "building") {
        //     const localConversations = loadOrInitConversationDataset(trialId, state.dataMode).conversations
        //         .filter((conversation) => isLocalConversationId(String(conversation.id || "")))
        //         .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
        //     state.conversations = localConversations;
        //     if (
        //         state.activeConversationId &&
        //         !state.conversations.some((conversation) => conversation.id === state.activeConversationId)
        //     ) {
        //         state.activeConversationId = state.conversations[0]?.id || null;
        //     }
        //     state.error = null;
        //     emit();
        //     return;
        // }
        if (state.dataMode === "sample" || state.dataMode === "full") {
            state.conversations = loadOrInitConversationDataset(trialId, state.dataMode).conversations;
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
                rows = loadOrInitConversationDataset(trialId, state.dataMode).conversations;
            }
            const localOnlyRows = loadOrInitConversationDataset(trialId, state.dataMode).conversations.filter((conversation) =>
                isLocalConversationId(String(conversation.id || ""))
            );
            if (state.dataMode !== "building") {
                const localOnlyRows = loadOrInitConversationDataset(trialId, state.dataMode).conversations.filter((conversation) =>
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
                state.conversations = loadOrInitConversationDataset(trialId, state.dataMode).conversations;
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
        // if (state.dataMode === "building") {
        //     const localConversation = state.conversations.find(
        //         (conversation) => conversation.id === conversationId && isLocalConversationId(conversation.id)
        //     );
        //     if (localConversation) {
        //         const dataset = loadOrInitConversationDataset(localConversation.trialId, state.dataMode);
        //         state.messages[conversationId] = dataset.messagesByConversation[conversationId] || [];
        //     } else {
        //         state.messages[conversationId] = [];
        //     }
        //     state.error = null;
        //     emit();
        //     return;
        // }
        if (state.dataMode === "sample" || state.dataMode === "full") {
            const trialId =
                state.conversations.find((conversation) => conversation.id === conversationId)?.trialId ||
                subscribedTrialId;
            if (trialId) {
                state.messages[conversationId] =
                    loadOrInitConversationDataset(trialId, state.dataMode).messagesByConversation[conversationId] || [];
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
                const localDataset = loadOrInitConversationDataset(localConversation.trialId, state.dataMode);
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
                    rows = loadOrInitConversationDataset(trialId, state.dataMode).messagesByConversation[conversationId] || rows;
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
                    loadOrInitConversationDataset(trialId, state.dataMode).messagesByConversation[conversationId] || [];
                state.error = null;
            } else {
                state.error = error instanceof Error ? error.message : "Failed to load messages";
            }
            emit();
        }
    },
    async sendMessage(conversationId, content, embeddedContent, contentType = "text") {
        console.log("sendMessage called:", conversationId, "dataMode:", state.dataMode);
        if (!content.trim()) return;
        const runtimeUser = getRuntimeUserIdentity();
        const selfId = runtimeUser.id;
        const selfName = runtimeUser.name;
        const selfEmail = runtimeUser.email;
        const nowIso = new Date().toISOString();
        const optimistic: CollaborationMessage = {
            id: `tmp-${Date.now()}`,
            conversationId,
            threadId: null,
            emailChainId: null,
            senderId: selfId,
            senderType: "user",
            senderName: selfName,
            senderEmail: selfEmail,
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
        const localTrialId = isLocalConversationId(conversationId) ? getTrialIdFromLocalConversationId(conversationId) : null;
        const trialId = targetConversation?.trialId || localTrialId || subscribedTrialId;
        const isLocalConversation = isLocalConversationId(conversationId);

        if (state.dataMode === "sample" || state.dataMode === "full" || isLocalConversation) {
            const persisted: CollaborationMessage = {
                ...optimistic,
                id: `demo-${Date.now()}`,
                createdAt: nowIso,
            };

            if (trialId) {
                const dataset = appendConversationDemoMessage(trialId, conversationId, persisted, state.dataMode);
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
            state.activeConversationId = conversationId;
            emit();
            if (subscribedTrialId) {
                await state.loadConversations(subscribedTrialId);
            }
            state.activeConversationId = conversationId;
            emit();
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
                const dataset = appendConversationDemoMessage(trialId, conversationId, persisted, state.dataMode);
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
        // check if this member has a real profile ID
        const realProfileId = getDemoProfileId(member.name);

        if (realProfileId && state.dataMode === "building") {
            try {
                // create conversation by sending initial empty-ish message
                await collabApi.sendConversationMessage({
                    conversationId: realProfileId,
                    content: "👋",
                });
                await state.loadConversations(trialId);
                return state.conversations.find(c => c.id === realProfileId) || null;
            } catch {
                // fall through to demo
            }
        }

        // fallback to local demo conversation
        try {
            const created = createOrGetLocalDirectConversation(trialId, member, state.dataMode);
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
        // if (state.dataMode === "building") {
        //     state.threadFilters = filters ?? state.threadFilters;
        //     state.threads = [];
        //     state.activeThreadId = null;
        //     state.threadMessages = {};
        //     state.error = null;
        //     emit();
        //     return;
        // }
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
            console.log("loadThreads rows:", rows.length, rows);
            if (!rows.length && state.dataMode !== "building") {
                rows = loadOrInitThreadDataset(trialId).threads;
            }
            state.threads = rows;
            state.error = null;
        } catch (error) {
            if (isLikelyDemoConversationError(error) && state.dataMode !== "building") {
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
        // if (state.dataMode === "building") {
        //     state.threadMessages[threadId] = [];
        //     state.error = null;
        //     emit();
        //     return;
        // }
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
            const result = (await collabApi.suggestResolution(threadId)) as any;
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
        // if (state.dataMode === "building") {
        //     state.inboxConfig = {
        //         id: `building-inbox-${trialId}`,
        //         trialId,
        //         emailAddress: `${trialId}@inbox.themison.local`,
        //         isActive: false,
        //         createdAt: new Date().toISOString(),
        //     };
        //     state.emailChains = [];
        //     state.activeEmailChainId = null;
        //     state.emailMessages = {};
        //     state.error = null;
        //     emit();
        //     return;
        // }
        state.isLoading = true;
        state.error = null;
        emit();
        try {
            state.inboxConfig = (await collabApi.getInboxConfig(trialId)) as TrialInbox;
        } catch (error) {
            console.error("loadInbox error:", error);
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
    async loadFolderCounts() {
        if (!state.inboxConfig) return;
        try {
            const counts = await collabApi.getInboxCounts() as any;
            state.folderCounts = {
                inbox: counts.inbox ?? 0,
                unread: counts.unread ?? 0,
                sent: counts.sent ?? 0,
                draft: counts.draft ?? 0,
            };
            emit();
        } catch { /* noop */ }
    },
    async loadEmailChains(folder) {
        console.log("loadEmailChains called, folder:", folder, "dataMode:", state.dataMode, "inboxConfig:", state.inboxConfig);
        const selected = folder ?? state.activeFolder;
        state.activeFolder = selected;
        // if (state.dataMode === "building") {
        //     state.emailChains = [];
        //     state.activeEmailChainId = null;
        //     state.error = null;
        //     emit();
        //     return;
        // }
        if (!state.inboxConfig) return;

        const folderFilter = selected === "unread" ? "inbox" : selected;
        try {
            let rows = (await collabApi.listEmailChains({
                trialId: state.inboxConfig.trialId,
                folder: folderFilter === "inbox" || folderFilter === "sent" || folderFilter === "drafts" || folderFilter === "archived"
                    ? folderFilter
                    : undefined,
            })) as EmailChain[];
            console.log("loadEmailChains rows from BE:", rows.length, rows);

            // only fall back to demo data in sample/full mode
            if (rows.length === 0 && state.dataMode !== "building") {
                const demo = loadOrInitDemoDataset(state.inboxConfig.trialId, state.inboxConfig.emailAddress);
                rows = getChainsForFolder(demo.chains, selected);
            }

            state.emailChains = selected === "unread" ? rows.filter((row) => !row.isRead) : rows;
            console.log("state.emailChains set to:", state.emailChains.length);
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
            const created = (await collabApi.startThreadFromMessage(messageId, threadData.title, threadData.category)) as any;
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
            const created = (await collabApi.createThreadFromEmail(emailChainId, threadData.title, threadData.category)) as any;
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
                    state.loadFolderCounts(),
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

        pollTimer = window.setInterval(tick, 15000);
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

export function clearCollaborationDemoRuntimeCache() {
    conversationDatasetMemoryCache.clear();
    state.conversations = [];
    state.activeConversationId = null;
    state.messages = {};
    state.threads = [];
    state.activeThreadId = null;
    state.threadMessages = {};
    state.emailChains = [];
    state.activeEmailChainId = null;
    state.emailMessages = {};
    state.aiIsTyping = false;
    state.error = null;
    emit();
}
