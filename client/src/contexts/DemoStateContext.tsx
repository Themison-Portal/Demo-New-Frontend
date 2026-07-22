/**
 * Demo State Context
 * Manages persistent interconnected state across all pages using localStorage
 * Survives page navigation and browser refresh, can be reset to initial state
 */

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { toast } from "sonner";
import { clearCollaborationDemoRuntimeCache } from "@/stores/collaborationStore";

// Task status types
export type TaskStatus = "due_today" | "waiting_on_monitor" | "review_pending" | "need_answers" | "completed";

// Task interface
export interface Task {
    id: string;
    name: string;
    status: TaskStatus;
    completed: boolean;
    assignee?: string;
    priority?: "high" | "medium" | "low";
    dueDate?: string;
}

// Document interface
export interface Document {
    id: string;
    name: string;
    type: string;
    uploadedBy: string;
    uploadedAt: string;
    size: string;
    reviewed: boolean;
}

// Trial milestone interface
export interface Milestone {
    id: string;
    name: string;
    progress: number;
    dueDate: string;
    status: "on_track" | "at_risk" | "completed";
}

// Team member interface
export interface TeamMember {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar?: string;
    initials: string;
    clinicalRole?: string;
    appRole?: string;
    team?: string;
    site?: string;
    status?: string;
}

// Trial interface
export interface Trial {
    id: string;
    name: string;
    phase: string;
    status: 'active' | 'recruiting' | 'completed' | 'on-hold';
    sponsor: string;
    enrolled: number;
    target: number;
    color: string;
}

// Demo state interface
export interface DemoState {
    tasks: Task[];
    documents: Document[];
    milestones: Milestone[];
    teamMembers: TeamMember[];
    trials: Trial[];
    activeTrials: number;
    blockedTasks: number;
    dataMode: 'sample' | 'full' | 'building';
}

// Initial demo state
const initialDemoState: DemoState = {
    tasks: [
        {
            id: "task-1",
            name: "2 tasks",
            status: "due_today",
            completed: false,
        },
        {
            id: "task-2",
            name: "1 task blocked",
            status: "waiting_on_monitor",
            completed: false,
        },
        {
            id: "task-3",
            name: "Amendment v3 uploaded",
            status: "review_pending",
            completed: false,
        },
        {
            id: "task-4",
            name: "2 protocol questions",
            status: "need_answers",
            completed: false,
        },
    ],
    documents: [],
    milestones: [],
    teamMembers: [],
    trials: [
        {
            id: '1',
            name: 'Trial ABC-123',
            phase: 'Phase III',
            status: 'active',
            sponsor: 'Novo Nordisk',
            enrolled: 12,
            target: 50,
            color: '#3b82f6',
        },
        {
            id: '2',
            name: 'Trial DEF-456',
            phase: 'Phase II',
            status: 'recruiting',
            sponsor: 'Roche',
            enrolled: 8,
            target: 30,
            color: '#8b5cf6',
        },
        {
            id: '3',
            name: 'Trial GHI-789',
            phase: 'Phase III',
            status: 'active',
            sponsor: 'Pfizer',
            enrolled: 25,
            target: 100,
            color: '#10b981',
        },
        {
            id: '4',
            name: 'Trial JKL-012',
            phase: 'Phase I',
            status: 'recruiting',
            sponsor: 'Biogen',
            enrolled: 3,
            target: 15,
            color: '#f59e0b',
        },
        {
            id: '5',
            name: 'Trial MNO-345',
            phase: 'Phase II',
            status: 'active',
            sponsor: 'AstraZeneca',
            enrolled: 18,
            target: 60,
            color: '#ef4444',
        },
        {
            id: '6',
            name: 'Trial PQR-678',
            phase: 'Phase III',
            status: 'active',
            sponsor: 'Johnson & Johnson',
            enrolled: 45,
            target: 120,
            color: '#06b6d4',
        },
        {
            id: '7',
            name: 'Trial STU-901',
            phase: 'Phase II',
            status: 'recruiting',
            sponsor: 'Galderma',
            enrolled: 6,
            target: 25,
            color: '#ec4899',
        },
        {
            id: '8',
            name: 'Trial VWX-234',
            phase: 'Phase III',
            status: 'on-hold',
            sponsor: 'Takeda',
            enrolled: 32,
            target: 80,
            color: '#6366f1',
        },
    ],
    activeTrials: 12,
    blockedTasks: 4,
    dataMode: 'building',
    // dataMode: 'sample',
};

