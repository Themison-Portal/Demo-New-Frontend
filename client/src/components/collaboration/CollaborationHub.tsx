import { useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowLeft,
    CheckCircle2,
    ChevronDown,
    FileText,
    FlaskConical,
    Globe2,
    Inbox,
    Mail,
    MessageCircle,
    MessagesSquare,
    Plus,
    Search,
    Send,
    Settings2,
    Users2,
} from "lucide-react";
import { DemoControlsPanel } from "@/components/collaboration/DemoControlsPanel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { collabApi } from "@/lib/apiClient";
import { getInboxLabelSetting, toInboxLabelText } from "@/lib/inbox-triage-settings";
import { useCollaborationStore } from "@/stores/collaborationStore";
import { useRealtimeCollab } from "@/hooks/useRealtimeCollab";
import type { Conversation, ThreadAnchorType, ThreadCategory, ThreadFilters, ThreadStatus, TrialThread } from "@/types/collaboration";
import { ConversationView } from "@/components/collaboration/messages/ConversationView";
import { ThreadView } from "@/components/collaboration/threads/ThreadView";
import { EmailView } from "@/components/collaboration/inbox/EmailView";
import { ComposeEmail } from "@/components/collaboration/inbox/ComposeEmail";
import { InboxTriageSettingsSheet } from "@/components/collaboration/inbox/InboxTriageSettingsSheet";
import { MessageInput } from "@/components/collaboration/shared/MessageInput";
import { AddMemberPanel } from "@/components/AddMemberPanel";
import { AILabelTag } from "@/components/collaboration/shared/AILabelTag";
import { ThreadCategoryBadge } from "@/components/collaboration/threads/ThreadCategoryBadge";
import { ThreadStatusBadge } from "@/components/collaboration/threads/ThreadStatusBadge";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useDemoState, type TeamMember } from "@/contexts/DemoStateContext";
import { toast } from "sonner";

interface CollaborationHubProps {
    trialId: string;
    dataMode: "sample" | "full" | "building";
}

type DetailMode = "conversation" | "thread" | "email";

function formatTime(value: string | Date | null | undefined) {
    if (!value) return "";
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelative(value: string | Date | null | undefined) {
    if (!value) return "";
    const date = new Date(value);
    const now = Date.now();
    const diff = Math.max(1, Math.round((now - date.getTime()) / 60000));
    if (diff < 60) return `${diff}m`;
    if (diff < 24 * 60) return `${Math.round(diff / 60)}h`;
    return `${Math.round(diff / (24 * 60))}d`;
}

function initials(value: string) {
    const parts = value
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean);
    return (parts[0]?.[0] || "?") + (parts[1]?.[0] || "");
}

function normalizeLookupKey(value: string | null | undefined) {
    return String(value || "").trim().toLowerCase();
}

function isLocalConversationId(value: string | null | undefined) {
    return String(value || "").startsWith("local-");
}

function normalizeIdentityName(value: string | null | undefined) {
    return normalizeLookupKey(value)
        .replace(/\((you|me)\)/g, " ")
        .replace(/[^a-z0-9\s@._-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeIdentityEmail(value: string | null | undefined) {
    const normalized = normalizeLookupKey(value);
    if (!normalized) return "";
    const atIndex = normalized.lastIndexOf("@");
    if (atIndex <= 0 || atIndex === normalized.length - 1) return normalized;
    const localPart = normalized.slice(0, atIndex).replace(/\+.*/g, "");
    const domain = normalized.slice(atIndex + 1);
    return `${localPart}@${domain}`;
}

function normalizeComparableEmail(value: string | null | undefined) {
    const normalized = normalizeIdentityEmail(value);
    if (!normalized) return "";
    const atIndex = normalized.lastIndexOf("@");
    if (atIndex <= 0 || atIndex === normalized.length - 1) return normalized;
    const localPart = normalized.slice(0, atIndex).replace(/[._-]/g, "");
    const domain = normalized.slice(atIndex + 1);
    return `${localPart}@${domain}`;
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
    const normalizedLeft = normalizeIdentityName(left);
    const normalizedRight = normalizeIdentityName(right);
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

function idsMatch(a: number | string | null | undefined, b: number | string | null | undefined) {
    if (a == null || b == null) return false;
    const left = String(a).trim();
    const right = String(b).trim();
    return Boolean(left && right && left === right);
}

type RuntimeUserIdentity = {
    id: number;
    name: string;
    email: string;
} | null;

function isSelfConversationParticipant(
    participant: NonNullable<Conversation["participants"]>[number] | null | undefined,
    currentUserId: number | null,
    runtimeUser: RuntimeUserIdentity
) {
    if (!participant) return false;

    const participantIds = [participant.userId, participant.user?.id];
    if (currentUserId != null && participantIds.some((participantId) => idsMatch(participantId, currentUserId))) {
        return true;
    }
    if (runtimeUser?.id != null && participantIds.some((participantId) => idsMatch(participantId, runtimeUser.id))) {
        return true;
    }

    const participantEmail = normalizeIdentityEmail(participant.user?.email);
    const runtimeEmail = normalizeIdentityEmail(runtimeUser?.email);
    if (participantEmail && runtimeEmail && participantEmail === runtimeEmail) {
        return true;
    }
    const participantComparableEmail = normalizeComparableEmail(participant.user?.email);
    const runtimeComparableEmail = normalizeComparableEmail(runtimeUser?.email);
    if (
        participantComparableEmail &&
        runtimeComparableEmail &&
        participantComparableEmail === runtimeComparableEmail
    ) {
        return true;
    }

    const participantName = normalizeIdentityName(participant.user?.name);
    const runtimeName = normalizeIdentityName(runtimeUser?.name);
    if (participantName && runtimeName && participantName === runtimeName) {
        return true;
    }
    if (namesLikelyMatch(participantName, runtimeName)) {
        return true;
    }

    return participantName === "demo user";
}

const SAMPLE_STATE_STORAGE_KEY = "themison-demo-state-sample";
const SAMPLE_DEFAULT_STATE_STORAGE_KEY = "themison-demo-state-default-sample";
const COLLAB_CARD_BOTTOM_GAP_STORAGE_KEY = "ui:collab_card_bottom_gap_px";
const QUICK_CONVERSATION_INTENT_KEY = "themison:quick-conversation-intent";

function stableHash(value: string) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash;
}

function generatedAvatarDataUrl(nameOrEmail: string) {
    const seed = String(nameOrEmail || "").trim() || "TM";
    const hash = stableHash(seed.toLowerCase());
    const palettes = [
        ["#DBEAFE", "#2563EB"],
        ["#DCFCE7", "#059669"],
        ["#FCE7F3", "#DB2777"],
        ["#FEF3C7", "#D97706"],
        ["#E0E7FF", "#4F46E5"],
        ["#E0F2FE", "#0284C7"],
    ] as const;
    const [bg, fg] = palettes[hash % palettes.length];
    const label = initials(seed).slice(0, 2).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="${bg}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" fill="${fg}">${label}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getOtherConversationParticipant(
    conversation: Conversation,
    currentUserId: number | null,
    runtimeUser: RuntimeUserIdentity
) {
    const participants = conversation.participants || [];
    if (!participants.length) return null;

    const other = participants.find(
        (participant) => !isSelfConversationParticipant(participant, currentUserId, runtimeUser)
    );
    if (other) return other;

    if (currentUserId != null) {
        return participants.find((participant) => participant.userId !== currentUserId) || null;
    }
    return participants.find((participant) => participant.userId !== conversation.createdBy) || null;
}

function getConversationDisplayName(
    conversation: Conversation,
    currentUserId: number | null,
    runtimeUser: RuntimeUserIdentity
) {
    if (conversation.type === "group") {
        return conversation.name || "Group Conversation";
    }

    const participants = (conversation.participants || []).filter((participant) => participant.user?.name);
    if (!participants.length) return conversation.name || "Conversation";

    const other = getOtherConversationParticipant(conversation, currentUserId, runtimeUser);
    if (other?.user?.name) return other.user.name;

    const nonSelfByName = participants.find(
        (participant) => !isSelfConversationParticipant(participant, currentUserId, runtimeUser)
    );
    const fallback = nonSelfByName?.user?.name || conversation.name || "Conversation";
    if (namesLikelyMatch(fallback, runtimeUser?.name)) {
        return "Direct Message";
    }
    return fallback;
}

function normalizeThreadFilters(filters: ThreadFilters): ThreadFilters {
    const next: ThreadFilters = {};
    if (filters.category) next.category = filters.category;
    if (filters.status) next.status = filters.status;
    if (filters.anchorType) next.anchorType = filters.anchorType;
    return next;
}

function getTrialLabel(trial: { id: string; title?: string | null; investigationalProduct?: string | null }) {
    return (
        String(trial.investigationalProduct || "").trim() ||
        String(trial.title || "").trim() ||
        `Trial ${trial.id}`
    );
}

function getAnchorIcon(anchorType: ThreadAnchorType) {
    switch (anchorType) {
        case "document_section":
            return FileText;
        case "task":
            return CheckCircle2;
        case "visit":
            return FlaskConical;
        case "trial_wide":
            return Globe2;
        case "team_member":
            return Users2;
        case "therapeutic_area":
        default:
            return FlaskConical;
    }
}

export function CollaborationHub({ trialId, dataMode }: CollaborationHubProps) {
    const [location, navigate] = useLocation();
    const { state: demoState } = useDemoState();
    const { data: trials = [] } = trpc.trials.list.useQuery({ demoMode: dataMode });
    const setDataMode = useCollaborationStore((store) => store.setDataMode);
    const setActiveLayer = useCollaborationStore((store) => store.setActiveLayer);

    const conversations = useCollaborationStore((store) => store.conversations);
    const activeConversationId = useCollaborationStore((store) => store.activeConversationId);
    const setActiveConversation = useCollaborationStore((store) => store.setActiveConversation);
    const conversationMessagesMap = useCollaborationStore((store) => store.messages);
    const loadConversations = useCollaborationStore((store) => store.loadConversations);
    const loadConversationMessages = useCollaborationStore((store) => store.loadMessages);
    const sendConversationMessage = useCollaborationStore((store) => store.sendMessage);
    const createDirectConversationWithMember = useCollaborationStore((store) => store.createDirectConversationWithMember);
    const aiIsTyping = useCollaborationStore((store) => store.aiIsTyping);

    const threads = useCollaborationStore((store) => store.threads);
    const activeThreadId = useCollaborationStore((store) => store.activeThreadId);
    const setActiveThread = useCollaborationStore((store) => store.setActiveThread);
    const threadMessages = useCollaborationStore((store) => store.threadMessages);
    const loadThreads = useCollaborationStore((store) => store.loadThreads);
    const loadThreadMessages = useCollaborationStore((store) => store.loadThreadMessages);
    const createThread = useCollaborationStore((store) => store.createThread);
    const resolveThread = useCollaborationStore((store) => store.resolveThread);
    const requestAIResolutionSummary = useCollaborationStore((store) => store.requestAIResolutionSummary);
    const threadFilters = useCollaborationStore((store) => store.threadFilters);
    const setThreadFilters = useCollaborationStore((store) => store.setThreadFilters);

    const inboxConfig = useCollaborationStore((store) => store.inboxConfig);
    const loadInbox = useCollaborationStore((store) => store.loadInbox);
    const emailChains = useCollaborationStore((store) => store.emailChains);
    const loadEmailChains = useCollaborationStore((store) => store.loadEmailChains);
    const activeEmailChainId = useCollaborationStore((store) => store.activeEmailChainId);
    const setActiveEmailChain = useCollaborationStore((store) => store.setActiveEmailChain);
    const emailMessagesMap = useCollaborationStore((store) => store.emailMessages);
    const loadEmailMessages = useCollaborationStore((store) => store.loadEmailMessages);
    const activeFolder = useCollaborationStore((store) => store.activeFolder);
    const folderCounts = useCollaborationStore((store) => store.folderCounts);
    const setActiveFolder = useCollaborationStore((store) => store.setActiveFolder);
    const dismissAILabel = useCollaborationStore((store) => store.dismissAILabel);
    const inboxTriageSettings = useCollaborationStore((store) => store.inboxTriageSettings);
    const updateInboxTriageLabel = useCollaborationStore((store) => store.updateInboxTriageLabel);
    const setInboxTriageConfidence = useCollaborationStore((store) => store.setInboxTriageConfidence);
    const resetInboxTriageSettings = useCollaborationStore((store) => store.resetInboxTriageSettings);
    const requestAIDraft = useCollaborationStore((store) => store.requestAIDraft);
    const linkEmailToThread = useCollaborationStore((store) => store.linkEmailToThread);

    const [showCompose, setShowCompose] = useState(false);
    // const [detailMode, setDetailMode] = useState<DetailMode>("email");
    const [detailMode, setDetailMode] = useState<DetailMode>("conversation");
    const [dmSearch, setDmSearch] = useState("");
    const [triageSettingsOpen, setTriageSettingsOpen] = useState(false);
    const [isNewConversationDraft, setIsNewConversationDraft] = useState(false);
    const [newConversationQuery, setNewConversationQuery] = useState("");
    const [selectedNewConversationMemberId, setSelectedNewConversationMemberId] = useState<string | null>(null);
    const [memberPanelOpen, setMemberPanelOpen] = useState(false);
    const [memberPanelMemberId, setMemberPanelMemberId] = useState<string | null>(null);
    const [memberPanelValues, setMemberPanelValues] = useState({
        name: "",
        email: "",
        avatar: null as string | null,
        clinicalRole: "Principal Investigator",
        appRole: "Admin",
        team: "",
        site: "",
    });
    const [selectedThreadTrialId, setSelectedThreadTrialId] = useState(trialId);
    const [threadSearch, setThreadSearch] = useState("");
    const collaborationCardRef = useRef<HTMLDivElement | null>(null);
    const quickComposeHandledRef = useRef<string | null>(null);

    useEffect(() => {
        setDataMode(dataMode);
    }, [dataMode, setDataMode]);

    useRealtimeCollab(trialId);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const persistBottomGap = () => {
            const cardRect = collaborationCardRef.current?.getBoundingClientRect();
            if (!cardRect) return;
            const gap = Math.max(0, Math.round(window.innerHeight - cardRect.bottom));
            window.localStorage.setItem(COLLAB_CARD_BOTTOM_GAP_STORAGE_KEY, String(gap));
        };

        persistBottomGap();
        const timeoutId = window.setTimeout(persistBottomGap, 120);
        window.addEventListener("resize", persistBottomGap);

        return () => {
            window.clearTimeout(timeoutId);
            window.removeEventListener("resize", persistBottomGap);
        };
    }, [detailMode, showCompose]);

    useEffect(() => {
        if (trialId) {
            setSelectedThreadTrialId(trialId);
        }
    }, [trialId]);

    useEffect(() => {
        if (!trialId) return;
        let cancelled = false;

        const bootstrap = async () => {
            await Promise.all([loadConversations(trialId), loadInbox(trialId)]);
            if (cancelled) return;

            await loadEmailChains("inbox");
        };

        void bootstrap();
        return () => {
            cancelled = true;
        };
    }, [dataMode, loadConversations, loadEmailChains, loadInbox, trialId]);

    useEffect(() => {
        if (!selectedThreadTrialId) return;
        void loadThreads(selectedThreadTrialId, threadFilters);
    }, [loadThreads, selectedThreadTrialId]);

    useEffect(() => {
        if (!activeConversationId && conversations.length && !isNewConversationDraft) {
            setActiveConversation(conversations[0].id);
        }
    }, [activeConversationId, conversations, isNewConversationDraft, setActiveConversation]);

    useEffect(() => {
        if (activeConversationId) {
            void loadConversationMessages(activeConversationId);
        }
    }, [activeConversationId, loadConversationMessages]);

    useEffect(() => {
        if (!activeThreadId && threads.length) {
            setActiveThread(threads[0].id);
        }
    }, [activeThreadId, setActiveThread, threads]);

    useEffect(() => {
        if (activeThreadId) {
            void loadThreadMessages(activeThreadId);
        }
    }, [activeThreadId, loadThreadMessages]);

    useEffect(() => {
        if (inboxConfig) {
            void loadEmailChains(activeFolder);
        }
    }, [activeFolder, inboxConfig, loadEmailChains]);

    useEffect(() => {
        if (!activeEmailChainId && emailChains.length) {
            setActiveEmailChain(emailChains[0].id);
        }
    }, [activeEmailChainId, emailChains, setActiveEmailChain]);

    useEffect(() => {
        if (activeEmailChainId) {
            void loadEmailMessages(activeEmailChainId);
        }
    }, [activeEmailChainId, loadEmailMessages]);

    useEffect(() => {
        if (dataMode === "building") return;
        if (detailMode === "conversation" && !activeConversationId && activeThreadId && !isNewConversationDraft) {
            setDetailMode("thread");
            return;
        }
        if (detailMode === "thread" && !activeThreadId && activeEmailChainId) {
            setDetailMode("email");
            return;
        }
        if (detailMode === "email" && !activeEmailChainId && activeConversationId) {
            setDetailMode("conversation");
        }
    }, [activeConversationId, activeEmailChainId, activeThreadId, dataMode, detailMode, isNewConversationDraft]);

    const activeConversation = useMemo(
        () => conversations.find((conversation) => conversation.id === activeConversationId) || null,
        [activeConversationId, conversations]
    );

    const activeThread = useMemo<TrialThread | null>(
        () => threads.find((thread) => thread.id === activeThreadId) || null,
        [activeThreadId, dataMode, threads]
    );
    const activeThreadTrialId = activeThread?.trialId || selectedThreadTrialId || trialId;

    const threadTrialOptions = useMemo(() => {
        const options = (trials || [])
            .map((trial) => {
                const id = String(trial.id || "").trim();
                if (!id) return null;
                return {
                    id,
                    label: getTrialLabel({
                        id,
                        title: typeof trial.title === "string" ? trial.title : null,
                        investigationalProduct:
                            typeof trial.investigationalProduct === "string" ? trial.investigationalProduct : null,
                    }),
                };
            })
            .filter((trial): trial is { id: string; label: string } => Boolean(trial));

        if (!options.some((option) => option.id === trialId) && trialId) {
            options.unshift({ id: trialId, label: "Current Trial" });
        }

        return options;
    }, [trialId, trials]);

    const baseRuntimeUser = useMemo(() => {
        if (typeof window === "undefined") {
            return { id: 7101, name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
        }
        try {
            const raw = window.localStorage.getItem("manus-runtime-user-info");
            if (!raw) {
                return { id: 7101, name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
            }
            const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown; email?: unknown };
            const id = Number(parsed?.id);
            return {
                id: Number.isFinite(id) ? id : 7101,
                name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : "Kaleb Sanders",
                email:
                    typeof parsed.email === "string" && parsed.email.trim() ? parsed.email.trim() : "kaleb.s@azorg.be",
            };
        } catch {
            return { id: 7101, name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
        }
    }, []);

    const effectiveRuntimeMember = useMemo(() => {
        const members = demoState.teamMembers || [];
        if (!members.length) return null;

        const runtimeEmail = normalizeComparableEmail(baseRuntimeUser.email);
        const matchedByEmail = members.find(
            (member) => normalizeComparableEmail(member.email) === runtimeEmail
        );
        if (matchedByEmail) return matchedByEmail;

        const matchedByName = members.find((member) =>
            namesLikelyMatch(member.name, baseRuntimeUser.name)
        );
        return matchedByName || members[0] || null;
    }, [baseRuntimeUser.email, baseRuntimeUser.name, demoState.teamMembers]);

    const runtimeUser = useMemo(
        () => ({
            id: baseRuntimeUser.id,
            name: effectiveRuntimeMember?.name || baseRuntimeUser.name,
            email: effectiveRuntimeMember?.email || baseRuntimeUser.email,
        }),
        [baseRuntimeUser.id, baseRuntimeUser.name, baseRuntimeUser.email, effectiveRuntimeMember?.name, effectiveRuntimeMember?.email]
    );

    const currentUserId = runtimeUser?.id ?? null;

    const memberAvatarIndex = useMemo(() => {
        const byName = new Map<string, string>();
        const byEmail = new Map<string, string>();
        (demoState.teamMembers || []).forEach((member) => {
            const avatar = String(member.avatar || "").trim();
            if (!avatar) return;
            const normalizedName = normalizeLookupKey(member.name);
            const normalizedEmail = normalizeLookupKey(member.email);
            if (normalizedName) byName.set(normalizedName, avatar);
            if (normalizedEmail) byEmail.set(normalizedEmail, avatar);
        });
        return { byName, byEmail };
    }, [demoState.teamMembers]);

    const sampleAvatarPool = useMemo(() => {
        if (typeof window === "undefined") return [] as string[];

        const collect = (storageKey: string) => {
            try {
                const raw = window.localStorage.getItem(storageKey);
                if (!raw) return [] as string[];
                const parsed = JSON.parse(raw) as { teamMembers?: Array<{ avatar?: string | null }> };
                if (!Array.isArray(parsed.teamMembers)) return [] as string[];
                return parsed.teamMembers
                    .map((member) => String(member?.avatar || "").trim())
                    .filter((avatar) => avatar.length > 0);
            } catch {
                return [] as string[];
            }
        };

        return Array.from(
            new Set([
                ...collect(SAMPLE_STATE_STORAGE_KEY),
                ...collect(SAMPLE_DEFAULT_STATE_STORAGE_KEY),
            ])
        );
    }, [dataMode, demoState.teamMembers.length]);

    const resolveSampleAvatarFallback = (seed: string) => {
        if (!sampleAvatarPool.length) return null;
        const index = stableHash(seed.toLowerCase()) % sampleAvatarPool.length;
        return sampleAvatarPool[index] || null;
    };

    const resolveMemberAvatar = (name?: string | null, email?: string | null) => {
        const emailKey = normalizeLookupKey(email);
        if (emailKey && memberAvatarIndex.byEmail.has(emailKey)) {
            return memberAvatarIndex.byEmail.get(emailKey) || null;
        }
        const nameKey = normalizeLookupKey(name);
        if (nameKey && memberAvatarIndex.byName.has(nameKey)) {
            return memberAvatarIndex.byName.get(nameKey) || null;
        }
        const fallbackSeed = String(name || email || "").trim();
        if (!fallbackSeed) return null;
        return resolveSampleAvatarFallback(fallbackSeed) || generatedAvatarDataUrl(fallbackSeed);
    };

    const resolveConversationAvatar = (conversation: Conversation) => {
        const otherParticipant = getOtherConversationParticipant(conversation, currentUserId, runtimeUser);
        return resolveMemberAvatar(otherParticipant?.user?.name, otherParticipant?.user?.email);
    };

    const visibleConversations = useMemo(() => {
        return conversations.filter((conversation) => {
            // if (dataMode === "building" && !isLocalConversationId(conversation.id)) {
            //     return false;
            // }
            if (conversation.type !== "direct") return true;
            const otherParticipant = getOtherConversationParticipant(conversation, currentUserId, runtimeUser);
            if (!otherParticipant) return false;

            const selfName = normalizeIdentityName(runtimeUser?.name);
            const selfEmail = normalizeComparableEmail(runtimeUser?.email);
            const otherName = normalizeIdentityName(otherParticipant.user?.name);
            const otherEmail = normalizeComparableEmail(otherParticipant.user?.email);

            if (otherEmail && selfEmail && otherEmail === selfEmail) return false;
            if (namesLikelyMatch(otherName, selfName)) return false;
            return true;
        });
    }, [conversations, currentUserId, dataMode, runtimeUser?.email, runtimeUser?.name]);

    const filteredConversations = useMemo(() => {
        const normalized = dmSearch.trim().toLowerCase();
        if (!normalized) return visibleConversations;
        return visibleConversations.filter((conversation) => {
            const name = getConversationDisplayName(conversation, currentUserId, runtimeUser).toLowerCase();
            const preview = String(conversation.lastMessage?.content || "").toLowerCase();
            return `${name} ${preview}`.includes(normalized);
        });
    }, [currentUserId, dmSearch, runtimeUser, visibleConversations]);

    useEffect(() => {
        if (isNewConversationDraft) return;
        if (!visibleConversations.length) return;
        if (!activeConversationId || !visibleConversations.some((conversation) => conversation.id === activeConversationId)) {
            setActiveConversation(visibleConversations[0].id);
        }
    }, [activeConversationId, isNewConversationDraft, setActiveConversation, visibleConversations]);

    const availableMembers = useMemo(() => {
        return (demoState.teamMembers || [])
            .filter((member) => {
                const selfName = normalizeLookupKey(runtimeUser?.name);
                const selfEmail = normalizeLookupKey(runtimeUser?.email);
                const memberName = normalizeLookupKey(member.name);
                const memberEmail = normalizeLookupKey(member.email);
                if (!memberName) return false;
                if (memberName === selfName) return false;
                if (selfEmail && memberEmail === selfEmail) return false;
                return true;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [demoState.teamMembers, runtimeUser?.email, runtimeUser?.name]);

    const filteredMembers = useMemo(() => {
        const normalized = newConversationQuery.trim().toLowerCase();
        if (!normalized) return availableMembers;
        return availableMembers.filter((member) => {
            const haystack = `${member.name} ${member.email} ${member.role}`.toLowerCase();
            return haystack.includes(normalized);
        });
    }, [availableMembers, newConversationQuery]);

    const selectedNewConversationMember = useMemo(
        () =>
            selectedNewConversationMemberId
                ? availableMembers.find((member) => String(member.id) === selectedNewConversationMemberId) || null
                : null,
        [availableMembers, selectedNewConversationMemberId]
    );

    const collaborationRouteParams = useMemo(() => {
        const params = new URLSearchParams(
            typeof window !== "undefined" ? window.location.search : ""
        );
        return {
            layer: params.get("layer"),
            compose: params.get("compose"),
            memberId: params.get("memberId"),
        };
    }, [location]);

    const openNewConversationDraft = () => {
        setShowCompose(false);
        setDetailMode("conversation");
        setActiveLayer("messages");
        setIsNewConversationDraft(true);
        setActiveConversation(null);
        setSelectedNewConversationMemberId(null);
        setNewConversationQuery("");
    };

    useEffect(() => {
        const hasRouteIntent =
            collaborationRouteParams.layer === "messages" || collaborationRouteParams.compose === "new";
        let fallbackMemberId = "";

        if (typeof window !== "undefined") {
            try {
                const raw = window.localStorage.getItem(QUICK_CONVERSATION_INTENT_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw) as { memberId?: unknown; at?: unknown; layer?: unknown; compose?: unknown };
                    const intentAgeMs = typeof parsed.at === "number" ? Date.now() - parsed.at : Number.POSITIVE_INFINITY;
                    if (
                        intentAgeMs <= 5 * 60 * 1000 &&
                        (parsed.layer === "messages" || parsed.compose === "new")
                    ) {
                        fallbackMemberId = typeof parsed.memberId === "string" ? parsed.memberId : "";
                    }
                }
            } catch {
                fallbackMemberId = "";
            }
        }

        if (!hasRouteIntent && !fallbackMemberId) {
            return;
        }

        if (collaborationRouteParams.layer === "messages" || fallbackMemberId) {
            setActiveLayer("messages");
            setDetailMode("conversation");
            setShowCompose(false);
        }

        const memberId = String(collaborationRouteParams.memberId || fallbackMemberId || "").trim();
        if (!memberId) return;
        if (quickComposeHandledRef.current === memberId) return;

        const targetMember = availableMembers.find((member) => member.id === memberId);
        if (!targetMember) return;

        const targetEmail = normalizeLookupKey(targetMember.email);
        const targetName = normalizeLookupKey(targetMember.name);
        const existingConversation = conversations.find((conversation) => {
            // if (dataMode === "building" && !isLocalConversationId(conversation.id)) return false;
            if (conversation.type !== "direct") return false;
            const other = getOtherConversationParticipant(conversation, currentUserId, runtimeUser);
            if (!other) return false;
            const otherEmail = normalizeLookupKey(other.user?.email);
            const otherName = normalizeLookupKey(other.user?.name);
            if (targetEmail && otherEmail === targetEmail) return true;
            return Boolean(targetName && otherName === targetName);
        });

        setActiveLayer("messages");
        setDetailMode("conversation");
        setShowCompose(false);

        if (existingConversation) {
            setIsNewConversationDraft(false);
            setSelectedNewConversationMemberId(null);
            setNewConversationQuery("");
            setActiveConversation(existingConversation.id);
        } else {
            setIsNewConversationDraft(true);
            setActiveConversation(null);
            setSelectedNewConversationMemberId(String(targetMember.id));
            setNewConversationQuery("");
        }

        quickComposeHandledRef.current = memberId;
        if (typeof window !== "undefined") {
            try {
                window.localStorage.removeItem(QUICK_CONVERSATION_INTENT_KEY);
            } catch {
                // Ignore storage failures.
            }
        }
    }, [availableMembers, collaborationRouteParams, conversations, currentUserId, dataMode, runtimeUser, setActiveConversation, setActiveLayer]);

    const selectDraftMember = (member: TeamMember) => {
        setSelectedNewConversationMemberId(String(member.id));
        setNewConversationQuery("");
    };

    const clearDraftMember = () => {
        setSelectedNewConversationMemberId(null);
        setNewConversationQuery("");
    };

    const openMemberProfile = (member: TeamMember) => {
        setMemberPanelMemberId(member.id);
        setMemberPanelValues({
            name: member.name,
            email: member.email,
            avatar: member.avatar || null,
            clinicalRole: member.clinicalRole || member.role || "Principal Investigator",
            appRole: member.appRole || "Admin",
            team: member.team || "",
            site: member.site || "",
        });
        setMemberPanelOpen(true);
    };

    const sendFirstDirectMessage = async (
        contentOrPayload:
            | string
            | {
                content: string;
                contentType: "protocol_snippet" | "task_card";
                embeddedContent: Record<string, unknown>;
            }
    ) => {
        const payload =
            typeof contentOrPayload === "string"
                ? { content: contentOrPayload, contentType: "text" as const, embeddedContent: undefined }
                : contentOrPayload;

        if (!selectedNewConversationMember) {
            toast.error("Select a team member first.");
            return;
        }

        try {
            const selectedEmail = normalizeLookupKey(selectedNewConversationMember.email);
            const selectedName = normalizeLookupKey(selectedNewConversationMember.name);
            const existing = conversations.find((conversation) => {
                // if (dataMode === "building" && !isLocalConversationId(conversation.id)) return false;
                if (conversation.type !== "direct") return false;
                const other = getOtherConversationParticipant(conversation, currentUserId, runtimeUser);
                if (!other) return false;
                const otherEmail = normalizeLookupKey(other.user?.email);
                const otherName = normalizeLookupKey(other.user?.name);
                if (selectedEmail && otherEmail === selectedEmail) return true;
                return selectedName && otherName === selectedName;
            });

            const created =
                existing ||
                (await createDirectConversationWithMember(trialId, {
                    id: selectedNewConversationMember.id,
                    name: selectedNewConversationMember.name,
                    email: selectedNewConversationMember.email,
                }));
            if (!created) {
                toast.error("Could not start conversation with this member.");
                return;
            }

            // Move to the conversation view immediately so send can't leave the user stuck in draft mode.
            selectConversation(created.id);
            setIsNewConversationDraft(false);
            setSelectedNewConversationMemberId(null);
            setNewConversationQuery("");
            await sendConversationMessage(created.id, payload.content, payload.embeddedContent, payload.contentType);
            void loadConversationMessages(created.id);
        } catch (error) {
            console.error(error);
            toast.error("Could not send message. Please try again.");
        }
    };

    const sortedEmailChains = useMemo(
        () => [...emailChains].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
        [dataMode, emailChains]
    );

    const sortedThreads = useMemo(
        () => [...threads].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
        [dataMode, threads]
    );

    const visibleThreads = useMemo(() => {
        const byAnchor = threadFilters.anchorType
            ? sortedThreads.filter((thread) =>
                (thread.anchors || []).some((anchor) => anchor.anchorType === threadFilters.anchorType)
            )
            : sortedThreads;

        const normalized = threadSearch.trim().toLowerCase();
        if (!normalized) return byAnchor;

        return byAnchor.filter((thread) => {
            const anchors = (thread.anchors || []).map((anchor) => anchor.anchorLabel).join(" ");
            const haystack = `${thread.title} ${thread.category} ${thread.status} ${anchors}`.toLowerCase();
            return haystack.includes(normalized);
        });
    }, [sortedThreads, threadFilters.anchorType, threadSearch]);

    useEffect(() => {
        if (!visibleThreads.length) return;
        if (!activeThreadId || !visibleThreads.some((thread) => thread.id === activeThreadId)) {
            setActiveThread(visibleThreads[0].id);
        }
    }, [activeThreadId, setActiveThread, visibleThreads]);

    const threadPreviewMembers = useMemo(() => {
        const source = availableMembers.length ? availableMembers : demoState.teamMembers;
        return source.filter((member) => normalizeLookupKey(member.name) !== normalizeLookupKey(runtimeUser?.name));
    }, [availableMembers, demoState.teamMembers, runtimeUser?.name]);

    const getThreadCardMembers = (thread: TrialThread) => {
        const participantMembers = (thread.participants || [])
            .map((participant) => {
                const name = participant.user?.name || "";
                const email = participant.user?.email || "";
                if (!name && !email) return null;
                return {
                    id: `${thread.id}-participant-${participant.userId}`,
                    name: name || email,
                    email,
                    avatar: resolveMemberAvatar(name, email),
                };
            })
            .filter(
                (member): member is { id: string; name: string; email: string; avatar: string | null } => Boolean(member)
            );

        if (participantMembers.length) {
            const nonSelf = participantMembers.filter(
                (member) => normalizeLookupKey(member.email) !== normalizeLookupKey(runtimeUser?.email)
            );
            const self = participantMembers.find(
                (member) => normalizeLookupKey(member.email) === normalizeLookupKey(runtimeUser?.email)
            );
            const ordered = [...nonSelf, ...(self ? [self] : [])];
            return ordered.slice(0, 3);
        }

        const rows = threadMessages[thread.id] || [];
        const bySender = new Map<string, { id: string; name: string; email: string; avatar: string | null }>();
        rows.forEach((message, index) => {
            if (!message.senderName) return;
            const key = `${message.senderId ?? "no-id"}-${normalizeLookupKey(message.senderEmail)}-${normalizeLookupKey(message.senderName)}`;
            if (bySender.has(key)) return;
            bySender.set(key, {
                id: `${thread.id}-sender-${index}`,
                name: message.senderName,
                email: message.senderEmail || "",
                avatar: resolveMemberAvatar(message.senderName, message.senderEmail),
            });
        });
        if (bySender.size) {
            const senderRows = Array.from(bySender.values());
            const nonSelf = senderRows.filter((member) => normalizeLookupKey(member.email) !== normalizeLookupKey(runtimeUser?.email));
            const self = senderRows.find((member) => normalizeLookupKey(member.email) === normalizeLookupKey(runtimeUser?.email));
            const ordered = [...nonSelf, ...(self ? [self] : [])];
            return ordered.slice(0, 3);
        }

        return threadPreviewMembers.slice(0, 3).map((member) => ({
            id: `${thread.id}-fallback-${member.id}`,
            name: member.name,
            email: member.email,
            avatar: member.avatar || resolveMemberAvatar(member.name, member.email),
        }));
    };

    const updateThreadCategoryFilter = (value: string) => {
        const next = normalizeThreadFilters({
            ...threadFilters,
            category: value ? (value as ThreadCategory) : undefined,
        });
        setThreadFilters(next);
        if (activeThreadTrialId) {
            void loadThreads(activeThreadTrialId, next);
        }
    };

    const updateThreadStatusFilter = (value: string) => {
        const next = normalizeThreadFilters({
            ...threadFilters,
            status: value ? (value as ThreadStatus) : undefined,
        });
        setThreadFilters(next);
        if (activeThreadTrialId) {
            void loadThreads(activeThreadTrialId, next);
        }
    };

    const updateThreadAnchorFilter = (value: string) => {
        const next = normalizeThreadFilters({
            ...threadFilters,
            anchorType: value ? (value as ThreadAnchorType) : undefined,
        });
        setThreadFilters(next);
    };

    const activeEmailChain = useMemo(
        () => sortedEmailChains.find((chain) => chain.id === activeEmailChainId) || null,
        [activeEmailChainId, sortedEmailChains]
    );

    const inboxCounts = useMemo(() => {
        const inbox = folderCounts?.inbox ?? 0;
        const unread = folderCounts?.unread ?? 0;
        const sent = folderCounts?.sent ?? 0;
        const drafts = folderCounts?.draft ?? 0;

        return { unread, sent, drafts, inbox };
    }, [emailChains]);

    const visibleLabelsForChain = (labels: string[] | null | undefined) =>
        (labels || []).filter((label) => getInboxLabelSetting(inboxTriageSettings, label)?.enabled ?? true);

    const folderTabs = [
        { key: "inbox", label: "Inbox", count: inboxCounts.inbox, icon: Inbox },
        { key: "unread", label: "Unread", count: inboxCounts.unread, icon: Mail },
        { key: "sent", label: "Sent", count: inboxCounts.sent, icon: Send },
        { key: "drafts", label: "Draft", count: inboxCounts.drafts, icon: FileText },
    ] as const;

    const activeFolderLabel = folderTabs.find((tab) => tab.key === activeFolder)?.label || "Inbox";
    const isInboxMode = detailMode === "email";

    useEffect(() => {
        if (!isInboxMode) return;
        if (!sortedEmailChains.length) return;
        if (!activeEmailChainId || !sortedEmailChains.some((chain) => chain.id === activeEmailChainId)) {
            setActiveEmailChain(sortedEmailChains[0].id);
        }
    }, [activeEmailChainId, isInboxMode, setActiveEmailChain, sortedEmailChains]);

    const createQuickThread = async () => {
        if (!activeThreadTrialId) return;
        const title = window.prompt("Thread title")?.trim();
        if (!title) return;
        const category = (
            window.prompt(
                "Category (question/decision/issue/action_required/approval/clarification)",
                "question"
            ) || "question"
        ) as ThreadCategory;
        await createThread({ trialId: activeThreadTrialId, title, category });
        await loadThreads(activeThreadTrialId, threadFilters);
    };

    const sendThreadMessage = async (content: string) => {
        if (!activeThreadId || !activeThreadTrialId) return;
        await collabApi.addThreadMessage({ threadId: activeThreadId, content });
        await loadThreadMessages(activeThreadId);
        await loadThreads(activeThreadTrialId, threadFilters);
    };

    const resolveActiveThread = async (summary: string, useAiSummary: boolean) => {
        if (!activeThreadId || !activeThreadTrialId) return;
        await collabApi.resolveThread(activeThreadId, summary, useAiSummary);
        await loadThreads(activeThreadTrialId, threadFilters);
        await loadThreadMessages(activeThreadId);
    };

    const requestThreadSummary = async () => {
        if (!activeThreadId) return "";
        return requestAIResolutionSummary(activeThreadId);
    };

    const replyEmail = async (content: string, aiMeta?: { generated: boolean; editedDistance?: number }) => {
        if (!activeEmailChainId) return;
        await collabApi.replyEmail({ chainId: activeEmailChainId, content, aiDraftMeta: aiMeta });
        await loadEmailMessages(activeEmailChainId);
        await loadEmailChains(activeFolder);
    };

    const sendComposedEmail = async (input: { to: string[]; cc: string[]; subject: string; body: string }) => {
        console.log("inboxConfig:", inboxConfig);
        console.log("input:", input);
        if (!inboxConfig) return;
        await collabApi.composeEmail({ trialId: inboxConfig.trialId, ...input });
        setShowCompose(false);
        setDetailMode("email");
        setActiveLayer("inbox");
        setActiveFolder("sent");
        await new Promise(resolve => setTimeout(resolve, 500)); // wait for BE
        await loadEmailChains("sent");
    };

    const selectEmail = (emailChainId: string) => {
        setShowCompose(false);
        setIsNewConversationDraft(false);
        setDetailMode("email");
        setActiveLayer("inbox");
        setActiveEmailChain(emailChainId);
    };

    const selectConversation = (conversationId: string) => {
        setShowCompose(false);
        setIsNewConversationDraft(false);
        setSelectedNewConversationMemberId(null);
        setNewConversationQuery("");
        setDetailMode("conversation");
        setActiveLayer("messages");
        setActiveConversation(conversationId);
    };

    const selectThread = (threadId: string) => {
        setShowCompose(false);
        setIsNewConversationDraft(false);
        setDetailMode("thread");
        setActiveLayer("threads");
        setActiveThread(threadId);
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="shrink-0">
                <div className="flex h-11 items-center gap-6 rounded-md border border-gray-200 bg-white px-5 py-0">
                    <button
                        type="button"
                        onClick={() => navigate("/trial-workspace")}
                        className="flex items-center gap-2 border-r border-gray-200 pr-5 text-xs text-gray-500 transition-colors hover:text-gray-700"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <span>All Trials</span>
                    </button>

                    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                        <button
                            type="button"
                            onClick={() => {
                                setShowCompose(false);
                                setIsNewConversationDraft(false);
                                setDetailMode("email");
                                setActiveLayer("inbox");
                            }}
                            className={cn(
                                "flex items-center gap-2 whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors",
                                detailMode === "email"
                                    ? "bg-blue-50 text-blue-700"
                                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                            )}
                        >
                            <Inbox className="h-4 w-4" />
                            <span>Inbox</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setShowCompose(false);
                                setIsNewConversationDraft(false);
                                setDetailMode("conversation");
                                setActiveLayer("messages");
                            }}
                            className={cn(
                                "flex items-center gap-2 whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors",
                                detailMode === "conversation"
                                    ? "bg-blue-50 text-blue-700"
                                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                            )}
                        >
                            <MessageCircle className="h-4 w-4" />
                            <span>Messages</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setShowCompose(false);
                                setIsNewConversationDraft(false);
                                setDetailMode("thread");
                                setActiveLayer("threads");
                            }}
                            className={cn(
                                "flex items-center gap-2 whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors",
                                detailMode === "thread"
                                    ? "bg-blue-50 text-blue-700"
                                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                            )}
                        >
                            <MessagesSquare className="h-4 w-4" />
                            <span>Threads</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="min-h-0 flex-1">
                <div
                    ref={collaborationCardRef}
                    className="flex h-full min-h-0 overflow-hidden rounded-lg border border-gray-200 bg-white"
                >
                    {isInboxMode ? (
                        <>
                            <aside className="flex w-[200px] min-w-[200px] flex-col border-r border-gray-100 bg-white">
                                <div className="h-[56px] border-b border-gray-100 px-4">
                                    <div className="flex h-full items-center justify-between gap-2">
                                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400">Folders</h3>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowCompose(true);
                                                setDetailMode("email");
                                                setActiveLayer("inbox");
                                            }}
                                            className="inline-flex h-7 items-center justify-center rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition-colors duration-150 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                                        >
                                            + New
                                        </button>
                                    </div>
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                                    {folderTabs.map((folder) => (
                                        <button
                                            key={folder.key}
                                            type="button"
                                            onClick={() => {
                                                setShowCompose(false);
                                                setActiveFolder(folder.key);
                                                setDetailMode("email");
                                                setActiveLayer("inbox");
                                                void loadEmailChains(folder.key);
                                            }}
                                            className={cn(
                                                "mb-1 flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
                                                activeFolder === folder.key
                                                    ? "bg-blue-50 font-semibold text-blue-600"
                                                    : "font-medium text-gray-700 hover:bg-gray-50"
                                            )}
                                        >
                                            <span className="inline-flex items-center gap-2.5">
                                                <folder.icon
                                                    className={cn(
                                                        "h-[18px] w-[18px]",
                                                        activeFolder === folder.key ? "text-blue-600" : "text-gray-500"
                                                    )}
                                                />
                                                {folder.label}
                                            </span>
                                            <span
                                                className={cn(
                                                    "text-xs font-semibold",
                                                    activeFolder === folder.key ? "text-blue-600" : "text-gray-500"
                                                )}
                                            >
                                                {folder.count}
                                            </span>
                                        </button>
                                    ))}
                                </div>

                                <div className="border-t border-gray-100 px-4 py-4">
                                    <button
                                        type="button"
                                        onClick={() => setTriageSettingsOpen(true)}
                                        className="inline-flex items-center gap-2 text-[13px] text-gray-500 transition-colors duration-150 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                                    >
                                        <Settings2 className="h-3.5 w-3.5" />
                                        Themison AI Triage
                                    </button>
                                </div>
                            </aside>

                            <aside className="flex w-[320px] min-w-[320px] flex-col border-r border-gray-100 bg-white">
                                <div className="h-[56px] border-b border-gray-100 px-4">
                                    <div className="flex h-full items-center justify-between">
                                        <h3 className="text-base font-semibold text-gray-900">{activeFolderLabel}</h3>
                                        <span className="text-[13px] text-gray-400">{sortedEmailChains.length} items</span>
                                    </div>
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto">
                                    {sortedEmailChains.length === 0 ? (
                                        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                                            <p className="text-sm font-medium text-gray-900">
                                                No conversations in {activeFolderLabel.toLowerCase()}.
                                            </p>
                                            <p className="mt-1 text-[13px] text-gray-500">No conversations yet.</p>
                                        </div>
                                    ) : (
                                        sortedEmailChains.map((chain) => {
                                            const chainLabels = visibleLabelsForChain(chain.aiLabels);
                                            const selected = activeEmailChainId === chain.id && !showCompose;
                                            const preview = chain.aiSummary || chain.messages?.[0]?.content || "No preview available";
                                            const sender = chain.fromName || chain.fromAddress || "Unknown sender";
                                            const senderClass = chain.isRead
                                                ? "font-normal text-gray-500"
                                                : "font-semibold text-gray-900";
                                            const subjectClass = chain.isRead
                                                ? "font-medium text-gray-700"
                                                : "font-semibold text-gray-900";

                                            return (
                                                <button
                                                    key={chain.id}
                                                    type="button"
                                                    onClick={() => selectEmail(chain.id)}
                                                    className={cn(
                                                        "group relative w-full border-b border-gray-100 px-4 py-[14px] text-left transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset",
                                                        selected ? "bg-blue-50" : "hover:bg-gray-50"
                                                    )}
                                                >
                                                    {selected ? <span className="absolute inset-y-0 left-0 w-[3px] bg-blue-600" aria-hidden="true" /> : null}
                                                    <div className="flex items-start justify-between gap-2">
                                                        <p className={cn("line-clamp-1 text-sm", senderClass)}>{sender}</p>
                                                        <span className="shrink-0 text-xs text-gray-400">{formatRelative(chain.updatedAt)}</span>
                                                    </div>
                                                    <p className={cn("mt-1 line-clamp-1 text-[13px]", subjectClass)}>{chain.subject}</p>
                                                    <p className="mt-1 line-clamp-1 text-[13px] text-gray-400">{preview}</p>
                                                    <p className="mt-1 text-xs text-gray-400">
                                                        {chain.messageCount} · To: {chain.toAddresses?.length || 0} · CC: {chain.ccAddresses?.length || 0}
                                                    </p>
                                                    {chainLabels.length > 0 ? (
                                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                                            {chainLabels.slice(0, 3).map((label) => {
                                                                const labelConfig = getInboxLabelSetting(inboxTriageSettings, label);
                                                                return (
                                                                    <AILabelTag
                                                                        key={`${chain.id}-${label}`}
                                                                        label={label}
                                                                        displayName={labelConfig?.displayName || toInboxLabelText(label)}
                                                                        color={labelConfig?.color}
                                                                        textColor={labelConfig?.textColor}
                                                                        onDismiss={() => {
                                                                            void dismissAILabel(chain.id, label);
                                                                        }}
                                                                    />
                                                                );
                                                            })}
                                                            {chainLabels.length > 3 ? (
                                                                <span className="rounded-full border border-gray-200 bg-white px-2 py-[3px] text-[11px] text-gray-500">
                                                                    +{chainLabels.length - 3}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    ) : null}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </aside>

                            <main className="min-w-0 flex-1 bg-white">
                                {showCompose ? (
                                    <div className="h-full overflow-y-auto p-6">
                                        <div className="mx-auto max-w-[800px]">
                                            <ComposeEmail
                                                onSend={sendComposedEmail}
                                                onDraftWithAI={async (instructions) => {
                                                    if (!activeEmailChainId) {
                                                        return {
                                                            subject: "",
                                                            body: "",
                                                            protocol_refs: [],
                                                        };
                                                    }
                                                    return requestAIDraft(activeEmailChainId, instructions);
                                                }}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <EmailView
                                        chain={activeEmailChain}
                                        messages={activeEmailChainId ? emailMessagesMap[activeEmailChainId] || [] : []}
                                        onReply={replyEmail}
                                        onDraftWithAI={(instructions) =>
                                            activeEmailChainId
                                                ? requestAIDraft(activeEmailChainId, instructions)
                                                : Promise.resolve({ subject: "", body: "", protocol_refs: [] })
                                        }
                                        onLinkThread={async (threadId) => {
                                            if (!activeEmailChainId) return;
                                            await linkEmailToThread(activeEmailChainId, threadId);
                                        }}
                                    />
                                )}
                            </main>
                        </>
                    ) : null}

                    {detailMode === "conversation" ? (
                        <>
                            <aside className="flex w-[324px] min-w-[324px] flex-col border-r border-gray-200 bg-white">
                                <section className="border-b border-gray-200 px-3 py-3">
                                    <div className="mb-2 flex items-center justify-between">
                                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-600">
                                            Direct Messages
                                        </h3>
                                        <button
                                            type="button"
                                            onClick={openNewConversationDraft}
                                            className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            New
                                        </button>
                                    </div>
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                        <input
                                            value={dmSearch}
                                            onChange={(event) => setDmSearch(event.target.value)}
                                            placeholder="Search messages"
                                            className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                        />
                                    </div>
                                </section>

                                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
                                    {filteredConversations.slice(0, 24).map((conversation) => {
                                        const displayName = getConversationDisplayName(conversation, currentUserId, runtimeUser);
                                        const selected = activeConversationId === conversation.id;
                                        const unread = conversation.unreadCount || 0;
                                        const avatarSrc = resolveConversationAvatar(conversation);
                                        return (
                                            <button
                                                key={conversation.id}
                                                type="button"
                                                onClick={() => selectConversation(conversation.id)}
                                                className={cn(
                                                    "w-full rounded-md border px-2.5 py-2.5 text-left transition-colors duration-150 focus:outline-none focus-visible:outline-none",
                                                    selected ? "border-gray-200 bg-gray-100" : "border-transparent hover:bg-gray-50"
                                                )}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="relative mt-0.5">
                                                        <Avatar className="h-12 w-12 rounded-lg border border-gray-200 bg-gray-100">
                                                            <AvatarImage src={avatarSrc || undefined} alt={displayName} className="rounded-lg object-cover" />
                                                            <AvatarFallback className="rounded-lg text-sm font-semibold text-gray-700">
                                                                {initials(displayName)}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="truncate text-sm font-semibold leading-tight text-gray-900">
                                                                {displayName}
                                                            </p>
                                                            <span className="text-[11px] font-semibold text-gray-600">
                                                                {formatTime(conversation.lastMessage?.createdAt)}
                                                            </span>
                                                        </div>
                                                        <div className="mt-0.5 flex items-start justify-between gap-2">
                                                            <p className="line-clamp-1 text-[11px] text-gray-600">
                                                                {conversation.lastMessage?.content || "No messages yet"}
                                                            </p>
                                                            {unread > 0 ? (
                                                                <span
                                                                    className={cn(
                                                                        "inline-flex h-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-semibold leading-none text-white",
                                                                        unread > 9 ? "min-w-5 px-1.5" : "w-5"
                                                                    )}
                                                                >
                                                                    {unread}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </aside>

                            <main className="min-w-0 flex-1 bg-white">
                                {isNewConversationDraft ? (
                                    <div className="flex h-full flex-col bg-white">
                                        <div className="border-b border-gray-200 px-5 py-3">
                                            <p className="text-base font-semibold text-gray-900">New message</p>
                                            <div className="mt-2 flex items-center gap-2">
                                                <span className="text-sm text-gray-500">To:</span>
                                                {selectedNewConversationMember ? (
                                                    <span className="inline-flex items-center gap-2 rounded-md bg-blue-50 px-2 py-1 text-sm font-medium text-blue-700">
                                                        <Avatar className="h-5 w-5 rounded-md border border-blue-100 bg-white">
                                                            <AvatarImage
                                                                src={selectedNewConversationMember.avatar || undefined}
                                                                alt={selectedNewConversationMember.name}
                                                                className="rounded-md object-cover"
                                                            />
                                                            <AvatarFallback className="rounded-md text-[10px] font-semibold text-blue-700">
                                                                {initials(selectedNewConversationMember.name)}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        {selectedNewConversationMember.name}
                                                        <button
                                                            type="button"
                                                            className="text-blue-500 transition-colors hover:text-blue-700"
                                                            onClick={clearDraftMember}
                                                            aria-label="Remove recipient"
                                                        >
                                                            ×
                                                        </button>
                                                    </span>
                                                ) : (
                                                    <div className="relative flex-1">
                                                        <input
                                                            value={newConversationQuery}
                                                            onChange={(event) => setNewConversationQuery(event.target.value)}
                                                            onKeyDown={(event) => {
                                                                if (event.key !== "Enter") return;
                                                                event.preventDefault();
                                                                if (!filteredMembers.length) return;
                                                                selectDraftMember(filteredMembers[0]);
                                                            }}
                                                            placeholder="Search members"
                                                            className="h-8 w-full rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                                        />

                                                        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                                                            <div className="max-h-56 overflow-y-auto py-1">
                                                                {filteredMembers.length === 0 ? (
                                                                    <p className="px-3 py-2 text-sm text-gray-500">No members found.</p>
                                                                ) : (
                                                                    filteredMembers.map((member) => (
                                                                        <button
                                                                            key={String(member.id)}
                                                                            type="button"
                                                                            onMouseDown={(event) => {
                                                                                event.preventDefault();
                                                                                selectDraftMember(member);
                                                                            }}
                                                                            onClick={() => selectDraftMember(member)}
                                                                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-50"
                                                                        >
                                                                            <Avatar className="h-7 w-7 rounded-md border border-gray-200 bg-gray-100">
                                                                                <AvatarImage src={member.avatar || undefined} alt={member.name} className="rounded-md object-cover" />
                                                                                <AvatarFallback className="rounded-md text-[10px] font-semibold text-gray-700">
                                                                                    {initials(member.name)}
                                                                                </AvatarFallback>
                                                                            </Avatar>
                                                                            <div className="min-w-0 flex-1">
                                                                                <p className="truncate text-sm font-medium text-gray-900">{member.name}</p>
                                                                                <p className="truncate text-xs text-gray-500">{member.email}</p>
                                                                            </div>
                                                                        </button>
                                                                    ))
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                                            {!selectedNewConversationMember ? (
                                                <div className="mt-6 rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-500">
                                                    Select a person in the <span className="font-medium text-gray-700">To:</span> field to start the conversation.
                                                </div>
                                            ) : (
                                                <div className="mt-3 space-y-4">
                                                    <div className="flex items-center gap-4">
                                                        <Avatar className="h-16 w-16 rounded-xl border border-gray-200 bg-gray-100">
                                                            <AvatarImage
                                                                src={selectedNewConversationMember.avatar || undefined}
                                                                alt={selectedNewConversationMember.name}
                                                                className="rounded-xl object-cover"
                                                            />
                                                            <AvatarFallback className="rounded-xl text-sm font-semibold text-gray-700">
                                                                {initials(selectedNewConversationMember.name)}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        <p className="text-2xl font-semibold text-gray-900">{selectedNewConversationMember.name}</p>
                                                    </div>
                                                    <p className="text-sm text-gray-600">
                                                        This conversation is just between{" "}
                                                        <span className="font-medium text-blue-700">{selectedNewConversationMember.name}</span>{" "}
                                                        and you. Check out their profile to learn more about them.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        onClick={() => openMemberProfile(selectedNewConversationMember)}
                                                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                                                    >
                                                        View Profile
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <MessageInput
                                            variant="messages"
                                            placeholder={
                                                selectedNewConversationMember
                                                    ? `Message ${selectedNewConversationMember.name}`
                                                    : "Select a member to start a conversation"
                                            }
                                            disabled={false}
                                            onSend={sendFirstDirectMessage}
                                            onStructuredSend={sendFirstDirectMessage}
                                        />
                                    </div>
                                ) : (
                                    <ConversationView
                                        conversation={activeConversation}
                                        messages={activeConversationId ? conversationMessagesMap[activeConversationId] || [] : []}
                                        aiIsTyping={aiIsTyping && detailMode === "conversation"}
                                        currentUserId={currentUserId}
                                        currentUserName={runtimeUser?.name || null}
                                        currentUserEmail={runtimeUser?.email || null}
                                        resolveAvatar={resolveMemberAvatar}
                                        onSend={(content) =>
                                            activeConversationId ? sendConversationMessage(activeConversationId, content) : Promise.resolve()
                                        }
                                        onStructuredSend={(payload) =>
                                            activeConversationId
                                                ? sendConversationMessage(
                                                    activeConversationId,
                                                    payload.content,
                                                    payload.embeddedContent,
                                                    payload.contentType
                                                )
                                                : Promise.resolve()
                                        }
                                    />
                                )}
                            </main>
                        </>
                    ) : null}

                    {detailMode === "thread" ? (
                        <>
                            <aside className="flex w-[324px] min-w-[324px] flex-col border-r border-gray-200 bg-white">
                                <section className="space-y-2 border-b border-gray-200 px-3 py-3">
                                    <div className="grid grid-cols-[104px_1fr_auto] items-center gap-2">
                                        <div className="relative min-w-0">
                                            <select
                                                value={selectedThreadTrialId}
                                                onChange={(event) => setSelectedThreadTrialId(event.target.value)}
                                                className="h-8 w-full appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-xs text-gray-700 outline-none"
                                            >
                                                {threadTrialOptions.map((option) => (
                                                    <option key={option.id} value={option.id}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                                        </div>
                                        <div className="relative min-w-0">
                                            <select
                                                value={threadFilters.category || ""}
                                                onChange={(event) => updateThreadCategoryFilter(event.target.value)}
                                                className="h-8 w-full appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-xs text-gray-700 outline-none"
                                            >
                                                <option value="">Query Type</option>
                                                <option value="question">Question</option>
                                                <option value="decision">Decision</option>
                                                <option value="clarification">Clarification</option>
                                                <option value="issue">Issue / Blocker</option>
                                                <option value="action_required">Action Required</option>
                                                <option value="approval">Approval</option>
                                            </select>
                                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void createQuickThread()}
                                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            New
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="relative">
                                            <select
                                                value={threadFilters.anchorType || ""}
                                                onChange={(event) => updateThreadAnchorFilter(event.target.value)}
                                                className="h-8 w-full appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-xs text-gray-700 outline-none"
                                            >
                                                <option value="">All Anchors</option>
                                                <option value="document_section">Document</option>
                                                <option value="task">Task</option>
                                                <option value="visit">Visit</option>
                                                <option value="trial_wide">Trial-wide</option>
                                                <option value="therapeutic_area">Therapeutic Area</option>
                                                <option value="team_member">Team member</option>
                                            </select>
                                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                                        </div>

                                        <div className="relative">
                                            <select
                                                value={threadFilters.status || ""}
                                                onChange={(event) => updateThreadStatusFilter(event.target.value)}
                                                className="h-8 w-full appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-xs text-gray-700 outline-none"
                                            >
                                                <option value="">Message</option>
                                                <option value="open">Open</option>
                                                <option value="pending">Pending</option>
                                                <option value="resolved">Resolved</option>
                                                <option value="closed">Closed</option>
                                            </select>
                                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                                        </div>
                                    </div>

                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                                        <input
                                            value={threadSearch}
                                            onChange={(event) => setThreadSearch(event.target.value)}
                                            placeholder="Search threads"
                                            className="h-8 w-full rounded-md border border-gray-200 bg-gray-50 pl-8 pr-2.5 text-xs text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
                                        />
                                    </div>
                                </section>

                                <div className="min-h-0 flex-1 overflow-y-auto">
                                    {visibleThreads.length === 0 ? (
                                        <div className="px-4 py-6 text-[13px] text-gray-500">No threads found for these filters.</div>
                                    ) : null}

                                    {visibleThreads.slice(0, 30).map((thread) => {
                                        const isActive = activeThreadId === thread.id;
                                        const members = getThreadCardMembers(thread);
                                        const participantCount = (thread.participants || []).length;
                                        const extraParticipants = Math.max(0, participantCount - members.length);
                                        const showStatusBadge = thread.status === "resolved" || thread.status === "pending";

                                        return (
                                            <button
                                                key={thread.id}
                                                type="button"
                                                onClick={() => selectThread(thread.id)}
                                                className={cn(
                                                    "w-full border-b border-gray-100 px-3 py-2.5 text-left transition-colors duration-150",
                                                    isActive ? "bg-gray-100" : "hover:bg-gray-50"
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <ThreadCategoryBadge category={thread.category} />
                                                    {showStatusBadge ? (
                                                        <ThreadStatusBadge status={thread.status} />
                                                    ) : (
                                                        <span className="text-[11px] text-gray-500">{formatRelative(thread.updatedAt)} ago</span>
                                                    )}
                                                </div>

                                                <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-tight text-gray-900">
                                                    {thread.title}
                                                </p>

                                                {(thread.anchors || []).length ? (
                                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                        {(thread.anchors || []).slice(0, 2).map((anchor) => {
                                                            const AnchorIcon = getAnchorIcon(anchor.anchorType);
                                                            return (
                                                                <span
                                                                    key={anchor.id}
                                                                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600"
                                                                >
                                                                    <AnchorIcon className="h-3.5 w-3.5" />
                                                                    {anchor.anchorLabel}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                ) : null}

                                                <div className="mt-1.5 flex items-center justify-between">
                                                    <div className="flex -space-x-1">
                                                        {members.map((member) => (
                                                            <Avatar key={`${thread.id}-${member.id}`} className="h-[18px] w-[18px] border border-white">
                                                                <AvatarImage src={member.avatar || undefined} alt={member.name} className="object-cover" />
                                                                <AvatarFallback className="text-[9px] text-gray-700">{initials(member.name)}</AvatarFallback>
                                                            </Avatar>
                                                        ))}
                                                        {extraParticipants > 0 ? (
                                                            <span className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-gray-200 bg-white px-1 text-[10px] font-medium text-gray-500">
                                                                +{extraParticipants}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    <span className="text-[11px] text-gray-500">
                                                        {(thread.replyCount || 0) === 1 ? "1 reply" : `${thread.replyCount || 0} replies`}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </aside>

                            <main className="min-w-0 flex-1 bg-background">
                                <ThreadView
                                    thread={activeThread}
                                    messages={activeThreadId ? threadMessages[activeThreadId] || [] : []}
                                    aiIsTyping={aiIsTyping && detailMode === "thread"}
                                    currentUserId={currentUserId}
                                    currentUserName={runtimeUser?.name || null}
                                    currentUserEmail={runtimeUser?.email || null}
                                    resolveAvatar={resolveMemberAvatar}
                                    onSendMessage={sendThreadMessage}
                                    onResolve={resolveActiveThread}
                                    onRequestAiSummary={requestThreadSummary}
                                />
                            </main>
                        </>
                    ) : null}
                </div>
            </div>

            <InboxTriageSettingsSheet
                open={triageSettingsOpen}
                onOpenChange={setTriageSettingsOpen}
                settings={inboxTriageSettings}
                onUpdateLabel={updateInboxTriageLabel}
                onUpdateConfidence={setInboxTriageConfidence}
                onReset={resetInboxTriageSettings}
            />
            <AddMemberPanel
                open={memberPanelOpen}
                onClose={() => setMemberPanelOpen(false)}
                editingMemberId={memberPanelMemberId}
                initialValues={memberPanelValues}
            />
            <DemoControlsPanel onEmailSimulated={() => loadEmailChains("inbox")} />
        </div>
    );
}