interface DemoStateContextType {
    state: DemoState;
    updateTask: (taskId: string, updates: Partial<Task>) => void;
    addDocument: (document: Document) => void;
    addTeamMember: (member: TeamMember) => void;
    updateTeamMember: (memberId: string, updates: Partial<TeamMember>) => void;
    updateMilestone: (milestoneId: string, updates: Partial<Milestone>) => void;
    resetDemo: () => void;
    loadSampleData: () => void;
    loadFullDataset: () => void;
    restoreModeFromDefaultLocal: (mode: DemoState["dataMode"]) => void;
    saveCurrentModeAsDefault: () => void;
    fullResetLocal: (modeOverride?: DemoState["dataMode"]) => void;
    setBuildingMode: () => void;
    getCompletedTasksCount: () => number;
    getActiveTasksCount: () => number;
    getCurrentDataMode: () => 'sample' | 'full' | 'building';
    getCloneStorageOverridesForMode: (mode: DemoState["dataMode"]) => Record<string, string>;
}

const DemoStateContext = createContext<DemoStateContextType | undefined>(undefined);

const STORAGE_KEY = "themison-demo-state";
const STORAGE_KEY_SAMPLE = `${STORAGE_KEY}-sample`;
const STORAGE_KEY_FULL = `${STORAGE_KEY}-full`;
const STORAGE_KEY_BUILDING = `${STORAGE_KEY}-building`;
const STORAGE_KEY_ACTIVE_MODE = `${STORAGE_KEY}-active-mode`;
const STORAGE_KEY_DEFAULT_SAMPLE = `${STORAGE_KEY}-default-sample`;
const STORAGE_KEY_DEFAULT_FULL = `${STORAGE_KEY}-default-full`;
const STORAGE_KEY_DEFAULT_BUILDING = `${STORAGE_KEY}-default-building`;
const ORGANIZATION_PROFILE_STORAGE_KEY = "themison-organization-profile:v1";
const ORGANIZATION_PROFILE_UPDATED_EVENT = "themison:organization-profile-updated";
const LEGACY_MEMBER_EMAIL_DOMAIN = "@themison.com";
const CURRENT_MEMBER_EMAIL_DOMAIN = "@azorg.be";
const COLLAB_DEMO_STORAGE_PREFIXES = [
    "themison-collab-demo-conversations-",
    "themison-collab-demo-inbox-",
    "themison-collab-demo-threads-",
];

const isDemoDataMode = (value: string | null): value is DemoState["dataMode"] => {
    return value === "sample" || value === "full" || value === "building";
};

const getStorageKeyForMode = (mode: DemoState["dataMode"]) => {
    switch (mode) {
        case "full":
            return STORAGE_KEY_FULL;
        case "building":
            return STORAGE_KEY_BUILDING;
        case "sample":
        default:
            return STORAGE_KEY_SAMPLE;
    }
};

const getDefaultStorageKeyForMode = (mode: DemoState["dataMode"]) => {
    switch (mode) {
        case "full":
            return STORAGE_KEY_DEFAULT_FULL;
        case "building":
            return STORAGE_KEY_DEFAULT_BUILDING;
        case "sample":
        default:
            return STORAGE_KEY_DEFAULT_SAMPLE;
    }
};

const withMode = (state: DemoState, mode: DemoState["dataMode"]) => ({
    ...state,
    dataMode: mode,
});

const isQuotaExceededError = (error: unknown) => {
    return (
        error instanceof DOMException &&
        (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22)
    );
};

const clearCollaborationDemoStorage = () => {
    const keysToDelete: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        if (COLLAB_DEMO_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
            keysToDelete.push(key);
        }
    }
    keysToDelete.forEach((key) => localStorage.removeItem(key));
};

const migrateMemberEmailDomain = (email: string) => {
    const trimmed = email.trim();
    if (!trimmed.toLowerCase().endsWith(LEGACY_MEMBER_EMAIL_DOMAIN)) {
        return trimmed;
    }
    return `${trimmed.slice(0, -LEGACY_MEMBER_EMAIL_DOMAIN.length)}${CURRENT_MEMBER_EMAIL_DOMAIN}`;
};

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

export const isHardcodedMockMember = (member: any) => {
    if (!member) return false;
    const id = String(member.id || "").trim();
    if (/^member-\d+$/i.test(id)) return true;
    const name = String(member.name || "").trim().toLowerCase();
    if (HARDCODED_MOCK_NAMES.has(name)) return true;
    return false;
};

const migrateDemoStateMemberEmails = (value: DemoState): DemoState => {
    if (!Array.isArray(value.teamMembers) || value.teamMembers.length === 0) {
        return value;
    }

    const filteredTeamMembers = value.teamMembers
        .filter((member) => !isHardcodedMockMember(member))
        .map((member) => {
            const nextEmail = migrateMemberEmailDomain(member.email ?? "");
            return nextEmail !== member.email ? { ...member, email: nextEmail } : member;
        });

    return {
        ...value,
        teamMembers: filteredTeamMembers,
    };
};

const normalizeMemberLookup = (value: string | null | undefined) => String(value || "").trim().toLowerCase();

const sanitizeEmailLocalPart = (value: string) =>
    String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, ".")
        .replace(/\.{2,}/g, ".")
        .replace(/^\.|\.$/g, "");

const buildMemberEmailLocalPart = (member: TeamMember) => {
    const rawEmail = String(member.email || "").trim();
    if (rawEmail.includes("@")) {
        const local = sanitizeEmailLocalPart(rawEmail.slice(0, rawEmail.indexOf("@")));
        if (local) return local;
    } else {
        const local = sanitizeEmailLocalPart(rawEmail);
        if (local) return local;
    }

    const nameLocal = sanitizeEmailLocalPart(String(member.name || "").replace(/\s+/g, "."));
    if (nameLocal) return nameLocal;

    const idToken = sanitizeEmailLocalPart(String(member.id || ""));
    return idToken || "member";
};

const extractEmailDomain = (email: string | null | undefined) => {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) return "";
    const atIndex = normalized.lastIndexOf("@");
    if (atIndex <= 0 || atIndex >= normalized.length - 1) return "";
    return normalized.slice(atIndex + 1).replace(/[^a-z0-9.-]/g, "");
};

const extractWebsiteDomain = (website: string | null | undefined) => {
    const normalized = String(website || "").trim();
    if (!normalized) return "";
    try {
        const withProtocol = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
        const url = new URL(withProtocol);
        return url.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
        return "";
    }
};

const extractCityFromLocation = (location: string | null | undefined) => {
    const normalized = String(location || "").trim();
    if (!normalized) return "";
    const [cityToken] = normalized.split(",");
    return String(cityToken || "").trim();
};

const readOrganizationMemberRules = () => {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(ORGANIZATION_PROFILE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<{
            contactEmail: string;
            website: string;
            location: string;
        }>;
        const domain = extractEmailDomain(parsed.contactEmail) || extractWebsiteDomain(parsed.website);
        const siteCity = extractCityFromLocation(parsed.location);
        if (!domain && !siteCity) return null;
        return { domain, siteCity };
    } catch {
        return null;
    }
};

const alignStateToActiveOrganization = (targetState: DemoState): DemoState => {
    const sanitizedMembers = (targetState.teamMembers || []).filter((m) => !isHardcodedMockMember(m));
    const targetWithSanitized = sanitizedMembers.length !== (targetState.teamMembers || []).length
        ? { ...targetState, teamMembers: sanitizedMembers }
        : targetState;

    const rules = readOrganizationMemberRules();
    if (!rules) return targetWithSanitized;
    if (!Array.isArray(targetWithSanitized.teamMembers) || targetWithSanitized.teamMembers.length === 0) return targetWithSanitized;

    let changed = false;
    const nextTeamMembers = targetWithSanitized.teamMembers.map((member) => {
        const nextEmail = (() => {
            if (!rules.domain) return member.email;
            const current = String(member.email || "").trim();
            const currentDomain = extractEmailDomain(current);
            if (current && currentDomain === rules.domain) return current;
            return `${buildMemberEmailLocalPart(member)}@${rules.domain}`;
        })();
        const nextSite = rules.siteCity || member.site || "";
        if (member.email === nextEmail && member.site === nextSite) {
            return member;
        }
        changed = true;
        return {
            ...member,
            email: nextEmail,
            site: nextSite,
        };
    });

    if (!changed) return targetWithSanitized;
    return {
        ...targetWithSanitized,
        teamMembers: nextTeamMembers,
    };
};

const getMemberIdentityKeys = (member: TeamMember): string[] => {
    const keys: string[] = [];
    const id = String(member.id || "").trim().toLowerCase();
    const email = normalizeMemberLookup(member.email);
    const name = normalizeMemberLookup(member.name);
    if (id) keys.push(`id:${id}`);
    if (email) keys.push(`email:${email}`);
    if (name) keys.push(`name:${name}`);
    return keys;
};

const mergeUniqueTeamMembers = (primary: TeamMember[], secondary: TeamMember[]): TeamMember[] => {
    const merged: TeamMember[] = [];
    const seen = new Set<string>();

    const pushUnique = (member: TeamMember) => {
        if (isHardcodedMockMember(member)) return;
        const keys = getMemberIdentityKeys(member);
        if (keys.length === 0) {
            merged.push(member);
            return;
        }
        if (keys.some((key) => seen.has(key))) return;
        keys.forEach((key) => seen.add(key));
        merged.push(member);
    };

    primary.forEach(pushUnique);
    secondary.forEach(pushUnique);
    return merged;
};

const mergeTeamMemberAvatars = (target: DemoState, sourceMembers: TeamMember[]) => {
    if (!Array.isArray(target.teamMembers) || target.teamMembers.length === 0) return target;
    if (!Array.isArray(sourceMembers) || sourceMembers.length === 0) return target;

    const avatarById = new Map<string, string>();
    const avatarByEmail = new Map<string, string>();
    const avatarByName = new Map<string, string>();

    sourceMembers.forEach((member) => {
        const avatar = String(member.avatar || "").trim();
        if (!avatar) return;

        const id = String(member.id || "").trim();
        const email = normalizeMemberLookup(member.email);
        const name = normalizeMemberLookup(member.name);

        if (id) avatarById.set(id, avatar);
        if (email) avatarByEmail.set(email, avatar);
        if (name) avatarByName.set(name, avatar);
    });

    let changed = false;
    const mergedMembers = target.teamMembers.map((member) => {
        const existingAvatar = String(member.avatar || "").trim();
        if (existingAvatar) return member;

        const id = String(member.id || "").trim();
        const email = normalizeMemberLookup(member.email);
        const name = normalizeMemberLookup(member.name);

        const nextAvatar =
            (id ? avatarById.get(id) : undefined) ||
            (email ? avatarByEmail.get(email) : undefined) ||
            (name ? avatarByName.get(name) : undefined);

        if (!nextAvatar) return member;
        changed = true;
        return { ...member, avatar: nextAvatar };
    });

    if (!changed) return target;
    return {
        ...target,
        teamMembers: mergedMembers,
    };
};

const readStateFromStorage = (storageKey: string, mode: DemoState["dataMode"]): DemoState | null => {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as DemoState;
        return withMode(migrateDemoStateMemberEmails(parsed), mode);
    } catch {
        return null;
    }
};

const getSampleMembersForBuilding = (): TeamMember[] => {
    if (typeof window === "undefined") return [...initialDemoState.teamMembers];

    const sampleCurrent = readStateFromStorage(STORAGE_KEY_SAMPLE, "sample");
    const sampleDefault = readStateFromStorage(STORAGE_KEY_DEFAULT_SAMPLE, "sample");
    const sourceMembers =
        (sampleCurrent?.teamMembers && sampleCurrent.teamMembers.length > 0
            ? sampleCurrent.teamMembers
            : sampleDefault?.teamMembers && sampleDefault.teamMembers.length > 0
                ? sampleDefault.teamMembers
                : initialDemoState.teamMembers) || [];

    return sourceMembers.map((member) => ({ ...member }));
};

const syncBuildingTeamMembersFromSample = (targetState: DemoState): DemoState => {
    if (targetState.dataMode !== "building") return targetState;

    const sampleMembers = getSampleMembersForBuilding().filter((m) => !isHardcodedMockMember(m));
    const currentMembers = (targetState.teamMembers || []).filter((m) => !isHardcodedMockMember(m));

    if (sampleMembers.length === 0) {
        return {
            ...targetState,
            teamMembers: currentMembers,
        };
    }

    const mergedMembers = mergeUniqueTeamMembers(sampleMembers, currentMembers).filter((m) => !isHardcodedMockMember(m));
    return {
        ...targetState,
        teamMembers: mergedMembers,
    };
};

const syncModeAvatarsFromStoredSources = (targetState: DemoState): DemoState => {
    if (typeof window === "undefined") return targetState;

    const sampleCurrent = readStateFromStorage(STORAGE_KEY_SAMPLE, "sample");
    const sampleDefault = readStateFromStorage(STORAGE_KEY_DEFAULT_SAMPLE, "sample");
    const fullCurrent = readStateFromStorage(STORAGE_KEY_FULL, "full");
    const fullDefault = readStateFromStorage(STORAGE_KEY_DEFAULT_FULL, "full");
    const avatarSourceMembers = [
        ...(sampleCurrent?.teamMembers || []),
        ...(sampleDefault?.teamMembers || []),
        ...(fullCurrent?.teamMembers || []),
        ...(fullDefault?.teamMembers || []),
    ];

    return mergeTeamMemberAvatars(targetState, avatarSourceMembers);
};

export function DemoStateProvider({ children }: { children: ReactNode }) {
    const quotaToastShownRef = useRef(false);
    const [state, setState] = useState<DemoState>(() => {
        // Load active mode from localStorage on initial mount (sample mode by default)
        const storedModeRaw = localStorage.getItem(STORAGE_KEY_ACTIVE_MODE);
        // const activeMode: DemoState["dataMode"] = isDemoDataMode(storedModeRaw) ? storedModeRaw : "sample";
        const activeMode: DemoState["dataMode"] = isDemoDataMode(storedModeRaw) ? storedModeRaw : "building";
        const stored = localStorage.getItem(getStorageKeyForMode(activeMode));
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as DemoState;
                const hydrated = withMode(migrateDemoStateMemberEmails(parsed), activeMode);
                const modeAligned =
                    activeMode === "building" ? syncBuildingTeamMembersFromSample(hydrated) : hydrated;
                const avatarAligned = activeMode === "full" || activeMode === "building"
                    ? syncModeAvatarsFromStoredSources(modeAligned)
                    : modeAligned;
                return alignStateToActiveOrganization(avatarAligned);
            } catch (e) {
                console.error("Failed to parse stored state:", e);
                return alignStateToActiveOrganization(withMode(initialDemoState, "sample"));
            }
        }
        return alignStateToActiveOrganization(withMode(initialDemoState, "sample"));
    });

    useEffect(() => {
        const sanitized = (state.teamMembers || []).filter((m) => !isHardcodedMockMember(m));
        if (sanitized.length !== (state.teamMembers || []).length) {
            setState((prev) => ({
                ...prev,
                teamMembers: sanitized,
            }));
            return;
        }
        const aligned = alignStateToActiveOrganization(state);
        if (aligned !== state) {
            setState(aligned);
        }
    }, [state]);

    useEffect(() => {
        const alignFromProfile = () => {
            setState((prev) => alignStateToActiveOrganization(prev));
        };

        try {
            [STORAGE_KEY_BUILDING, STORAGE_KEY_SAMPLE, STORAGE_KEY_FULL, STORAGE_KEY_DEFAULT_BUILDING, STORAGE_KEY_DEFAULT_SAMPLE, STORAGE_KEY_DEFAULT_FULL].forEach((k) => {
                const raw = localStorage.getItem(k);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed.teamMembers)) {
                        const cleaned = parsed.teamMembers.filter((m: any) => !isHardcodedMockMember(m));
                        if (cleaned.length !== parsed.teamMembers.length) {
                            parsed.teamMembers = cleaned;
                            localStorage.setItem(k, JSON.stringify(parsed));
                        }
                    }
                }
            });
            clearCollaborationDemoStorage();
        } catch {}

        window.addEventListener("storage", alignFromProfile);
        window.addEventListener(ORGANIZATION_PROFILE_UPDATED_EVENT, alignFromProfile as EventListener);
        return () => {
            window.removeEventListener("storage", alignFromProfile);
            window.removeEventListener(ORGANIZATION_PROFILE_UPDATED_EVENT, alignFromProfile as EventListener);
        };
    }, []);

    // Save to localStorage whenever state changes
    useEffect(() => {
        const key = getStorageKeyForMode(state.dataMode);
        const persistState = alignStateToActiveOrganization(state);
        if (persistState !== state) {
            setState(persistState);
            return;
        }
        try {
            localStorage.setItem(key, JSON.stringify(persistState));
            localStorage.setItem(STORAGE_KEY_ACTIVE_MODE, state.dataMode);
        } catch (error) {
            if (!isQuotaExceededError(error)) {
                console.error("Failed to persist demo state:", error);
                return;
            }

            // Fallback #1: clear regenerable collaboration cache, then retry preserving avatars.
            clearCollaborationDemoStorage();

            try {
                localStorage.setItem(key, JSON.stringify(persistState));
                localStorage.setItem(STORAGE_KEY_ACTIVE_MODE, state.dataMode);
                if (!quotaToastShownRef.current) {
                    toast.success("Cleared cached collaboration demo data to save profile photos.");
                    quotaToastShownRef.current = true;
                }
            } catch (fallbackError) {
                console.error("Failed to persist demo state after cache cleanup:", fallbackError);
                if (!quotaToastShownRef.current) {
                    toast.error("Storage is full. Please run Full Reset to clear local demo data, then save photos again.");
                    quotaToastShownRef.current = true;
                }
            }
        }
    }, [state]);

    useEffect(() => {
        toast.dismiss("demo-reset");
    }, [state.dataMode]);

    const updateTask = (taskId: string, updates: Partial<Task>) => {
        setState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((task) =>
                task.id === taskId ? { ...task, ...updates } : task
            ),
            dataMode: prev.dataMode === 'building' ? 'building' : prev.dataMode,
        }));
    };

    const addDocument = (document: Document) => {
        setState((prev) => ({
            ...prev,
            documents: [...prev.documents, document],
            dataMode: prev.dataMode === 'building' ? 'building' : prev.dataMode,
        }));
    };

    const addTeamMember = (member: TeamMember) => {
        setState((prev) => ({
            ...prev,
            teamMembers: [...prev.teamMembers, member],
            dataMode: prev.dataMode === 'building' ? 'building' : prev.dataMode,
        }));
    };

    const updateTeamMember = (memberId: string, updates: Partial<TeamMember>) => {
        setState((prev) => ({
            ...prev,
            teamMembers: prev.teamMembers.map((member) =>
                member.id === memberId ? { ...member, ...updates } : member
            ),
            dataMode: prev.dataMode === 'building' ? 'building' : prev.dataMode,
        }));
    };

    const updateMilestone = (milestoneId: string, updates: Partial<Milestone>) => {
        setState((prev) => ({
            ...prev,
            milestones: prev.milestones.map((milestone) =>
                milestone.id === milestoneId ? { ...milestone, ...updates } : milestone
            ),
            dataMode: prev.dataMode === 'building' ? 'building' : prev.dataMode,
        }));
    };

    const resetDemo = () => {
        const emptyState: DemoState = {
            tasks: [],
            documents: [],
            milestones: [],
            teamMembers: [],
            trials: [],
            activeTrials: 0,
            blockedTasks: 0,
            dataMode: 'building',
        };
        const nextState = syncModeAvatarsFromStoredSources(
            syncBuildingTeamMembersFromSample(withMode(emptyState, "building"))
        );
        clearCollaborationDemoStorage();
        clearCollaborationDemoRuntimeCache();
        setState(nextState);
        localStorage.setItem(STORAGE_KEY_BUILDING, JSON.stringify(nextState));
    };

    const loadSampleData = () => {
        const stored = localStorage.getItem(STORAGE_KEY_SAMPLE);
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as DemoState;
                setState(withMode(migrateDemoStateMemberEmails(parsed), "sample"));
                return;
            } catch (e) {
                console.error("Failed to parse stored sample state:", e);
            }
        }
        const nextState = withMode(initialDemoState, "sample");
        setState(nextState);
        localStorage.setItem(STORAGE_KEY_SAMPLE, JSON.stringify(nextState));
    };

    const buildFullDataset = (): DemoState => ({
        ...initialDemoState,
        activeTrials: 27,
        blockedTasks: 8,
        dataMode: 'full',
        tasks: [
            ...initialDemoState.tasks,
            { id: "task-5", name: "Site visit scheduled", status: "completed", completed: true },
            { id: "task-6", name: "IRB approval pending", status: "review_pending", completed: false },
            { id: "task-7", name: "Patient consent forms", status: "due_today", completed: false },
            { id: "task-8", name: "Data entry verification", status: "need_answers", completed: false },
        ],
        teamMembers: [],
        trials: [
            ...initialDemoState.trials,
            { id: 'yza-567', name: 'Trial YZA-567', phase: 'Phase II', status: 'active', sponsor: 'Merck', enrolled: 15, target: 45, color: '#14b8a6' },
            { id: 'bcd-890', name: 'Trial BCD-890', phase: 'Phase III', status: 'recruiting', sponsor: 'Sanofi', enrolled: 22, target: 75, color: '#f97316' },
            { id: 'efg-123', name: 'Trial EFG-123', phase: 'Phase I', status: 'active', sponsor: 'Gilead', enrolled: 5, target: 20, color: '#a855f7' },
            { id: 'hij-456', name: 'Trial HIJ-456', phase: 'Phase II', status: 'recruiting', sponsor: 'Amgen', enrolled: 18, target: 55, color: '#22c55e' },
            { id: 'klm-789', name: 'Trial KLM-789', phase: 'Phase III', status: 'active', sponsor: 'Bristol Myers', enrolled: 40, target: 110, color: '#3b82f6' },
            { id: 'nop-012', name: 'Trial NOP-012', phase: 'Phase II', status: 'recruiting', sponsor: 'Eli Lilly', enrolled: 12, target: 40, color: '#ec4899' },
            { id: 'qrs-345', name: 'Trial QRS-345', phase: 'Phase I', status: 'active', sponsor: 'Regeneron', enrolled: 7, target: 25, color: '#f59e0b' },
            { id: 'tuv-678', name: 'Trial TUV-678', phase: 'Phase III', status: 'recruiting', sponsor: 'Vertex', enrolled: 35, target: 95, color: '#06b6d4' },
            { id: 'wxy-901', name: 'Trial WXY-901', phase: 'Phase II', status: 'active', sponsor: 'Moderna', enrolled: 20, target: 60, color: '#8b5cf6' },
            { id: 'zab-234', name: 'Trial ZAB-234', phase: 'Phase III', status: 'recruiting', sponsor: 'BioNTech', enrolled: 28, target: 85, color: '#10b981' },
            { id: 'cde-567', name: 'Trial CDE-567', phase: 'Phase I', status: 'active', sponsor: 'Incyte', enrolled: 4, target: 15, color: '#ef4444' },
            { id: 'fgh-890', name: 'Trial FGH-890', phase: 'Phase II', status: 'recruiting', sponsor: 'Biogen', enrolled: 16, target: 50, color: '#6366f1' },
            { id: 'ijk-123', name: 'Trial IJK-123', phase: 'Phase III', status: 'active', sponsor: 'Alexion', enrolled: 42, target: 115, color: '#14b8a6' },
            { id: 'lmn-456', name: 'Trial LMN-456', phase: 'Phase II', status: 'recruiting', sponsor: 'Celgene', enrolled: 14, target: 45, color: '#f97316' },
            { id: 'opq-789', name: 'Trial OPQ-789', phase: 'Phase I', status: 'active', sponsor: 'Genentech', enrolled: 6, target: 20, color: '#a855f7' },
            { id: 'rst-012', name: 'Trial RST-012', phase: 'Phase III', status: 'recruiting', sponsor: 'Abbvie', enrolled: 38, target: 100, color: '#22c55e' },
            { id: 'uvw-345', name: 'Trial UVW-345', phase: 'Phase II', status: 'active', sponsor: 'Novartis', enrolled: 19, target: 55, color: '#3b82f6' },
            { id: 'xyz-678', name: 'Trial XYZ-678', phase: 'Phase I', status: 'recruiting', sponsor: 'GSK', enrolled: 8, target: 25, color: '#ec4899' },
            { id: 'abc-901', name: 'Trial ABC-901', phase: 'Phase III', status: 'active', sponsor: 'Bayer', enrolled: 45, target: 120, color: '#f59e0b' },
        ],
    });

    const loadFullDataset = () => {
        // Full dataset with 25+ trials and extensive data
        const fullDataset = buildFullDataset();
        const stored = localStorage.getItem(STORAGE_KEY_FULL);
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as DemoState;
                const hydrated = withMode(migrateDemoStateMemberEmails(parsed), "full");
                const withSampleAvatars = syncModeAvatarsFromStoredSources(hydrated);
                setState(withSampleAvatars);
                localStorage.setItem(STORAGE_KEY_FULL, JSON.stringify(withSampleAvatars));
                return;
            } catch (e) {
                console.error("Failed to parse stored full state:", e);
            }
        }
        const nextState = syncModeAvatarsFromStoredSources(withMode(fullDataset, "full"));
        setState(nextState);
        localStorage.setItem(STORAGE_KEY_FULL, JSON.stringify(nextState));
    };

    const getFallbackDefaultStateForMode = (mode: DemoState["dataMode"]): DemoState => {
        if (mode === "building") {
            return syncModeAvatarsFromStoredSources(
                syncBuildingTeamMembersFromSample(
                    withMode(
                        {
                            tasks: [],
                            documents: [],
                            milestones: [],
                            teamMembers: [],
                            trials: [],
                            activeTrials: 0,
                            blockedTasks: 0,
                            dataMode: "building",
                        },
                        "building"
                    )
                )
            );
        }
        if (mode === "full") {
            return syncModeAvatarsFromStoredSources(withMode(buildFullDataset(), "full"));
        }
        return withMode(initialDemoState, "sample");
    };

    const readDefaultStateForMode = (mode: DemoState["dataMode"]) => {
        const fallbackState = getFallbackDefaultStateForMode(mode);
        const stored = localStorage.getItem(getDefaultStorageKeyForMode(mode));
        if (!stored) return fallbackState;
        try {
            const parsed = JSON.parse(stored) as DemoState;
            const hydrated = withMode(migrateDemoStateMemberEmails(parsed), mode);
            const modeAligned = mode === "building" ? syncBuildingTeamMembersFromSample(hydrated) : hydrated;
            return mode === "full" || mode === "building"
                ? syncModeAvatarsFromStoredSources(modeAligned)
                : modeAligned;
        } catch (error) {
            console.error(`Failed to parse stored default state for ${mode}:`, error);
            return fallbackState;
        }
    };

    const restoreModeFromDefaultLocal = (mode: DemoState["dataMode"]) => {
        const nextState = readDefaultStateForMode(mode);
        localStorage.setItem(getStorageKeyForMode(mode), JSON.stringify(nextState));
        setState((prev) => (prev.dataMode === mode ? nextState : prev));
    };

    const saveCurrentModeAsDefault = () => {
        const key = getDefaultStorageKeyForMode(state.dataMode);
        localStorage.setItem(key, JSON.stringify(withMode(state, state.dataMode)));
    };

    const fullResetLocal = (modeOverride?: DemoState["dataMode"]) => {
        const buildingState = readDefaultStateForMode("building");
        const sampleState = readDefaultStateForMode("sample");
        const fullState = readDefaultStateForMode("full");

        localStorage.setItem(STORAGE_KEY_BUILDING, JSON.stringify(buildingState));
        localStorage.setItem(STORAGE_KEY_SAMPLE, JSON.stringify(sampleState));
        localStorage.setItem(STORAGE_KEY_FULL, JSON.stringify(fullState));
        clearCollaborationDemoStorage();
        clearCollaborationDemoRuntimeCache();
        const targetMode = modeOverride ?? state.dataMode;
        if (targetMode === "full") {
            setState(fullState);
        } else if (targetMode === "building") {
            setState(buildingState);
        } else {
            setState(sampleState);
        }
    };

    const setBuildingMode = () => {
        const stored = localStorage.getItem(STORAGE_KEY_BUILDING);
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as DemoState;
                const hydrated = withMode(migrateDemoStateMemberEmails(parsed), "building");
                const withSampleMembers = syncBuildingTeamMembersFromSample(hydrated);
                setState(syncModeAvatarsFromStoredSources(withSampleMembers));
                return;
            } catch (e) {
                console.error("Failed to parse stored building state:", e);
            }
        }
        resetDemo();
    };

    const getCompletedTasksCount = () => {
        return state.tasks.filter((task) => task.completed).length;
    };

    const getActiveTasksCount = () => {
        return state.tasks.filter((task) => !task.completed).length;
    };

    const getCurrentDataMode = () => {
        return state.dataMode;
    };

    const getCloneStorageOverridesForMode = (mode: DemoState["dataMode"]) => {
        const baseState = alignStateToActiveOrganization(state);
        const nextState = (() => {
            if (mode === "building") {
                return syncModeAvatarsFromStoredSources(
                    syncBuildingTeamMembersFromSample(withMode(baseState, "building"))
                );
            }
            if (mode === "full") {
                return syncModeAvatarsFromStoredSources(withMode(baseState, "full"));
            }
            return withMode(baseState, "sample");
        })();

        return {
            [getStorageKeyForMode(mode)]: JSON.stringify(nextState),
            [getDefaultStorageKeyForMode(mode)]: JSON.stringify(nextState),
            [STORAGE_KEY_ACTIVE_MODE]: mode,
        };
    };

    return (
        <DemoStateContext.Provider
            value={{
                state,
                updateTask,
                addDocument,
                addTeamMember,
                updateTeamMember,
                updateMilestone,
                resetDemo,
                loadSampleData,
                loadFullDataset,
                restoreModeFromDefaultLocal,
                saveCurrentModeAsDefault,
                fullResetLocal,
                setBuildingMode,
                getCompletedTasksCount,
                getActiveTasksCount,
                getCurrentDataMode,
                getCloneStorageOverridesForMode,
            }}
        >
            {children}
        </DemoStateContext.Provider>
    );
}

export function useDemoState() {
    const context = useContext(DemoStateContext);
    if (context === undefined) {
        throw new Error("useDemoState must be used within a DemoStateProvider");
    }
    return context;
}
