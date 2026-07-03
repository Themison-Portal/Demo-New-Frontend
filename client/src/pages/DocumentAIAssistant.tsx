import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { unstable_batchedUpdates } from 'react-dom';
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Send,
    ArrowUp,
    FileText,
    Folder,
    FileSearch,
    List,
    ListChecks,
    Calendar,
    CheckSquare,
    PanelRight,
    Bot,
    Brain,
    Paperclip,
    Sparkles,
    Plus,
    ChevronDown,
    ChevronUp,
    ChevronRight,
    GripVertical,
    Edit3,
    BookOpen,
    ArrowLeft,
    Pen,
    Archive,
    ExternalLink,
    X,
    Maximize2,
    Minimize2,
    Mic,
    User,
    Copy,
    Check,
    Play,
    Bookmark,
    MessageSquare,
    AtSign,
    Mail,
    Database,
    Users,
    Globe,
    Circle,
    FlaskConical,
    Trash2,
    Search,
    Upload,
    Download
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useDemoState } from "@/contexts/DemoStateContext";
import { useOrganizationProfile } from "@/hooks/useOrganizationProfile";
import { useLocation } from "wouter";
import { getSessionId, logEvent } from "@/lib/telemetry";
import studySetupBackground from "@/assets/study-setup-background.svg";
import {
    CHAT_ACTIVE_UPDATED_EVENT,
    CHAT_NEW_REQUESTED_EVENT,
    CHAT_OPEN_REQUESTED_EVENT,
    CHAT_SESSIONS_UPDATED_EVENT,
    clearActiveChatSessionId,
    createChatSessionId,
    getActiveChatSessionId as getStoredActiveChatSessionId,
    listChatSessions,
    setActiveChatSessionId as setStoredActiveChatSessionId,
    upsertChatSession,
} from "@/lib/chatSessions";

interface DocumentAIAssistantProps {
    trialId?: string;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    thinking?: string; // AI's reasoning/thought process
    thoughtsSummary?: string; // UI-friendly summary (no raw chain-of-thought)
    sources?: Array<{
        filename: string;
        section?: string;
        excerpt?: string;
        fileId?: string;
        fileUrl?: string;
        documentId?: string;
        page?: number;
        category?: string;
        sourceType?: string;
        taskId?: string;
        trialId?: string;
        mapId?: string;
        dueDate?: string | null;
        taskStatus?: string | null;
        assignedRole?: string | null;
        assigneeName?: string | null;
        phaseName?: string | null;
        highlightUrl?: string;
        bboxes?: number[][];
    }>;
}

type TaskEditorFormState = {
    title: string;
    description: string;
    dueDate: string;
    priority: string;
    assignedRole: string;
    assigneeName: string;
    status: string;
};

const TASK_EDITOR_STATUS_OPTIONS = [
    "suggested",
    "confirmed",
    "todo",
    "in_progress",
    "blocked",
    "waiting",
    "done",
    "skipped",
    "cancelled",
] as const;

const TASK_EDITOR_PRIORITY_OPTIONS = ["critical", "high", "medium", "low"] as const;

const TASK_EDITOR_ROLE_OPTIONS = [
    "pi",
    "sub_i",
    "crc",
    "nurse",
    "pharmacist",
    "lab_tech",
    "data_manager",
    "regulatory_coordinator",
    "study_coordinator",
    "custom",
] as const;

type AddContextOption = {
    id: string;
    label: string;
    defaultSelected?: boolean;
    disabled?: boolean;
    hint?: string;
};

type AddContextCategory = {
    id: string;
    label: string;
    options: AddContextOption[];
};

const ADD_CONTEXT_CATEGORIES: AddContextCategory[] = [
    {
        id: "trial_context",
        label: "Trial context",
        options: [
            { id: "trial_current", label: "Current Trial (auto)", defaultSelected: true },
            { id: "trial_switch", label: "Switch Trial..." },
            { id: "trial_add_another", label: "Add another Trial..." },
        ],
    },
    {
        id: "documents",
        label: "Documents",
        options: [
            { id: "doc_protocol_latest", label: "Protocol (latest)", defaultSelected: true },
            { id: "doc_protocol_amendments", label: "Protocol Amendment(s)" },
            { id: "doc_ib_pharmacy_lab", label: "IB / Pharmacy / Lab Manual" },
            { id: "doc_site_sops", label: "SOPs (site SOPs)" },
            { id: "doc_uploaded", label: "Uploaded files..." },
        ],
    },
    {
        id: "execution_tasks",
        label: "Execution / Tasks",
        options: [
            { id: "tasks_soa", label: "Schedule of Activities" },
            { id: "tasks_board_current", label: "Task Board (current)", defaultSelected: true },
            { id: "tasks_selected", label: "Selected Task(s)..." },
            { id: "tasks_upcoming", label: "Upcoming (next 7 days)" },
            { id: "tasks_blocked", label: "Blocked tasks" },
            { id: "tasks_overdue", label: "Overdue tasks" },
        ],
    },
    {
        id: "collaboration",
        label: "Collaboration",
        options: [
            { id: "collab_this_thread", label: "This thread" },
            { id: "collab_recent_decisions", label: "Recent decisions (7 days)" },
            { id: "collab_open_questions", label: "Open questions" },
            { id: "collab_mentions_me", label: "Mentions of me" },
        ],
    },
    {
        id: "people_roles",
        label: "People & Roles",
        options: [
            { id: "people_my_role", label: "My role in this trial", defaultSelected: true },
            { id: "people_team_list", label: "Trial team list" },
            { id: "people_responsibilities", label: "Role responsibilities" },
        ],
    },
    {
        id: "systems_links",
        label: "Systems & Links",
        options: [
            { id: "systems_bookmarks", label: "Trial Systems / Bookmarks" },
            { id: "systems_integrations", label: "Connected Integrations", disabled: true, hint: "Soon" },
        ],
    },
];

const createDefaultSelectedContextIds = () => {
    const defaults = new Set<string>();
    ADD_CONTEXT_CATEGORIES.forEach((category) => {
        category.options.forEach((option) => {
            if (option.defaultSelected) {
                defaults.add(option.id);
            }
        });
    });
    return defaults;
};

const getAddContextCategoryIcon = (categoryId: string) => {
    switch (categoryId) {
        case "trial_context":
            return FlaskConical;
        case "documents":
            return FileText;
        case "execution_tasks":
            return ListChecks;
        case "collaboration":
            return MessageSquare;
        case "people_roles":
            return Users;
        case "systems_links":
            return Globe;
        default:
            return FileText;
    }
};

const getAddContextOptionIcon = (option: AddContextOption, isSelected: boolean) => {
    if (isSelected) {
        return <Check className="h-4 w-4 text-blue-600" />;
    }
    if (option.id === "trial_switch") {
        return <Search className="h-4 w-4 text-gray-400" />;
    }
    if (option.id === "trial_add_another") {
        return <Plus className="h-4 w-4 text-gray-400" />;
    }
    if (option.id === "doc_uploaded") {
        return <Upload className="h-4 w-4 text-gray-400" />;
    }
    return <Circle className="h-4 w-4 text-gray-300" />;
};

type WorksheetBlockType =
    | "text"
    | "heading1"
    | "heading2"
    | "heading3"
    | "checklist"
    | "bulleted"
    | "numbered"
    | "quote"
    | "callout"
    | "divider"
    | "code";

type WorksheetAICommandId = "find_protocol_section" | "draft_trial_overview" | "draft_visit_paragraph";
type WorksheetCommandGroup = "basic" | "advanced" | "themison";
type WorksheetInsertPlacement = "start" | "end" | "after";

type WorksheetCommand =
    | {
        kind: "block";
        group: WorksheetCommandGroup;
        type: WorksheetBlockType;
        title: string;
        subtitle: string;
        shortcut?: string;
    }
    | {
        kind: "ai";
        group: "themison";
        action: WorksheetAICommandId;
        title: string;
        subtitle: string;
        shortcut?: string;
    };

type WorksheetAttributeAction = {
    id: string;
    category: "sections" | "layout";
    type: WorksheetBlockType;
    title: string;
    subtitle: string;
    shortcut?: string;
    initialContent: string;
};

type WorksheetBlock = {
    id: string;
    type: WorksheetBlockType;
    content: string;
    checked?: boolean;
};

type WorksheetDraftStatus = "draft" | "published";

type WorksheetDraft = {
    id: string;
    trialId: string | null;
    dataMode: 'sample' | 'full' | 'building';
    chatSessionId?: string | null;
    sourceMessageIndex: number;
    sourceQuestion: string;
    title: string;
    subtitle: string;
    blocks: WorksheetBlock[];
    sources: Array<{ filename: string; section?: string; excerpt?: string; fileUrl?: string; documentId?: string; page?: number | null; category?: string; highlightUrl?: string }>;
    status: WorksheetDraftStatus;
    createdAt: string;
    updatedAt: string;
    savedAt?: string | null;
    publishedAt?: string | null;
    generatedAt: string;
    generatedBy: string;
    sponsor?: string | null;
    protocolNumber?: string | null;
    protocolVersion?: string | null;
    amendmentVersion?: string | null;
};

interface ArchiveFolderGroup {
    id: string;
    label: string;
    expanded: boolean;
    folders: Array<{
        id: string;
        label: string;
    }>;
}

interface ResponseArchiveItem {
    id: string;
    groupId: string;
    folderId: string;
    trialId?: string | null;
    dataMode: 'sample' | 'full' | 'building';
    queriedBy: string;
    queriedByEmail?: string | null;
    question: string;
    answer: string;
    title: string;
    savedAt: string;
    trialLabel: string;
    sources: Array<{ filename: string; section?: string; page?: number; category?: string }>;
}

const RESPONSE_ARCHIVE_STORAGE_KEY = "themison-response-archive:v1";
const WORKSHEET_STORAGE_KEY = "themison-worksheet-drafts:v1";
const WORKSHEET_OPEN_REQUEST_KEY = "themison-open-worksheet-request:v1";

const WORKSHEET_COMMANDS: WorksheetCommand[] = [
    {
        kind: "block",
        group: "basic",
        type: "text",
        title: "Text",
        subtitle: "Basic paragraph block",
        shortcut: "T",
    },
    {
        kind: "block",
        group: "basic",
        type: "heading1",
        title: "Heading 1",
        subtitle: "Large section heading",
        shortcut: "#",
    },
    {
        kind: "block",
        group: "basic",
        type: "heading2",
        title: "Heading 2",
        subtitle: "Medium section heading",
        shortcut: "##",
    },
    {
        kind: "block",
        group: "basic",
        type: "heading3",
        title: "Heading 3",
        subtitle: "Small section heading",
        shortcut: "###",
    },
    {
        kind: "block",
        group: "basic",
        type: "bulleted",
        title: "Bulleted list",
        subtitle: "Unordered list item",
        shortcut: "-",
    },
    {
        kind: "block",
        group: "basic",
        type: "numbered",
        title: "Numbered list",
        subtitle: "Ordered list item",
        shortcut: "1.",
    },
    {
        kind: "block",
        group: "basic",
        type: "checklist",
        title: "To-do list",
        subtitle: "Trackable checkbox item",
        shortcut: "[]",
    },
    {
        kind: "block",
        group: "advanced",
        type: "quote",
        title: "Quote",
        subtitle: "Cited protocol quotation",
        shortcut: "\"",
    },
    {
        kind: "block",
        group: "advanced",
        type: "callout",
        title: "Callout",
        subtitle: "Highlighted instruction",
    },
    {
        kind: "block",
        group: "advanced",
        type: "divider",
        title: "Divider",
        subtitle: "Visual section break",
        shortcut: "---",
    },
    {
        kind: "block",
        group: "advanced",
        type: "code",
        title: "Code",
        subtitle: "Monospace block",
        shortcut: "</>",
    },
    {
        kind: "ai",
        group: "themison",
        action: "find_protocol_section",
        title: "Find section in protocol",
        subtitle: "Attach the best-matching section here",
        shortcut: "AI",
    },
    {
        kind: "ai",
        group: "themison",
        action: "draft_trial_overview",
        title: "Draft trial overview",
        subtitle: "Generate a formal trial summary paragraph",
        shortcut: "AI",
    },
    {
        kind: "ai",
        group: "themison",
        action: "draft_visit_paragraph",
        title: "Draft visit paragraph",
        subtitle: "Generate a concise visit operations paragraph",
        shortcut: "AI",
    },
];

const WORKSHEET_ATTRIBUTE_ACTIONS: WorksheetAttributeAction[] = [
    {
        id: "section-indication",
        category: "sections",
        type: "heading2",
        title: "Indication Section",
        subtitle: "Insert a protocol indication heading",
        initialContent: "Indication Section",
    },
    {
        id: "section-generic",
        category: "sections",
        type: "heading2",
        title: "Section",
        subtitle: "Insert a generic section heading",
        initialContent: "Section",
    },
    {
        id: "layout-h1",
        category: "layout",
        type: "heading1",
        title: "Heading 1",
        subtitle: "Large section heading",
        shortcut: "#",
        initialContent: "Heading 1",
    },
    {
        id: "layout-h2",
        category: "layout",
        type: "heading2",
        title: "Heading 2",
        subtitle: "Medium section heading",
        shortcut: "##",
        initialContent: "Heading 2",
    },
    {
        id: "layout-h3",
        category: "layout",
        type: "heading3",
        title: "Heading 3",
        subtitle: "Small section heading",
        shortcut: "###",
        initialContent: "Heading 3",
    },
    {
        id: "layout-text",
        category: "layout",
        type: "text",
        title: "Paragraph",
        subtitle: "Body paragraph block",
        shortcut: "T",
        initialContent: "Write section details...",
    },
];

function normalizeWorksheetBlockType(value?: string): WorksheetBlockType {
    const token = String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    if (token === "heading1" || token === "h1") return "heading1";
    if (token === "heading2" || token === "h2") return "heading2";
    if (token === "heading3" || token === "h3") return "heading3";
    if (token === "bulleted" || token === "bullet" || token === "bulletedlist" || token === "unordered") return "bulleted";
    if (token === "numbered" || token === "numberedlist" || token === "ordered" || token === "ol") return "numbered";
    if (token === "quote" || token === "blockquote") return "quote";
    if (token === "callout" || token === "note") return "callout";
    if (token === "divider" || token === "line" || token === "hr") return "divider";
    if (token === "code" || token === "snippet") return "code";
    if (token === "checklist" || token === "checkbox" || token === "todo") return "checklist";
    return "text";
}

function titleCase(value: string) {
    return String(value || "")
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
}

function worksheetCommandGroupLabel(group: WorksheetCommandGroup) {
    if (group === "basic") return "Basic blocks";
    if (group === "advanced") return "Advanced blocks";
    return "Themison AI";
}

function detectPromptPlacement(text: string): WorksheetInsertPlacement {
    const value = String(text || "").toLowerCase();
    if (
        /\b(at|to|in)\s+(the\s+)?(beginning|start|top)\b/.test(value) ||
        /\bprepend\b/.test(value)
    ) {
        return "start";
    }
    if (/\b(at|to)\s+(the\s+)?end\b/.test(value) || /\bappend\b/.test(value)) {
        return "end";
    }
    return "after";
}

function parseExplicitPromptPlacement(text: string): WorksheetInsertPlacement | null {
    const value = String(text || "").toLowerCase();
    if (
        /\b(at|to|in)\s+(the\s+)?(beginning|start|top)\b/.test(value) ||
        /\bprepend\b/.test(value)
    ) {
        return "start";
    }
    if (/\b(at|to)\s+(the\s+)?end\b/.test(value) || /\bappend\b/.test(value)) {
        return "end";
    }
    if (/\b(after|below|under)\b/.test(value)) {
        return "after";
    }
    return null;
}

function inferWorksheetActionFromPrompt(text: string): WorksheetAICommandId {
    const value = String(text || "").toLowerCase();
    if (/\b(section|protocol|where in (the )?protocol|attach section|citation)\b/.test(value)) {
        return "find_protocol_section";
    }
    if (/\b(summary|overview|what this trial is about|purpose of (this )?template|intro|introduction)\b/.test(value)) {
        return "draft_trial_overview";
    }
    return "draft_visit_paragraph";
}

function sanitizeWriterText(text: string) {
    return String(text || "")
        .replace(/【[^】]+】/g, "")
        .replace(/\*\*verbatim evidence\*\*/gi, "")
        .replace(/\[source:[^\]]+\]/gi, "")
        .replace(/^source:\s.*$/gim, "")
        .replace(/^section:\s.*$/gim, "")
        .replace(/^procedure guidance.*$/gim, "")
        .replace(/^required at:.*$/gim, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function escapeHtml(text: string) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function extractFirstJsonObject(raw: string) {
    const text = String(raw || "").trim();
    if (!text) return null;
    const start = text.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === "\"") {
                inString = false;
            }
            continue;
        }
        if (ch === "\"") {
            inString = true;
            continue;
        }
        if (ch === "{") depth += 1;
        if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
                const candidate = text.slice(start, i + 1);
                try {
                    return JSON.parse(candidate) as any;
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

function readRuntimeUserInfo() {
    try {
        const raw = window.localStorage.getItem("manus-runtime-user-info");
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const name =
            String(parsed?.name || "").trim() ||
            [parsed?.firstName, parsed?.lastName]
                .map((item) => String(item || "").trim())
                .filter(Boolean)
                .join(" ")
                .trim();
        const email = String(parsed?.email || "").trim() || null;
        if (!name && !email) return null;
        return { name: name || null, email };
    } catch {
        return null;
    }
}

function toDateInputValue(value?: string | Date | null): string {
    if (!value) return "";
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function toIsoDateTime(value: string): string | null {
    if (!value) return null;
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function parseTaskEditorLinkHref(href?: string | null) {
    const raw = String(href || "").trim();
    if (!raw) return null;
    let parsed: URL;
    try {
        parsed = new URL(raw, "https://themison.local");
    } catch {
        return null;
    }

    const isThemisonTaskLink =
        (parsed.protocol === "themison:" &&
            (parsed.hostname === "task" || parsed.pathname.replace(/^\/+/, "") === "task")) ||
        (parsed.hostname === "themison.local" && parsed.pathname.replace(/\/+$/, "") === "/__themison/task");
    if (!isThemisonTaskLink) return null;

    const taskId = parsed.searchParams.get("taskId")?.trim();
    if (!taskId) return null;
    const trialId = parsed.searchParams.get("trialId")?.trim() || undefined;
    const mapId = parsed.searchParams.get("mapId")?.trim() || undefined;
    const taskName = parsed.searchParams.get("taskName")?.trim() || undefined;

    return {
        taskId,
        trialId,
        mapId,
        taskName,
    };
}

type ArchiveFolderDialogMode = "save" | "move";
type ArchiveFolderDialogStep = "select" | "create";

export default function DocumentAIAssistant({ trialId }: DocumentAIAssistantProps) {
    const [, navigate] = useLocation();
    const { getCurrentDataMode, state: demoState } = useDemoState();
    const { profile: organizationProfile, organizationInitial } = useOrganizationProfile();
    const currentDataMode = getCurrentDataMode();
    const [message, setMessage] = useState("");
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
    const [showMorePrompts, setShowMorePrompts] = useState(false);
    const [activeTab, setActiveTab] = useState<"ai-assistant" | "response-archive">("ai-assistant");
    const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
    const [pdfViewerExpanded, setPdfViewerExpanded] = useState(false);
    const [selectedDocument, setSelectedDocument] = useState<{ name: string, url: string, page?: number, section?: string, excerpt?: string } | null>(null);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [taskPaneOpen, setTaskPaneOpen] = useState(false);
    const [taskPaneExpanded, setTaskPaneExpanded] = useState(false);
    const [taskPaneMode, setTaskPaneMode] = useState<"source" | "worksheet">("source");
    const [taskPaneDocument, setTaskPaneDocument] = useState<{ name: string; url: string; openUrl?: string; section?: string; page?: number; excerpt?: string } | null>(null);
    const [taskPaneOpenedAt, setTaskPaneOpenedAt] = useState<number | null>(null);
    const [taskEditorOpen, setTaskEditorOpen] = useState(false);
    const [taskEditorSource, setTaskEditorSource] = useState<{
        taskId: string;
        trialId?: string;
        mapId?: string;
    } | null>(null);
    const [taskManagerOverlayOpen, setTaskManagerOverlayOpen] = useState(false);
    const [taskManagerOverlayUrl, setTaskManagerOverlayUrl] = useState<string | null>(null);
    const [liveSourceMeta, setLiveSourceMeta] = useState<Record<string, { highlightUrl?: string; bboxes?: number[][] }>>({});
    const [taskEditorSeededTaskId, setTaskEditorSeededTaskId] = useState<string | null>(null);
    const [taskEditorForm, setTaskEditorForm] = useState<TaskEditorFormState>({
        title: "",
        description: "",
        dueDate: "",
        priority: "medium",
        assignedRole: "",
        assigneeName: "",
        status: "todo",
    });
    const [worksheetDrafts, setWorksheetDrafts] = useState<WorksheetDraft[]>([]);
    const [activeWorksheetId, setActiveWorksheetId] = useState<string | null>(null);
    const [worksheetGenerationMessageIndex, setWorksheetGenerationMessageIndex] = useState<number | null>(null);
    const [isWorksheetPaneGenerating, setIsWorksheetPaneGenerating] = useState(false);
    const [dismissedWorksheetSuggestionIds, setDismissedWorksheetSuggestionIds] = useState<Set<string>>(new Set());
    const [slashMenu, setSlashMenu] = useState<{ blockId: string; query: string } | null>(null);
    const [insertMenu, setInsertMenu] = useState<{ blockId: string; query: string } | null>(null);
    const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
    const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);
    const [floatingAIOpen, setFloatingAIOpen] = useState(false);
    const [floatingAIPrompt, setFloatingAIPrompt] = useState("");
    const [floatingAILoading, setFloatingAILoading] = useState(false);
    const [worksheetSidebarSearch, setWorksheetSidebarSearch] = useState("");
    const [worksheetSidebarTab, setWorksheetSidebarTab] = useState<"attributes" | "basic">("attributes");
    const [activeWorksheetBlockId, setActiveWorksheetBlockId] = useState<string | null>(null);
    const [documentStyle, setDocumentStyle] = useState<{
        fontFamily: "times" | "calibri" | "arial";
        bodySize: "11" | "12" | "14";
        lineSpacing: "1.15" | "1.5";
    }>({
        fontFamily: "times",
        bodySize: "12",
        lineSpacing: "1.15",
    });
    // If trialId is provided, we're in trial-specific mode; otherwise, search all trials
    const searchMode = trialId ? 'single' : 'all';
    const selectedTrialId = trialId || 'all';
    const [sourceModalOpen, setSourceModalOpen] = useState(false);
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const [activeContextCategoryId, setActiveContextCategoryId] = useState<string>(
        ADD_CONTEXT_CATEGORIES[0]?.id || ""
    );
    const [selectedContextIds, setSelectedContextIds] = useState<Set<string>>(() =>
        createDefaultSelectedContextIds()
    );

    useEffect(() => {
        console.log('sourceModalOpen state changed to:', sourceModalOpen);
    }, [sourceModalOpen]);
    const [selectedTrials, setSelectedTrials] = useState<string[]>(trialId ? [trialId] : []);
    const [activeTrials, setActiveTrials] = useState<string[]>(trialId ? [trialId] : []);
    // Document ids are BE document UUIDs (strings) — documents are BE-owned.
    const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
    const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});
    const [isAllDocumentsMode, setIsAllDocumentsMode] = useState(true); // Default to searching all documents
    const [autoScoped, setAutoScoped] = useState(false);
    const [archiveGroups, setArchiveGroups] = useState<ArchiveFolderGroup[]>([]);
    const [archiveItems, setArchiveItems] = useState<ResponseArchiveItem[]>([]);
    const [archiveHydrated, setArchiveHydrated] = useState(false);
    const [selectedArchiveFolderId, setSelectedArchiveFolderId] = useState<string | null>(null);
    const [selectedArchiveItemId, setSelectedArchiveItemId] = useState<string | null>(null);
    const [archiveSearchQuery, setArchiveSearchQuery] = useState("");
    const [archiveSearchOpen, setArchiveSearchOpen] = useState(false);
    const [archiveFolderDialogOpen, setArchiveFolderDialogOpen] = useState(false);
    const [archiveFolderDialogMode, setArchiveFolderDialogMode] = useState<ArchiveFolderDialogMode>("save");
    const [archiveFolderDialogStep, setArchiveFolderDialogStep] = useState<ArchiveFolderDialogStep>("select");
    const [archiveDialogSelectedFolderId, setArchiveDialogSelectedFolderId] = useState<string | null>(null);
    const [archiveDialogNewFolderName, setArchiveDialogNewFolderName] = useState("");
    const [archiveDialogNewFolderGroupId, setArchiveDialogNewFolderGroupId] = useState<string>("no-trial");
    const [renamingFolder, setRenamingFolder] = useState<{ groupId: string; folderId: string } | null>(null);
    const [renamingFolderValue, setRenamingFolderValue] = useState("");
    const [pendingFolderDelete, setPendingFolderDelete] = useState<{
        groupId: string;
        folderId: string;
        folderLabel: string;
        movedCount: number;
    } | null>(null);
    const [pendingArchiveSave, setPendingArchiveSave] = useState<{ messageEntry: ChatMessage; messageIndex: number } | null>(null);
    const [pendingArchiveMoveItemId, setPendingArchiveMoveItemId] = useState<string | null>(null);
    const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const archiveSearchInputRef = useRef<HTMLInputElement>(null);
    const sourceMetaRef = useRef<Map<string, { highlightUrl?: string; bboxes?: number[][] }>>(new Map());
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const contextMenuRef = useRef<HTMLDivElement | null>(null);
    const modalTrialIds = trialId ? [trialId] : selectedTrials;

    const activeContextCategory = useMemo(
        () =>
            ADD_CONTEXT_CATEGORIES.find((category) => category.id === activeContextCategoryId) ||
            ADD_CONTEXT_CATEGORIES[0],
        [activeContextCategoryId]
    );

    useEffect(() => {
        if (!contextMenuOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (!contextMenuRef.current) return;
            if (contextMenuRef.current.contains(event.target as Node)) return;
            setContextMenuOpen(false);
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setContextMenuOpen(false);
            }
        };
        window.addEventListener("pointerdown", handlePointerDown);
        window.addEventListener("keydown", handleEscape);
        return () => {
            window.removeEventListener("pointerdown", handlePointerDown);
            window.removeEventListener("keydown", handleEscape);
        };
    }, [contextMenuOpen]);

    const toggleContextOption = (option: AddContextOption) => {
        if (option.disabled) return;
        setSelectedContextIds((previous) => {
            const next = new Set(previous);
            if (next.has(option.id)) {
                next.delete(option.id);
            } else {
                next.add(option.id);
            }
            return next;
        });
    };

    const toggleSourceModalTrial = useCallback((targetTrialId: string) => {
        if (trialId) return;
        setSelectedTrials((previousTrials) =>
            previousTrials.includes(targetTrialId)
                ? previousTrials.filter((id) => id !== targetTrialId)
                : [...previousTrials, targetTrialId]
        );
        // Reset selected documents when trial selection changes to avoid stale cross-trial scope.
        setSelectedDocuments([]);
    }, [trialId]);

    const renderAddContextMenu = () => {
        if (!contextMenuOpen || !activeContextCategory) return null;
        return (
            <div className="absolute bottom-full left-0 z-40 mb-2 w-[520px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                <div className="grid grid-cols-[200px_1fr]">
                    <div className="max-h-[320px] overflow-y-auto border-r border-gray-200 bg-gray-50/60 py-2">
                        <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
                            Add context
                        </p>
                        {ADD_CONTEXT_CATEGORIES.map((category) => {
                            const isActive = category.id === activeContextCategoryId;
                            const CategoryIcon = getAddContextCategoryIcon(category.id);
                            return (
                                <button
                                    key={category.id}
                                    type="button"
                                    onClick={() => setActiveContextCategoryId(category.id)}
                                    className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors ${isActive ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-100"
                                        }`}
                                >
                                    <span className="flex items-center gap-2 text-sm">
                                        <CategoryIcon className="h-4 w-4 text-gray-500" />
                                        {category.label}
                                    </span>
                                    <ChevronRight className="h-4 w-4 text-gray-400" />
                                </button>
                            );
                        })}
                    </div>
                    <div className="max-h-[320px] overflow-y-auto py-2">
                        <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
                            {activeContextCategory.label}
                        </p>
                        <div className="space-y-1">
                            {activeContextCategory.options.map((option) => {
                                const isSelected = selectedContextIds.has(option.id);
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        disabled={option.disabled}
                                        onClick={() => toggleContextOption(option)}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${option.disabled ? "cursor-not-allowed opacity-60" : "text-gray-700 hover:bg-gray-50"
                                            }`}
                                    >
                                        <span className="shrink-0">{getAddContextOptionIcon(option, isSelected)}</span>
                                        <span className="min-w-0 flex-1 text-sm">
                                            {option.label}
                                            {option.hint ? <span className="ml-1 text-xs text-gray-400">({option.hint})</span> : null}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderSourceModal = () => (
        <Dialog
            open={sourceModalOpen}
            onOpenChange={(open) => {
                setSourceModalOpen(open);
                if (open) {
                    logEvent({
                        eventType: "feature_used",
                        action: "open_sources",
                        entityType: "document_sources_modal",
                        payload: { trialId, demoMode: currentDataMode },
                    });
                }
            }}
        >
            <DialogContent
                showCloseButton={false}
                className="!w-[1200px] !max-w-[90vw] h-[680px] p-0 overflow-hidden flex flex-col"
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <DialogTitle className="text-lg font-semibold text-gray-900">
                        Select Document
                    </DialogTitle>
                    <DialogClose asChild>
                        <button
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                            aria-label="Close modal"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </DialogClose>
                </div>
                <div className="flex flex-1 overflow-hidden">
                    <div className="w-1/3 border-r border-gray-200 overflow-y-auto">
                        <div className="p-2">
                            {trialId ? (
                                <div className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded text-left bg-blue-50 text-blue-700">
                                    <input
                                        type="checkbox"
                                        checked
                                        readOnly
                                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                                    />
                                    <FlaskConical className="w-4 h-4 shrink-0" />
                                    <span className="truncate">{scopedTrial?.title || trialId}</span>
                                </div>
                            ) : trialsWithDocs && trialsWithDocs.length > 0 ? (
                                <div className="space-y-0.5">
                                    {trialsWithDocs.map((trial) => {
                                        const selected = selectedTrials.includes(trial.id);
                                        return (
                                            <button
                                                key={trial.id}
                                                type="button"
                                                onClick={() => toggleSourceModalTrial(trial.id)}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-left ${selected
                                                    ? "bg-blue-50 text-blue-700"
                                                    : "text-gray-700 hover:bg-gray-50"
                                                    }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selected}
                                                    onChange={() => toggleSourceModalTrial(trial.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                                                />
                                                <FlaskConical className="w-4 h-4 shrink-0" />
                                                <span className="truncate">{trial.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="px-3 py-2 text-xs text-gray-500">
                                    No trials with documents available
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        <div className="p-3">
                            {modalTrialIds.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
                                    {trialId
                                        ? "No documents available for this trial yet."
                                        : "Select at least one trial to view documents"}
                                </div>
                            ) : Object.keys(sourceDocumentsByTrial).length > 0 ? (
                                <div className="space-y-4">
                                    {modalTrialIds.map(trialId => {
                                        const docs = sourceDocumentsByTrial[trialId];
                                        if (!docs || docs.length === 0) return null;
                                        return (
                                            <div key={trialId}>
                                                <div className="space-y-1">
                                                    {docs.map((doc: any) => {
                                                        const selected = selectedDocuments.includes(doc.id);
                                                        return (
                                                            <button
                                                                key={doc.id}
                                                                type="button"
                                                                onClick={() => {
                                                                    if (selected) {
                                                                        setSelectedDocuments(selectedDocuments.filter(id => id !== doc.id));
                                                                    } else {
                                                                        setSelectedDocuments([...selectedDocuments, doc.id]);
                                                                    }
                                                                }}
                                                                className={`w-full flex items-start gap-3 px-3 py-3 rounded border-2 transition-all text-left ${selected
                                                                    ? "border-blue-200 bg-blue-50/40"
                                                                    : "border-transparent hover:bg-gray-50"
                                                                    }`}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selected}
                                                                    onChange={() => {
                                                                        if (selected) {
                                                                            setSelectedDocuments(selectedDocuments.filter(id => id !== doc.id));
                                                                        } else {
                                                                            setSelectedDocuments([...selectedDocuments, doc.id]);
                                                                        }
                                                                    }}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600"
                                                                />
                                                                <FileText className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                                                                <div className="flex-1 min-w-0 space-y-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <p className="text-sm font-medium text-gray-900 truncate">
                                                                            {doc.filename}
                                                                        </p>
                                                                        {doc.category && (
                                                                            <span className="px-2 py-0.5 text-xs font-medium rounded-full shrink-0 bg-blue-100 text-blue-700">
                                                                                {doc.category}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                <div className="mt-4 px-3">
                                                    <p className="text-xs text-gray-500">
                                                        {docs.length} document{docs.length !== 1 ? "s" : ""}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
                                    {trialId
                                        ? "No documents available for this trial yet."
                                        : "No documents available for selected trial(s)"}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
                    <Button variant="outline" onClick={() => setSourceModalOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => {
                            if (selectedDocuments.length === 0) {
                                setIsAllDocumentsMode(true);
                                if (trialId) {
                                    setSelectedTrials([trialId]);
                                    setActiveTrials([trialId]);
                                } else {
                                    setSelectedTrials([]);
                                    setActiveTrials([]);
                                }
                                setSelectedDocuments([]);
                                setSourceModalOpen(false);
                                toast.success(
                                    trialId
                                        ? "Now searching all documents"
                                        : "Now searching cross-trial documents and operational data"
                                );
                                return;
                            }
                            setIsAllDocumentsMode(false);
                            setActiveTrials(modalTrialIds);
                            setSourceModalOpen(false);
                            toast.success(`Now querying ${selectedDocuments.length} selected document(s)`);
                        }}
                    >
                        Select
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );

    const renderArchiveFolderDialog = () => {
        const scopedGroupId = trialId ? getArchiveGroupIdForTrial(trialId) : null;
        const folderGroups = scopedGroupId
            ? archiveGroups.filter((group) => group.id === scopedGroupId)
            : archiveGroups;
        const scopedGroupLabel = folderGroups[0]?.label || "THIS TRIAL";
        const selectedFolderGroup = folderGroups.find((group) =>
            group.folders.some((folder) => folder.id === archiveDialogSelectedFolderId)
        );
        const selectedFolder =
            selectedFolderGroup?.folders.find((folder) => folder.id === archiveDialogSelectedFolderId) || null;
        const isStandaloneCreateFlow =
            archiveFolderDialogStep === "create" && !pendingArchiveSave && !pendingArchiveMoveItemId;
        return (
            <Dialog
                open={archiveFolderDialogOpen}
                onOpenChange={(open) => {
                    setArchiveFolderDialogOpen(open);
                    if (!open) {
                        setArchiveFolderDialogStep("select");
                        setArchiveDialogNewFolderName("");
                    }
                }}
            >
                <DialogContent showCloseButton={false} className="sm:max-w-[620px] p-0 overflow-hidden">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                        <DialogTitle className="text-lg font-semibold text-gray-900">
                            {archiveFolderDialogStep === "create"
                                ? "Create folder"
                                : archiveFolderDialogMode === "save"
                                    ? "Save to QA Repository"
                                    : "Move response"}
                        </DialogTitle>
                        <DialogClose asChild>
                            <button
                                className="text-gray-400 hover:text-gray-600 transition-colors"
                                aria-label="Close modal"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </DialogClose>
                    </div>
                    <div className="px-6 py-4 space-y-4">
                        {archiveFolderDialogStep === "select" ? (
                            <>
                                <div className="rounded-lg border border-gray-200 max-h-72 overflow-y-auto">
                                    <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                                        <span className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Folders</span>
                                        <button
                                            type="button"
                                            className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                                            onClick={() => {
                                                setArchiveDialogNewFolderName("");
                                                setArchiveFolderDialogStep("create");
                                            }}
                                        >
                                            Create folder
                                        </button>
                                    </div>
                                    <div className="px-2 py-2 space-y-1">
                                        {folderGroups.length === 0 ? (
                                            <div className="px-3 py-2 text-sm text-gray-500">No folders available</div>
                                        ) : (
                                            folderGroups.map((group) => (
                                                <div key={`archive-dialog-group-${group.id}`} className="space-y-1">
                                                    <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                                        {group.label}
                                                    </div>
                                                    {group.folders.map((folder) => (
                                                        <button
                                                            key={`archive-dialog-folder-${folder.id}`}
                                                            type="button"
                                                            onClick={() => {
                                                                setArchiveDialogSelectedFolderId(folder.id);
                                                                setArchiveDialogNewFolderGroupId(group.id);
                                                            }}
                                                            className={`w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm ${archiveDialogSelectedFolderId === folder.id
                                                                ? "bg-blue-50 text-blue-700"
                                                                : "text-gray-700 hover:bg-gray-50"
                                                                }`}
                                                        >
                                                            <Folder className="w-4 h-4" />
                                                            <span className="truncate">{folder.label}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3">
                                    <p className="text-xs font-semibold tracking-wide text-blue-700 uppercase">Destination</p>
                                    <p className="text-sm text-blue-900 mt-1">
                                        {selectedFolder
                                            ? `${selectedFolderGroup?.label || scopedGroupLabel} / ${selectedFolder.label}`
                                            : "No folder selected"}
                                    </p>
                                </div>
                            </>
                        ) : (
                            <div className="rounded-lg border border-gray-200 px-4 py-4 space-y-4">
                                {!isStandaloneCreateFlow ? (
                                    <button
                                        type="button"
                                        onClick={() => setArchiveFolderDialogStep("select")}
                                        className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
                                    >
                                        <ArrowLeft className="h-4 w-4" />
                                        Back to folders
                                    </button>
                                ) : null}
                                <div className="space-y-3">
                                    <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Create new folder</p>
                                    {scopedGroupId ? (
                                        <p className="text-xs text-gray-500">
                                            New folder will be created under <span className="font-semibold text-gray-700">{scopedGroupLabel}</span>.
                                        </p>
                                    ) : null}
                                    <div className="flex items-center gap-2">
                                        {!scopedGroupId ? (
                                            <select
                                                value={archiveDialogNewFolderGroupId}
                                                onChange={(event) => setArchiveDialogNewFolderGroupId(event.target.value)}
                                                className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700"
                                            >
                                                {folderGroups.map((group) => (
                                                    <option key={`archive-dialog-group-option-${group.id}`} value={group.id}>
                                                        {group.label}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : null}
                                        <input
                                            type="text"
                                            value={archiveDialogNewFolderName}
                                            onChange={(event) => setArchiveDialogNewFolderName(event.target.value)}
                                            placeholder="Folder name"
                                            className="h-9 flex-1 rounded-md border border-gray-300 px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
                        {archiveFolderDialogStep === "create" ? (
                            <>
                                {!isStandaloneCreateFlow ? (
                                    <Button variant="outline" onClick={() => setArchiveFolderDialogStep("select")}>
                                        Back
                                    </Button>
                                ) : (
                                    <Button variant="outline" onClick={() => setArchiveFolderDialogOpen(false)}>
                                        Cancel
                                    </Button>
                                )}
                                <Button onClick={handleCreateArchiveFolderFromDialog}>Create folder</Button>
                            </>
                        ) : (
                            <>
                                <Button variant="outline" onClick={() => setArchiveFolderDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={handleConfirmArchiveFolderDialog}>
                                    {archiveFolderDialogMode === "save" ? "Save response" : "Move response"}
                                </Button>
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        );
    };

    const renderDeleteFolderDialog = () => (
        <Dialog open={!!pendingFolderDelete} onOpenChange={(open) => !open && setPendingFolderDelete(null)}>
            <DialogContent showCloseButton={false} className="sm:max-w-[460px] p-0 overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <DialogTitle className="text-lg font-semibold text-gray-900">Delete folder</DialogTitle>
                    <DialogClose asChild>
                        <button
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                            aria-label="Close modal"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </DialogClose>
                </div>
                <div className="px-6 py-4 space-y-2">
                    <p className="text-sm text-gray-700">
                        {pendingFolderDelete
                            ? `Delete "${pendingFolderDelete.folderLabel}"?`
                            : "Delete this folder?"}
                    </p>
                    {pendingFolderDelete && pendingFolderDelete.movedCount > 0 ? (
                        <p className="text-sm text-gray-500">
                            {pendingFolderDelete.movedCount} saved response(s) will move to{" "}
                            <span className="font-medium text-gray-700">Saved Responses</span>.
                        </p>
                    ) : null}
                </div>
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
                    <Button variant="outline" onClick={() => setPendingFolderDelete(null)}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={() => {
                            if (!pendingFolderDelete) return;
                            const { groupId, folderId } = pendingFolderDelete;
                            const group = archiveGroups.find((entry) => entry.id === groupId);
                            if (!group) {
                                setPendingFolderDelete(null);
                                return;
                            }
                            const targetFolderId = getDefaultArchiveFolderId(groupId);
                            setArchiveGroups((prev) =>
                                prev.map((entry) =>
                                    entry.id === groupId
                                        ? { ...entry, folders: entry.folders.filter((target) => target.id !== folderId) }
                                        : entry
                                )
                            );
                            setArchiveItems((prev) =>
                                prev.map((item) =>
                                    item.folderId === folderId
                                        ? {
                                            ...item,
                                            folderId: targetFolderId,
                                            groupId,
                                            trialLabel: group.label,
                                        }
                                        : item
                                )
                            );
                            if (selectedArchiveFolderId === folderId) {
                                setSelectedArchiveFolderId(targetFolderId);
                            }
                            setPendingFolderDelete(null);
                            toast.success("Folder deleted");
                        }}
                    >
                        Delete folder
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );

    const chatMutation = trpc.documentAI.chat.useMutation();
    const generateWorksheetMutation = trpc.documentAI.generateWorksheet.useMutation();
    const updateTaskMutation = trpc.map.updateTask.useMutation();
    const changeTaskStatusMutation = trpc.map.changeTaskStatus.useMutation();
    const { data: allTrials = [] } = trpc.trials.list.useQuery({ demoMode: currentDataMode });

    // Query all trials with documents
    const { data: trialsWithDocs } = trpc.documents.getTrialsWithDocuments.useQuery({
        demoMode: currentDataMode,
    });

    // Query documents for all selected trials using a single query
    const { data: sourceDocumentsByTrial = {} } = trpc.documents.listMultipleTrials.useQuery(
        { trialIds: trialId ? [trialId] : selectedTrials, demoMode: currentDataMode },
        {
            enabled: trialId ? true : selectedTrials.length > 0,
            // Adaptive polling: keep refreshing every 2 s while any document
            // is still ingesting (status in flight or unknown), but stop once
            // every doc has reached a terminal state. Avoids hammering the
            // server (and core-backend) for docs that are already complete.
            refetchInterval: (query) => {
                const data = query.state.data as
                    | Record<string, Array<{ coreBackendIngestStatus?: string | null; isIndexed?: boolean }>>
                    | undefined;
                if (!data) return 2000;
                const TERMINAL_STATES = new Set(["complete", "ready", "error", "failed"]);
                const allTerminal = Object.values(data).flat().every((d) => {
                    const status = d?.coreBackendIngestStatus;
                    if (status && TERMINAL_STATES.has(status)) return true;
                    // Legacy docs without core-backend linkage rely on isIndexed.
                    return !!d?.isIndexed;
                });
                return allTerminal ? false : 2000;
            },
            refetchOnMount: 'always' // Always refetch when modal opens
        }
    );

    // Trial info for scoped view
    const { data: scopedTrial } = trpc.trials.getById.useQuery(
        { id: selectedTrialId, demoMode: currentDataMode },
        { enabled: !!trialId && trialId !== 'all' }
    );

    const taskEditorTrialId = taskEditorSource?.trialId || trialId || "";
    const taskEditorMapSummaryQuery = trpc.map.getByTrial.useQuery(
        {
            trialId: taskEditorTrialId,
            includeArchived: false,
            demoMode: currentDataMode,
        },
        {
            enabled: taskEditorOpen && !taskEditorSource?.mapId && Boolean(taskEditorTrialId),
        }
    );
    const taskEditorMapId = taskEditorSource?.mapId || taskEditorMapSummaryQuery.data?.id || "";
    const taskEditorMapDetailQuery = trpc.map.load.useQuery(
        { mapId: taskEditorMapId },
        {
            enabled: taskEditorOpen && Boolean(taskEditorMapId),
        }
    );

    const taskEditorTask = useMemo(() => {
        if (!taskEditorSource?.taskId) return null;
        const rows = (taskEditorMapDetailQuery.data?.tasks || []) as Array<Record<string, any>>;
        return rows.find((task) => String(task.id) === taskEditorSource.taskId) || null;
    }, [taskEditorMapDetailQuery.data?.tasks, taskEditorSource?.taskId]);

    const selectedTrialDocuments = useMemo(() => {
        if (!selectedTrialId || selectedTrialId === "all") return [] as Array<Record<string, any>>;
        const records = sourceDocumentsByTrial?.[selectedTrialId];
        return Array.isArray(records) ? (records as Array<Record<string, any>>) : [];
    }, [sourceDocumentsByTrial, selectedTrialId]);

    const currentProtocolDocument = useMemo(() => {
        if (!selectedTrialDocuments.length) return null;
        const activeDocs = selectedTrialDocuments.filter((doc) => !doc?.archivedAt);
        const protocolDocs = activeDocs.filter((doc) =>
            String(doc?.category || "").toLowerCase().includes("protocol")
        );
        const pickLatest = (items: Array<Record<string, any>>) =>
            [...items].sort(
                (a, b) =>
                    +new Date(String(b?.createdAt || 0)) - +new Date(String(a?.createdAt || 0))
            )[0] || null;
        return (
            protocolDocs.find((doc) => Boolean(doc?.isCurrent)) ||
            pickLatest(protocolDocs) ||
            activeDocs.find((doc) => Boolean(doc?.isCurrent)) ||
            pickLatest(activeDocs)
        );
    }, [selectedTrialDocuments]);

    const isTaskEditorSaving = updateTaskMutation.isPending || changeTaskStatusMutation.isPending;
    const isTaskEditorLoading =
        taskEditorOpen &&
        ((taskEditorSource?.mapId ? false : taskEditorMapSummaryQuery.isLoading) || taskEditorMapDetailQuery.isLoading);

    useEffect(() => {
        if (!taskEditorOpen) return;
        if (!taskEditorTask) return;
        const currentTaskId = String(taskEditorTask.id || "");
        if (!currentTaskId || taskEditorSeededTaskId === currentTaskId) return;
        setTaskEditorForm({
            title: String(taskEditorTask.name || ""),
            description: String(taskEditorTask.description || ""),
            dueDate: toDateInputValue(taskEditorTask.dueDate || taskEditorTask.suggestedDate),
            priority: String(taskEditorTask.priority || "medium"),
            assignedRole: String(taskEditorTask.assignedRole || ""),
            assigneeName: String(taskEditorTask.suggestedAssignee || ""),
            status: String(taskEditorTask.status || "todo"),
        });
        setTaskEditorSeededTaskId(currentTaskId);
    }, [taskEditorOpen, taskEditorTask, taskEditorSeededTaskId]);

    useEffect(() => {
        if (!trialId) return;
        if (autoScoped) return;
        const trialDocs = sourceDocumentsByTrial?.[trialId] || [];
        const indexedDocIds = trialDocs.filter(doc => doc.isIndexed).map(doc => doc.id);
        if (indexedDocIds.length === 0) return;

        setSelectedTrials([trialId]);
        setActiveTrials([trialId]);
        setSelectedDocuments(indexedDocIds);
        setIsAllDocumentsMode(false);
        setAutoScoped(true);
    }, [trialId, sourceDocumentsByTrial, autoScoped]);

    useEffect(() => {
        if (!taskPaneOpen || taskPaneMode !== "worksheet") {
            setSlashMenu(null);
            setInsertMenu(null);
            setDraggingBlockId(null);
            setDragOverBlockId(null);
            setFloatingAIOpen(false);
            setIsWorksheetPaneGenerating(false);
            setActiveWorksheetBlockId(null);
        }
    }, [taskPaneOpen, taskPaneMode, activeWorksheetId]);

    const activeWorksheet = useMemo(
        () => worksheetDrafts.find((draft) => draft.id === activeWorksheetId) || null,
        [worksheetDrafts, activeWorksheetId]
    );

    useEffect(() => {
        if (!activeWorksheet) return;
        if (
            activeWorksheetBlockId &&
            activeWorksheet.blocks.some((block) => block.id === activeWorksheetBlockId)
        ) {
            return;
        }
        setActiveWorksheetBlockId(activeWorksheet.blocks[0]?.id || null);
    }, [activeWorksheet, activeWorksheetBlockId]);

    const upsertWorksheetDraft = useCallback((draft: WorksheetDraft) => {
        setWorksheetDrafts((prev) => {
            const next = prev.filter((item) => item.id !== draft.id);
            return [draft, ...next].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
        });
        setActiveWorksheetId(draft.id);
    }, []);

    const worksheetDocumentHeader = useMemo(() => {
        const generatedBy = activeWorksheet?.generatedBy || "Unknown user";
        const generatedAt = activeWorksheet?.generatedAt || activeWorksheet?.createdAt || new Date().toISOString();
        const sponsor =
            activeWorksheet?.sponsor ||
            String(scopedTrial?.sponsor || "").trim() ||
            "Clinical Research Site";
        const protocolNumber =
            activeWorksheet?.protocolNumber ||
            String(scopedTrial?.protocolNumber || "").trim() ||
            String(scopedTrial?.title || "").trim() ||
            "Protocol";
        const protocolVersion =
            activeWorksheet?.protocolVersion ||
            String(currentProtocolDocument?.documentVersion || "").trim() ||
            String(scopedTrial?.currentVersion || "").trim() ||
            "N/A";
        const amendmentVersion =
            activeWorksheet?.amendmentVersion ||
            String(currentProtocolDocument?.amendmentVersion || "").trim() ||
            String(scopedTrial?.amendmentVersion || "").trim() ||
            "N/A";
        return {
            sponsor,
            protocolNumber,
            protocolVersion,
            amendmentVersion,
            generatedBy,
            generatedAt,
        };
    }, [activeWorksheet, currentProtocolDocument, scopedTrial]);

    const worksheetDocumentFooter = useMemo(() => {
        const name =
            String(organizationProfile.name || "").trim() ||
            String(organizationProfile.legalName || "").trim() ||
            worksheetDocumentHeader.sponsor;
        const address =
            String(organizationProfile.address || "").trim() ||
            String(organizationProfile.location || "").trim();
        const websiteRaw = String(organizationProfile.website || "").trim();
        const websiteLabel = websiteRaw.replace(/^https?:\/\//i, "");
        return {
            name,
            address,
            websiteRaw,
            websiteLabel,
            logoDataUrl: organizationProfile.logoDataUrl || null,
            initial: organizationInitial || name.charAt(0).toUpperCase() || "O",
        };
    }, [organizationProfile, organizationInitial, worksheetDocumentHeader.sponsor]);

    const documentFontFamily = useMemo(() => {
        if (documentStyle.fontFamily === "calibri") return '"Calibri", "Segoe UI", Arial, sans-serif';
        if (documentStyle.fontFamily === "arial") return '"Arial", "Helvetica Neue", Helvetica, sans-serif';
        return '"Times New Roman", Cambria, Georgia, serif';
    }, [documentStyle.fontFamily]);

    const documentBodyTextClass = useMemo(() => {
        if (documentStyle.bodySize === "11") return "text-[16px]";
        if (documentStyle.bodySize === "14") return "text-[18px]";
        return "text-[17px]";
    }, [documentStyle.bodySize]);

    const documentLineHeightClass = useMemo(() => {
        return documentStyle.lineSpacing === "1.5" ? "leading-[1.8]" : "leading-[1.65]";
    }, [documentStyle.lineSpacing]);

    const hydrateChatSession = useCallback(
        (preferredSessionId?: string | null, fallbackToLatest = false) => {
            const scopedTrialId = trialId || null;
            const sessions = listChatSessions({
                trialId: scopedTrialId,
                dataMode: currentDataMode,
            });
            const preferredId =
                preferredSessionId ||
                getStoredActiveChatSessionId({
                    trialId: scopedTrialId,
                    dataMode: currentDataMode,
                });
            const selectedSession =
                (preferredId ? sessions.find((session) => session.id === preferredId) : null) ||
                (fallbackToLatest ? sessions[0] || null : null);

            if (!selectedSession) {
                setActiveChatSessionId(null);
                setChatHistory([]);
                return;
            }

            setActiveChatSessionId(selectedSession.id);
            setChatHistory(selectedSession.messages as ChatMessage[]);
            setStoredActiveChatSessionId({
                trialId: scopedTrialId,
                dataMode: currentDataMode,
                sessionId: selectedSession.id,
            });
        },
        [trialId, currentDataMode]
    );

    const persistChatSession = useCallback(
        (sessionId: string, messagesToPersist: ChatMessage[]) => {
            if (!sessionId || messagesToPersist.length === 0) return;
            const firstUserMessage =
                messagesToPersist.find((entry) => entry.role === "user")?.content?.trim() || "Themison AI chat";
            const title =
                firstUserMessage.length > 88 ? `${firstUserMessage.slice(0, 85)}...` : firstUserMessage;

            upsertChatSession({
                id: sessionId,
                trialId: trialId || null,
                dataMode: currentDataMode,
                title,
                messages: messagesToPersist,
            });
            setStoredActiveChatSessionId({
                trialId: trialId || null,
                dataMode: currentDataMode,
                sessionId,
            });
            setActiveChatSessionId(sessionId);
        },
        [trialId, currentDataMode]
    );

    useEffect(() => {
        // Default to starter screen whenever entering this trial assistant.
        setChatHistory([]);
        setActiveChatSessionId(null);
        clearActiveChatSessionId({
            trialId: trialId || null,
            dataMode: currentDataMode,
        });
    }, [trialId, currentDataMode]);

    useEffect(() => {
        const onStorage = () => {
            if (activeChatSessionId) hydrateChatSession(activeChatSessionId, false);
        };
        const onSessionsUpdated = () => {
            if (activeChatSessionId) hydrateChatSession(activeChatSessionId, false);
        };
        const onNewRequested = (event: Event) => {
            const detail = (event as CustomEvent<{ trialId: string | null; dataMode: string }>).detail;
            if (!detail) return;
            const sameTrial = (detail.trialId || null) === (trialId || null);
            const sameMode = detail.dataMode === currentDataMode;
            if (!sameTrial || !sameMode) return;
            setActiveTab("ai-assistant");
            setChatHistory([]);
            setActiveChatSessionId(null);
        };
        const onOpenRequested = (event: Event) => {
            const detail = (event as CustomEvent<{ trialId: string | null; dataMode: string; sessionId: string }>).detail;
            if (!detail || !detail.sessionId) return;
            const sameTrial = (detail.trialId || null) === (trialId || null);
            const sameMode = detail.dataMode === currentDataMode;
            if (!sameTrial || !sameMode) return;
            setActiveTab("ai-assistant");
            hydrateChatSession(detail.sessionId, false);
        };
        const onActiveUpdated = (event: Event) => {
            const detail = (event as CustomEvent<{ trialId: string | null; dataMode: string; sessionId: string | null }>).detail;
            if (!detail) return;
            const sameTrial = (detail.trialId || null) === (trialId || null);
            const sameMode = detail.dataMode === currentDataMode;
            if (!sameTrial || !sameMode) return;
            if (!detail.sessionId) {
                setActiveTab("ai-assistant");
                setChatHistory([]);
                setActiveChatSessionId(null);
                return;
            }
            setActiveTab("ai-assistant");
            hydrateChatSession(detail.sessionId, false);
        };

        window.addEventListener("storage", onStorage);
        window.addEventListener(CHAT_SESSIONS_UPDATED_EVENT, onSessionsUpdated as EventListener);
        window.addEventListener(CHAT_NEW_REQUESTED_EVENT, onNewRequested as EventListener);
        window.addEventListener(CHAT_OPEN_REQUESTED_EVENT, onOpenRequested as EventListener);
        window.addEventListener(CHAT_ACTIVE_UPDATED_EVENT, onActiveUpdated as EventListener);
        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener(CHAT_SESSIONS_UPDATED_EVENT, onSessionsUpdated as EventListener);
            window.removeEventListener(CHAT_NEW_REQUESTED_EVENT, onNewRequested as EventListener);
            window.removeEventListener(CHAT_OPEN_REQUESTED_EVENT, onOpenRequested as EventListener);
            window.removeEventListener(CHAT_ACTIVE_UPDATED_EVENT, onActiveUpdated as EventListener);
        };
    }, [hydrateChatSession, activeChatSessionId, trialId, currentDataMode]);

    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chatHistory, isLoading]);

    useEffect(() => {
        if (archiveSearchOpen) {
            window.requestAnimationFrame(() => {
                archiveSearchInputRef.current?.focus();
            });
        }
    }, [archiveSearchOpen]);

    useEffect(() => {
        if (!trialId) return;
        setIsAllDocumentsMode(false);
        setSelectedTrials([trialId]);
        setActiveTrials([trialId]);
    }, [trialId]);

    useEffect(() => {
        if (isAllDocumentsMode) return;
        const hasValidScopedSelection =
            selectedDocuments.length > 0 && (trialId ? true : activeTrials.length > 0);
        if (hasValidScopedSelection) return;

        // Batch all state updates to avoid cascading re-renders
        unstable_batchedUpdates(() => {
            setIsAllDocumentsMode(true);
            setSelectedDocuments([]);
            if (trialId) {
                setSelectedTrials([trialId]);
                setActiveTrials([trialId]);
            } else {
                setSelectedTrials([]);
                setActiveTrials([]);
            }
        });
    }, [activeTrials.length, isAllDocumentsMode, selectedDocuments.length, trialId]);

    const handleSend = async () => {
        if (!message.trim() || isLoading) return;

        const userMessage = message.trim();
        setMessage("");

        // Add transition delay for smoother UX
        setIsTransitioning(true);
        await new Promise(resolve => setTimeout(resolve, 300));

        const newUserMessage: ChatMessage = { role: 'user', content: userMessage };
        const nextHistoryWithUser = [...chatHistory, newUserMessage];
        const sessionIdForRequest = activeChatSessionId || createChatSessionId();
        setChatHistory(nextHistoryWithUser);
        persistChatSession(sessionIdForRequest, nextHistoryWithUser);
        setIsTransitioning(false);
        setIsLoading(true);
        const sessionId = getSessionId();

        logEvent({
            eventType: "ai_query_submitted",
            action: "submitted",
            entityType: "query",
            payload: {
                query: userMessage,
                trialId,
                demoMode: currentDataMode,
                isAllDocumentsMode,
                selectedDocuments,
            },
            aiInvolved: true,
        });

        if (!isAllDocumentsMode && selectedDocuments.length > 0) {
            logEvent({
                eventType: "protocol_searched",
                action: "searched",
                entityType: "protocol",
                payload: {
                    query: userMessage,
                    documentIds: selectedDocuments,
                    trialId,
                    demoMode: currentDataMode,
                },
            });
        }

        try {
            // Send entire conversation history to maintain context
            // Pass selected documents to query specific documents
            const response = await chatMutation.mutateAsync({
                messages: nextHistoryWithUser.map(msg => ({
                    role: msg.role,
                    content: msg.content,
                })),
                demoMode: currentDataMode,
                ...(selectedTrialId && selectedTrialId !== "all" ? { trialId: selectedTrialId } : {}),
                // If in all documents mode, don't send documentIds (backend will search all)
                // If in filtered mode, send specific documentIds
                ...(!isAllDocumentsMode && selectedDocuments.length > 0 ? { documentIds: selectedDocuments.map(String) } : {}),
                sessionId,
            });
            const sources = (response as any).sources as Array<any> | undefined;
            console.log("[FE] raw sources[0] keys:", Object.keys((response as any).sources?.[0] || {}));
            console.log("[FE] sources:", JSON.stringify(sources?.map(s => ({
                filename: s.filename,
                fileUrl: s.fileUrl,
                page: s.page,
                highlightUrl: s.highlightUrl,
                bboxes: s.bboxes,
            })), null, 2));
            const highlightMeta: Record<string, { highlightUrl?: string; bboxes?: number[][] }> = {};
            sources?.forEach((s: any) => {
                const meta = { highlightUrl: s.highlightUrl, bboxes: s.bboxes };
                if (s.fileId) highlightMeta[s.fileId] = meta;
                if (s.filename) highlightMeta[s.filename] = meta;
            });
            setLiveSourceMeta(prev => ({ ...prev, ...highlightMeta }));

            // const sources = (response as any).sources as Array<any> | undefined;
            const thinking = (response as any).thinking as string | undefined;
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: response.message,
                thinking,
                thoughtsSummary: thinking,
                sources: sources as ChatMessage['sources'],
            };
            const nextHistoryWithAssistant = [...nextHistoryWithUser, assistantMessage];
            setChatHistory(nextHistoryWithAssistant);
            persistChatSession(sessionIdForRequest, nextHistoryWithAssistant);

            logEvent({
                eventType: "ai_response_generated",
                action: "generated",
                entityType: "response",
                payload: {
                    trialId,
                    demoMode: currentDataMode,
                },
                aiInvolved: true,
                aiOutput: response.message,
                aiSources: sources,
            });
        } catch (error) {
            console.error('Error in chat:', error);
            const errorMessage: ChatMessage = {
                role: 'assistant',
                content: 'Sorry, I encountered an error while processing your message. Please try again.',
            };
            const nextHistoryWithError = [...nextHistoryWithUser, errorMessage];
            setChatHistory(nextHistoryWithError);
            persistChatSession(sessionIdForRequest, nextHistoryWithError);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handlePromptClick = (promptText: string) => {
        setMessage(promptText);
        textareaRef.current?.focus();
    };

    const getPreviousUserQuestion = useCallback(
        (assistantMessageIndex: number) => {
            const previous = [...chatHistory]
                .slice(0, assistantMessageIndex)
                .reverse()
                .find((entry) => entry.role === "user");
            return String(previous?.content || "").trim();
        },
        [chatHistory]
    );

    const getWorksheetSuggestionId = useCallback(
        (assistantMessageIndex: number, question: string) => {
            const normalized = question.toLowerCase().replace(/\s+/g, " ").trim();
            return `${currentDataMode}:${trialId || "all"}:${assistantMessageIndex}:${normalized.slice(0, 120)}`;
        },
        [currentDataMode, trialId]
    );

    const shouldSuggestWorksheet = useCallback(
        (assistantMessageIndex: number, messageEntry: ChatMessage) => {
            if (messageEntry.role !== "assistant") return false;
            const question = getPreviousUserQuestion(assistantMessageIndex);
            if (!question) return false;
            const worksheetIntent = /\b(visit|worksheet|checklist|assessments?|procedures?|day\s*\d+|week\s*\d+)\b/i.test(
                question
            );
            if (!worksheetIntent) return false;
            if (!Array.isArray(messageEntry.sources) || messageEntry.sources.length === 0) return false;
            const suggestionId = getWorksheetSuggestionId(assistantMessageIndex, question);
            return !dismissedWorksheetSuggestionIds.has(suggestionId);
        },
        [dismissedWorksheetSuggestionIds, getPreviousUserQuestion, getWorksheetSuggestionId]
    );

    const buildSourceViewerUrl = useCallback(
        (source: { fileUrl?: string; page?: number; excerpt?: string; highlightUrl?: string }) => {
            // Prefer the server-burned, bbox-accurate highlighted PDF when available
            // (set by the BFF when the citation carries docling bboxes); otherwise fall
            // back to the browser PDF.js text-search highlight.
            if (source.highlightUrl) {
                // The highlight is burned onto the cited page; without a #page fragment
                // the iframe opens at page 1 and the user never sees it. Jump to the page.
                return source.page
                    ? `${source.highlightUrl}#page=${source.page}`
                    : source.highlightUrl;
            }
            const baseUrl = source.fileUrl || "https://pdfobject.com/pdf/sample.pdf";
            const hashParts: string[] = [];
            if (source.page) hashParts.push(`page=${source.page}`);
            const query = String(source.excerpt || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 100);
            if (query.length > 0) {
                hashParts.push(`search=${encodeURIComponent(query)}`);
            }
            return hashParts.length > 0 ? `${baseUrl}#${hashParts.join("&")}` : baseUrl;
        },
        []
    );

    const handleOpenDocument = (docName: string, page?: number) => {
        setSelectedDocument({
            name: docName,
            url: 'https://pdfobject.com/pdf/sample.pdf', // Placeholder PDF
            page,
        });
        setPdfViewerOpen(true);
    };

    const handleOpenTaskDocument = (source: {
        filename: string;
        section?: string;
        page?: number;
        fileUrl?: string;
        excerpt?: string;
        highlightUrl?: string;
        bboxes?: number[][];
    }) => {
        if (taskPaneOpenedAt && taskPaneDocument) {
            logEvent({
                eventType: "protocol_section_viewed",
                action: "closed",
                entityType: "protocol",
                entityId: taskPaneDocument.name,
                durationMs: Date.now() - taskPaneOpenedAt,
                payload: {
                    section: taskPaneDocument.section,
                    page: taskPaneDocument.page,
                    trialId,
                    demoMode: currentDataMode,
                },
            });
        }

        // Use source.highlightUrl directly — it already carries the correct
        // page + bboxes as query params for this specific citation.
        // Only fall back to liveSourceMeta if source doesn't carry it.
        const effectiveHighlightUrl =
            source.highlightUrl ||
            liveSourceMeta[(source as any).fileId || source.filename || ""]?.highlightUrl;

        // iframe: full highlighted PDF jumping to cited page
        const iframeUrl = effectiveHighlightUrl
            ? `${effectiveHighlightUrl}#page=${source.page || 1}`
            : source.fileUrl
                ? `${source.fileUrl}${source.page ? `#page=${source.page}` : ""}`
                : "";

        // Open button: same highlightUrl with #page fragment
        const openUrl = effectiveHighlightUrl
            ? `${effectiveHighlightUrl}#page=${source.page || 1}`
            : iframeUrl;

        setTaskPaneDocument({
            name: source.filename,
            section: source.section,
            page: source.page,
            excerpt: source.excerpt,
            url: iframeUrl,
            openUrl,
        });
        setTaskPaneMode("source");
        setPdfViewerOpen(false);
        setTaskPaneExpanded(false);
        setTaskPaneOpen(true);
        setTaskPaneOpenedAt(Date.now());

        logEvent({
            eventType: "protocol_section_viewed",
            action: "viewed",
            entityType: "protocol",
            entityId: source.filename,
            payload: {
                section: source.section,
                page: source.page,
                excerpt: source.excerpt,
                trialId,
                demoMode: currentDataMode,
            },
        });
    };

    const handleOpenTaskEditor = (source: {
        taskId?: string;
        trialId?: string;
        mapId?: string;
        taskName?: string;
    }) => {
        const taskId = String(source.taskId || "").trim();
        if (!taskId) {
            toast.error("Task link is missing task id.");
            return;
        }
        const routeParams = new URLSearchParams();
        routeParams.set("openTask", taskId);
        const taskName = String(source.taskName || "").trim();
        if (taskName) {
            routeParams.set("openTaskName", taskName);
        }
        routeParams.set("embeddedTaskModal", "1");
        routeParams.set("nonce", String(Date.now()));
        setTaskManagerOverlayUrl(`/tasks?${routeParams.toString()}`);
        setTaskManagerOverlayOpen(true);
    };

    useEffect(() => {
        if (!taskManagerOverlayOpen) return;
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const payload = event.data as { type?: string } | null;
            if (!payload || payload.type !== "themison:task-modal-close") return;
            setTaskManagerOverlayOpen(false);
        };
        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [taskManagerOverlayOpen]);

    const handleCloseTaskEditor = () => {
        if (isTaskEditorSaving) return;
        setTaskEditorOpen(false);
        setTaskEditorSource(null);
        setTaskEditorSeededTaskId(null);
    };

    const handleSaveTaskEditor = async () => {
        if (!taskEditorTask) {
            toast.error("Task details are still loading.");
            return;
        }
        const title = taskEditorForm.title.trim();
        if (!title) {
            toast.error("Task title is required.");
            return;
        }

        const dueDateIso = toIsoDateTime(taskEditorForm.dueDate);
        const nextStatusToken = taskEditorForm.status.trim();
        const nextStatus = TASK_EDITOR_STATUS_OPTIONS.includes(nextStatusToken as (typeof TASK_EDITOR_STATUS_OPTIONS)[number])
            ? (nextStatusToken as (typeof TASK_EDITOR_STATUS_OPTIONS)[number])
            : null;
        const nextPriorityToken = taskEditorForm.priority.trim();
        const nextPriority = TASK_EDITOR_PRIORITY_OPTIONS.includes(
            nextPriorityToken as (typeof TASK_EDITOR_PRIORITY_OPTIONS)[number]
        )
            ? (nextPriorityToken as (typeof TASK_EDITOR_PRIORITY_OPTIONS)[number])
            : "medium";
        const nextAssignedRoleToken = taskEditorForm.assignedRole.trim();
        const nextAssignedRole = TASK_EDITOR_ROLE_OPTIONS.includes(
            nextAssignedRoleToken as (typeof TASK_EDITOR_ROLE_OPTIONS)[number]
        )
            ? (nextAssignedRoleToken as (typeof TASK_EDITOR_ROLE_OPTIONS)[number])
            : null;
        const currentStatus = String(taskEditorTask.status || "");
        let statusChanged = false;

        try {
            if (nextStatus && nextStatus !== currentStatus) {
                await changeTaskStatusMutation.mutateAsync({
                    taskId: String(taskEditorTask.id),
                    status: nextStatus,
                });
                statusChanged = true;
            }

            await updateTaskMutation.mutateAsync({
                taskId: String(taskEditorTask.id),
                updates: {
                    name: title,
                    description: taskEditorForm.description.trim(),
                    priority: nextPriority,
                    assignedRole: nextAssignedRole,
                    suggestedAssignee: taskEditorForm.assigneeName.trim() || null,
                    dueDate: dueDateIso,
                    suggestedDate: dueDateIso,
                },
            });

            await taskEditorMapDetailQuery.refetch();
            toast.success(statusChanged ? "Task and status updated." : "Task updated.");
            setTaskEditorOpen(false);
        } catch (error: any) {
            toast.error(error?.message || "Failed to save task.");
        }
    };

    const createFallbackWorksheetBlocks = useCallback((question: string, messageEntry: ChatMessage) => {
        const visitMatch = question.match(/visit\s*([a-z0-9-]+)/i);
        const visitLabel = visitMatch ? `Visit ${visitMatch[1].toUpperCase()}` : "Visit Worksheet";
        const summaryLines = messageEntry.content
            .split("\n")
            .map((line) => line.replace(/^[-*]\s*/, "").trim())
            .filter((line) => line.length > 0)
            .slice(0, 8);
        const checklist = summaryLines.length
            ? summaryLines
            : [
                "Confirm visit eligibility and required prerequisites",
                "Perform protocol-required assessments",
                "Collect required laboratory samples",
                "Document adverse events and concomitant medications",
                "Complete source notes and forms",
            ];
        const blocks: WorksheetBlock[] = [
            { id: `fb-${Date.now()}-h1`, type: "heading2", content: "Pre-Visit Checklist" },
            ...checklist.slice(0, 6).map((item, index) => ({
                id: `fb-${Date.now()}-c-${index}`,
                type: "checklist" as const,
                content: item,
                checked: false,
            })),
        ];
        return {
            title: `${visitLabel} Worksheet`,
            subtitle: messageEntry.sources?.[0]?.filename || "Protocol worksheet draft",
            blocks,
        };
    }, []);

    const handleCreateWorksheetFromMessage = useCallback(
        async (assistantMessageIndex: number, messageEntry: ChatMessage) => {
            if (messageEntry.role !== "assistant") return;
            const question = getPreviousUserQuestion(assistantMessageIndex);
            if (!question) {
                toast.error("Could not find the related question for this response.");
                return;
            }

            setWorksheetGenerationMessageIndex(assistantMessageIndex);
            setTaskPaneMode("worksheet");
            setTaskPaneOpen(true);
            setTaskPaneExpanded(false);
            setTaskPaneOpenedAt(Date.now());
            setIsWorksheetPaneGenerating(true);
            try {
                const response = await generateWorksheetMutation.mutateAsync({
                    question,
                    answer: messageEntry.content,
                    ...(selectedTrialId && selectedTrialId !== "all" ? { trialId: selectedTrialId, demoMode: currentDataMode } : {}),
                    sources: (messageEntry.sources || []).map((source) => ({
                        filename: source.filename,
                        fileUrl: source.fileUrl,
                        documentId: source.documentId,
                        excerpt: source.excerpt,
                        section: source.section,
                        category: source.category,
                        page: source.page ?? null,
                        highlightUrl: (source as any).highlightUrl,
                    })),
                });

                const normalizedBlocks = Array.isArray((response as any)?.blocks)
                    ? (response as any).blocks
                        .map((entry: any, index: number) => {
                            const content = String(entry?.content || "").trim();
                            if (!content) return null;
                            const type = normalizeWorksheetBlockType(entry?.type);
                            return {
                                id: `ws-${Date.now()}-${index}`,
                                type,
                                content,
                                ...(type === "checklist" ? { checked: Boolean(entry?.checked) } : {}),
                            } as WorksheetBlock;
                        })
                        .filter((entry: WorksheetBlock | null): entry is WorksheetBlock => Boolean(entry))
                    : [];

                const fallback = normalizedBlocks.length
                    ? null
                    : createFallbackWorksheetBlocks(question, messageEntry);
                const title = String((response as any)?.title || fallback?.title || "").trim() || "Visit Worksheet";
                const subtitle = String((response as any)?.subtitle || fallback?.subtitle || "").trim() || "Draft";
                const blocks = normalizedBlocks.length > 0 ? normalizedBlocks : fallback?.blocks || [];
                const draftId = `worksheet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                const nowIso = new Date().toISOString();
                const runtimeUser = readRuntimeUserInfo();
                const generatedBy =
                    runtimeUser?.name ||
                    demoState.teamMembers?.[0]?.name ||
                    "Kaleb Sanders";
                const protocolVersion =
                    String(currentProtocolDocument?.documentVersion || scopedTrial?.currentVersion || "").trim() || null;
                const amendmentVersion =
                    String(currentProtocolDocument?.amendmentVersion || scopedTrial?.amendmentVersion || "").trim() || null;
                const sponsor = String(scopedTrial?.sponsor || "").trim() || null;
                const protocolNumber = String(scopedTrial?.protocolNumber || scopedTrial?.title || "").trim() || null;

                const draft: WorksheetDraft = {
                    id: draftId,
                    trialId: selectedTrialId && selectedTrialId !== "all" ? selectedTrialId : null,
                    dataMode: currentDataMode,
                    chatSessionId:
                        activeChatSessionId ||
                        getStoredActiveChatSessionId({
                            trialId: trialId || null,
                            dataMode: currentDataMode,
                        }) ||
                        null,
                    sourceMessageIndex: assistantMessageIndex,
                    sourceQuestion: question,
                    title,
                    subtitle,
                    blocks,
                    sources: ((response as any)?.sources || messageEntry.sources || []).map((source: any) => ({
                        filename: source.filename,
                        section: source.section,
                        excerpt: source.excerpt,
                        fileUrl: source.fileUrl,
                        documentId: source.documentId,
                        page: source.page ?? null,
                        category: source.category,
                        highlightUrl: source.highlightUrl,
                    })),
                    status: "draft",
                    createdAt: nowIso,
                    updatedAt: nowIso,
                    savedAt: null,
                    publishedAt: null,
                    generatedAt: nowIso,
                    generatedBy,
                    sponsor,
                    protocolNumber,
                    protocolVersion,
                    amendmentVersion,
                };
                upsertWorksheetDraft(draft);
                toast.success("Worksheet draft created");

                logEvent({
                    eventType: "feature_used",
                    action: "worksheet_generated",
                    entityType: "worksheet",
                    payload: {
                        trialId,
                        demoMode: currentDataMode,
                        worksheetId: draft.id,
                        sourceQuestion: question,
                        blockCount: blocks.length,
                    },
                    aiInvolved: true,
                });
            } catch (error) {
                console.error("Failed to generate worksheet:", error);
                toast.error("Failed to generate worksheet draft.");
            } finally {
                setIsWorksheetPaneGenerating(false);
                setWorksheetGenerationMessageIndex(null);
            }
        },
        [
            createFallbackWorksheetBlocks,
            currentProtocolDocument,
            currentDataMode,
            demoState.teamMembers,
            generateWorksheetMutation,
            getPreviousUserQuestion,
            activeChatSessionId,
            selectedTrialId,
            scopedTrial,
            trialId,
            upsertWorksheetDraft,
        ]
    );

    const dismissWorksheetSuggestion = useCallback(
        (assistantMessageIndex: number, messageEntry: ChatMessage) => {
            const question = getPreviousUserQuestion(assistantMessageIndex);
            if (!question) return;
            const suggestionId = getWorksheetSuggestionId(assistantMessageIndex, question);
            setDismissedWorksheetSuggestionIds((prev) => {
                const next = new Set(prev);
                next.add(suggestionId);
                return next;
            });
            logEvent({
                eventType: "feature_used",
                action: "worksheet_suggestion_dismissed",
                entityType: "worksheet",
                payload: { trialId, demoMode: currentDataMode, sourceQuestion: question },
            });
        },
        [currentDataMode, getPreviousUserQuestion, getWorksheetSuggestionId, trialId]
    );

    const updateWorksheet = useCallback(
        (updater: (draft: WorksheetDraft) => WorksheetDraft | null) => {
            if (!activeWorksheet) return;
            const next = updater(activeWorksheet);
            if (!next) return;
            upsertWorksheetDraft({
                ...next,
                updatedAt: new Date().toISOString(),
            });
        },
        [activeWorksheet, upsertWorksheetDraft]
    );

    const updateWorksheetBlock = useCallback(
        (blockId: string, updates: Partial<WorksheetBlock>) => {
            updateWorksheet((draft) => ({
                ...draft,
                blocks: draft.blocks.map((block) => (block.id === blockId ? { ...block, ...updates } : block)),
            }));
        },
        [updateWorksheet]
    );

    const insertWorksheetBlockAfter = useCallback(
        (blockId: string, type: WorksheetBlockType = "text", initialContent = "") => {
            updateWorksheet((draft) => {
                const index = draft.blocks.findIndex((block) => block.id === blockId);
                if (index < 0) return draft;
                const newBlock: WorksheetBlock = {
                    id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    type,
                    content: initialContent,
                    ...(type === "checklist" ? { checked: false } : {}),
                };
                const blocks = [...draft.blocks];
                blocks.splice(index + 1, 0, newBlock);
                return { ...draft, blocks };
            });
        },
        [updateWorksheet]
    );

    const createWorksheetBlock = useCallback(
        (type: WorksheetBlockType, content = ""): WorksheetBlock => {
            const block: WorksheetBlock = {
                id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                type,
                content,
            };
            if (type === "checklist") {
                block.checked = false;
            }
            return block;
        },
        []
    );

    const insertWorksheetBlocksAfter = useCallback(
        (
            afterBlockId: string | null,
            blocksToInsert: WorksheetBlock[],
            placement: WorksheetInsertPlacement = "after"
        ) => {
            if (!blocksToInsert.length) return;
            updateWorksheet((draft) => {
                const blocks = [...draft.blocks];
                let insertionIndex = Math.max(blocks.length - 1, 0);
                if (placement === "start") {
                    insertionIndex = -1;
                } else if (placement === "end") {
                    insertionIndex = Math.max(blocks.length - 1, 0);
                } else if (afterBlockId) {
                    insertionIndex = Math.max(blocks.findIndex((block) => block.id === afterBlockId), 0);
                }
                blocks.splice(insertionIndex + 1, 0, ...blocksToInsert);
                return { ...draft, blocks };
            });
        },
        [updateWorksheet]
    );

    const removeWorksheetBlock = useCallback(
        (blockId: string) => {
            updateWorksheet((draft) => {
                if (draft.blocks.length <= 1) return draft;
                return {
                    ...draft,
                    blocks: draft.blocks.filter((block) => block.id !== blockId),
                };
            });
        },
        [updateWorksheet]
    );

    const moveWorksheetBlock = useCallback(
        (dragBlockId: string, targetBlockId: string) => {
            if (!dragBlockId || !targetBlockId || dragBlockId === targetBlockId) return;
            updateWorksheet((draft) => {
                const fromIndex = draft.blocks.findIndex((block) => block.id === dragBlockId);
                const toIndex = draft.blocks.findIndex((block) => block.id === targetBlockId);
                if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return draft;
                const nextBlocks = [...draft.blocks];
                const [moved] = nextBlocks.splice(fromIndex, 1);
                nextBlocks.splice(toIndex, 0, moved);
                return { ...draft, blocks: nextBlocks };
            });
        },
        [updateWorksheet]
    );

    const handleWorksheetDragStart = useCallback(
        (blockId: string, event: React.DragEvent<HTMLButtonElement>) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", blockId);
            setDraggingBlockId(blockId);
            setDragOverBlockId(blockId);
            setInsertMenu(null);
            setSlashMenu(null);
        },
        []
    );

    const handleWorksheetDragOver = useCallback(
        (blockId: string, event: React.DragEvent<HTMLDivElement>) => {
            if (!draggingBlockId) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            if (dragOverBlockId !== blockId) {
                setDragOverBlockId(blockId);
            }
        },
        [draggingBlockId, dragOverBlockId]
    );

    const handleWorksheetDrop = useCallback(
        (targetBlockId: string, event: React.DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const draggedId = event.dataTransfer.getData("text/plain") || draggingBlockId;
            if (draggedId) {
                moveWorksheetBlock(draggedId, targetBlockId);
            }
            setDraggingBlockId(null);
            setDragOverBlockId(null);
        },
        [draggingBlockId, moveWorksheetBlock]
    );

    const handleWorksheetDragEnd = useCallback(() => {
        setDraggingBlockId(null);
        setDragOverBlockId(null);
    }, []);

    const buildWorksheetAIPrompt = useCallback(
        (
            action: WorksheetAICommandId,
            draft: WorksheetDraft,
            customPrompt?: string
        ) => {
            const defaultInstruction =
                action === "find_protocol_section"
                    ? "Find the most relevant protocol section for this worksheet context and draft concise insertable content."
                    : action === "draft_trial_overview"
                        ? "Draft a clear professional trial overview and the purpose of this worksheet template."
                        : "Draft a concise operational paragraph for this visit worksheet section.";
            const userInstruction =
                customPrompt && customPrompt.trim().length > 0
                    ? customPrompt.trim()
                    : defaultInstruction;
            const outline = draft.blocks
                .slice(0, 12)
                .map((block) => `${block.type}: ${String(block.content || "").slice(0, 180)}`)
                .join("\n");
            const preferredPlacement =
                customPrompt && customPrompt.trim().length > 0
                    ? detectPromptPlacement(customPrompt)
                    : action === "draft_trial_overview"
                        ? "start"
                        : "after";
            return `You are Themison, a clinical operations writing copilot embedded in a worksheet editor.
Write polished source-document content, like a serious Microsoft Word clinical document.

Instruction from user:
${userInstruction}

Worksheet context:
- Title: ${draft.title}
- Subtitle: ${draft.subtitle}
- Source question: ${draft.sourceQuestion}
- Sponsor: ${draft.sponsor || "Unknown sponsor"}
- Protocol number/title: ${draft.protocolNumber || "Unknown protocol"}

Current worksheet outline:
${outline || "(empty)"}

Output rules:
- Understand natural language intent and what "this", "here", "at beginning", etc refers to.
- Keep wording professional and concise for nurses/PI/site staff.
- Do NOT include source tags, citation brackets, "verbatim evidence", or markdown labels.
- Do NOT mention file names, raw page ranges, or source labels unless explicitly requested.
- Do NOT quote long protocol text unless explicitly requested.
- Return only JSON with this exact shape:
{
  "placement": "start|after|end",
  "blocks": [
    { "type": "heading3|text|bulleted|numbered|checklist|quote|callout|divider|code", "content": "..." }
  ]
}
- Use "placement": "${preferredPlacement}" unless user instruction clearly requests a different location.
- Include 1-5 blocks max.`;
        },
        []
    );

    const runWorksheetAICommand = useCallback(
        async (options: {
            action: WorksheetAICommandId;
            targetBlockId: string | null;
            customPrompt?: string;
        }) => {
            if (!activeWorksheet) return;
            const prompt = buildWorksheetAIPrompt(options.action, activeWorksheet, options.customPrompt);
            if (!prompt) return;

            setFloatingAILoading(true);
            try {
                const generateDeterministicTrialOverviewBlocks = () => {
                    const trialLabel =
                        String(scopedTrial?.title || scopedTrial?.protocolNumber || activeWorksheet.protocolNumber || "this clinical trial")
                            .trim();
                    const sponsorLabel =
                        String(scopedTrial?.sponsor || activeWorksheet.sponsor || "the sponsor").trim();
                    const productLabel = String(scopedTrial?.investigationalProduct || "").trim();
                    const indicationLabel = String(scopedTrial?.indication || "").trim();
                    const phaseLabel = String(scopedTrial?.phase || "").trim();
                    const objectiveLabel = String(scopedTrial?.primaryObjective || "").trim();

                    const summaryParts: string[] = [];
                    summaryParts.push(
                        `${trialLabel} is a ${phaseLabel ? `${phaseLabel.toLowerCase()} ` : ""}clinical study sponsored by ${sponsorLabel}.`.replace(
                            /\s+/g,
                            " "
                        )
                    );
                    if (productLabel && indicationLabel) {
                        summaryParts.push(`The trial evaluates ${productLabel} for ${indicationLabel}.`);
                    } else if (productLabel) {
                        summaryParts.push(`The trial evaluates ${productLabel}.`);
                    } else if (indicationLabel) {
                        summaryParts.push(`The trial focuses on ${indicationLabel}.`);
                    }
                    if (objectiveLabel) {
                        summaryParts.push(`Primary objective: ${objectiveLabel.replace(/\s+/g, " ").trim()}.`);
                    }

                    const purposeText =
                        `Purpose of this worksheet: provide a structured, visit-ready source document that helps nurses and investigators execute protocol-required assessments, document findings, and maintain consistent study records.`;

                    return [
                        createWorksheetBlock("heading3", "Trial Summary and Worksheet Purpose"),
                        createWorksheetBlock("text", summaryParts.join(" ")),
                        createWorksheetBlock("text", purposeText),
                        createWorksheetBlock("divider", ""),
                    ].filter((block) => String(block.content || "").trim().length > 0 || block.type === "divider");
                };

                const payload: any = {
                    messages: [{ role: "user", content: prompt }],
                    demoMode: currentDataMode,
                    sessionId: getSessionId(),
                };
                if (selectedTrialId && selectedTrialId !== "all") {
                    payload.trialId = selectedTrialId;
                }
                if (!isAllDocumentsMode && selectedDocuments.length > 0) {
                    payload.documentIds = selectedDocuments.map(String);
                }

                const response = await chatMutation.mutateAsync(payload);
                const rawMessage = String((response as any)?.message || "");
                const messageText = sanitizeWriterText(rawMessage);
                if (!messageText) {
                    toast.error("Themison could not generate content for this action.");
                    return;
                }

                const parsed = extractFirstJsonObject(rawMessage) as
                    | { placement?: string; blocks?: Array<{ type?: string; content?: string }> }
                    | null;
                const explicitPromptPlacement = parseExplicitPromptPlacement(options.customPrompt || "");
                const placementFromPrompt = detectPromptPlacement(options.customPrompt || "");
                const placementFromModel = String(parsed?.placement || "").toLowerCase();
                let placement: WorksheetInsertPlacement = "after";
                if (explicitPromptPlacement) {
                    placement = explicitPromptPlacement;
                } else if (
                    placementFromModel === "start" ||
                    placementFromModel === "end" ||
                    placementFromModel === "after"
                ) {
                    placement = placementFromModel as WorksheetInsertPlacement;
                } else if (options.customPrompt) {
                    placement = placementFromPrompt;
                } else if (options.action === "draft_trial_overview") {
                    placement = "start";
                }

                let generatedBlocks: WorksheetBlock[] = [];
                if (Array.isArray(parsed?.blocks) && parsed!.blocks!.length > 0) {
                    generatedBlocks = parsed!.blocks!
                        .map((entry) => {
                            const content = sanitizeWriterText(String(entry?.content || ""));
                            if (!content) return null;
                            const type = normalizeWorksheetBlockType(entry?.type);
                            return createWorksheetBlock(type, content);
                        })
                        .filter((entry): entry is WorksheetBlock => Boolean(entry))
                        .slice(0, 6);
                }

                if (generatedBlocks.length === 0) {
                    const segments = messageText
                        .split(/\n{2,}/)
                        .map((entry) => sanitizeWriterText(entry))
                        .filter(Boolean)
                        .slice(0, 6);
                    generatedBlocks = segments.map((segment, index) => {
                        let blockType: WorksheetBlockType = "text";
                        if (index === 0 && segment.length <= 120) {
                            blockType = "heading3";
                        }
                        if (options.action === "find_protocol_section" && index === 0) {
                            blockType = "heading3";
                        }
                        return createWorksheetBlock(blockType, segment);
                    });
                }

                if (options.action === "draft_trial_overview") {
                    const mergedText = generatedBlocks
                        .map((block) => block.content.toLowerCase())
                        .join(" ");
                    const looksOffTopic =
                        /\bprocedure guidance\b|\brequired at\b|\bappendix\b|\bfull blood count\b/.test(mergedText) ||
                        mergedText.length < 80;
                    if (looksOffTopic) {
                        generatedBlocks = generateDeterministicTrialOverviewBlocks();
                        if (!explicitPromptPlacement) {
                            placement = "start";
                        }
                    }
                }

                const aiSources = ((response as any)?.sources || []) as Array<any>;
                const primarySource = aiSources[0];
                if (primarySource?.excerpt && options.action === "find_protocol_section") {
                    const sourceLabel = primarySource.section || primarySource.filename || "Protocol";
                    generatedBlocks.push(
                        createWorksheetBlock(
                            "quote",
                            `${sanitizeWriterText(primarySource.excerpt)}\n\n${sourceLabel}${primarySource.page ? ` (Page ${primarySource.page})` : ""}`
                        )
                    );
                }

                insertWorksheetBlocksAfter(options.targetBlockId, generatedBlocks, placement);
                setFloatingAIOpen(false);
                setFloatingAIPrompt("");
                toast.success("Content inserted by Themison");

                logEvent({
                    eventType: "feature_used",
                    action: "worksheet_ai_insert",
                    entityType: "worksheet",
                    payload: {
                        trialId,
                        demoMode: currentDataMode,
                        worksheetId: activeWorksheet.id,
                        aiAction: options.action,
                        insertedBlocks: generatedBlocks.length,
                    },
                    aiInvolved: true,
                });
            } catch (error) {
                console.error("Worksheet AI command failed:", error);
                toast.error("Could not insert Themison content.");
            } finally {
                setFloatingAILoading(false);
            }
        },
        [
            activeWorksheet,
            buildWorksheetAIPrompt,
            chatMutation,
            createWorksheetBlock,
            currentDataMode,
            scopedTrial,
            insertWorksheetBlocksAfter,
            isAllDocumentsMode,
            selectedDocuments,
            selectedTrialId,
            trialId,
        ]
    );

    const updateWorksheetTitle = useCallback(
        (title: string) => {
            updateWorksheet((draft) => ({ ...draft, title }));
        },
        [updateWorksheet]
    );

    const updateWorksheetSubtitle = useCallback(
        (subtitle: string) => {
            updateWorksheet((draft) => ({ ...draft, subtitle }));
        },
        [updateWorksheet]
    );

    const handleSaveWorksheetDraft = useCallback(() => {
        if (!activeWorksheet) return;
        const savedAt = new Date().toISOString();
        updateWorksheet((draft) => ({
            ...draft,
            status: "draft",
            savedAt,
            publishedAt: null,
        }));
        toast.success("Draft saved");
    }, [activeWorksheet, updateWorksheet]);

    const handlePublishWorksheet = useCallback(() => {
        if (!activeWorksheet) return;
        const publishedAt = new Date().toISOString();
        updateWorksheet((draft) => ({
            ...draft,
            status: "published",
            savedAt: publishedAt,
            publishedAt,
        }));
        toast.success("Worksheet published to team");
    }, [activeWorksheet, updateWorksheet]);

    const applySlashCommandToBlock = useCallback(
        (blockId: string, type: WorksheetBlockType) => {
            updateWorksheet((draft) => ({
                ...draft,
                blocks: draft.blocks.map((block) => {
                    if (block.id !== blockId) return block;
                    const nextBlock: WorksheetBlock = {
                        ...block,
                        type,
                        content: block.content.replace(/^\/\S*/, "").trim(),
                    };
                    if (type === "checklist") {
                        nextBlock.checked = Boolean(block.checked);
                    } else {
                        delete nextBlock.checked;
                    }
                    return nextBlock;
                }),
            }));
            setSlashMenu(null);
        },
        [updateWorksheet]
    );

    const slashCommandOptions = useMemo(() => {
        if (!slashMenu) return WORKSHEET_COMMANDS;
        const query = slashMenu.query.trim().toLowerCase();
        if (!query) return WORKSHEET_COMMANDS;
        return WORKSHEET_COMMANDS.filter(
            (command) =>
                command.title.toLowerCase().includes(query) ||
                command.subtitle.toLowerCase().includes(query) ||
                (command.kind === "block" ? command.type.toLowerCase().includes(query) : command.action.includes(query))
        );
    }, [slashMenu]);

    const insertMenuOptions = useMemo(() => {
        if (!insertMenu) return WORKSHEET_COMMANDS;
        const query = insertMenu.query.trim().toLowerCase();
        if (!query) return WORKSHEET_COMMANDS;
        return WORKSHEET_COMMANDS.filter(
            (command) =>
                command.title.toLowerCase().includes(query) ||
                command.subtitle.toLowerCase().includes(query) ||
                (command.kind === "block" ? command.type.toLowerCase().includes(query) : command.action.includes(query))
        );
    }, [insertMenu]);

    const worksheetSidebarCommands = useMemo(() => {
        const query = worksheetSidebarSearch.trim().toLowerCase();
        if (!query) return WORKSHEET_COMMANDS;
        return WORKSHEET_COMMANDS.filter(
            (command) =>
                command.title.toLowerCase().includes(query) ||
                command.subtitle.toLowerCase().includes(query) ||
                (command.kind === "block" ? command.type.toLowerCase().includes(query) : command.action.includes(query))
        );
    }, [worksheetSidebarSearch]);

    const worksheetSidebarBasicCommands = useMemo(
        () => worksheetSidebarCommands.filter((command) => command.group === "basic" || command.group === "advanced"),
        [worksheetSidebarCommands]
    );

    const worksheetSidebarAttributeActions = useMemo(() => {
        const query = worksheetSidebarSearch.trim().toLowerCase();
        if (!query) return WORKSHEET_ATTRIBUTE_ACTIONS;
        return WORKSHEET_ATTRIBUTE_ACTIONS.filter(
            (action) =>
                action.title.toLowerCase().includes(query) ||
                action.subtitle.toLowerCase().includes(query) ||
                action.initialContent.toLowerCase().includes(query)
        );
    }, [worksheetSidebarSearch]);

    const getWorksheetInsertionAnchor = useCallback(() => {
        if (!activeWorksheet) return null;
        if (
            activeWorksheetBlockId &&
            activeWorksheet.blocks.some((block) => block.id === activeWorksheetBlockId)
        ) {
            return activeWorksheetBlockId;
        }
        return activeWorksheet.blocks[activeWorksheet.blocks.length - 1]?.id || null;
    }, [activeWorksheet, activeWorksheetBlockId]);

    const buildWorksheetExportMarkup = useCallback(
        (draft: WorksheetDraft) => {
            const generatedAtLabel = new Date(worksheetDocumentHeader.generatedAt).toLocaleString();
            const lineHeight = documentStyle.lineSpacing === "1.5" ? "1.8" : "1.65";
            const bodyFontSize = documentStyle.bodySize === "11" ? "16px" : documentStyle.bodySize === "14" ? "18px" : "17px";
            let numberedCounter = 0;
            const blocksHtml = draft.blocks
                .map((block) => {
                    const rawContent = String(block.content || "").trim();
                    const content = escapeHtml(rawContent).replace(/\n/g, "<br />");
                    if (block.type !== "numbered") {
                        numberedCounter = 0;
                    }
                    switch (block.type) {
                        case "heading1":
                            return `<h1 style="font-size:34px;line-height:1.2;margin:28px 0 14px 0;font-weight:700;">${content || "&nbsp;"}</h1>`;
                        case "heading2":
                            return `<h2 style="font-size:28px;line-height:1.28;margin:24px 0 12px 0;font-weight:700;">${content || "&nbsp;"}</h2>`;
                        case "heading3":
                            return `<h3 style="font-size:22px;line-height:1.35;margin:20px 0 10px 0;font-weight:600;">${content || "&nbsp;"}</h3>`;
                        case "checklist":
                            return `<p style="margin:10px 0;font-size:${bodyFontSize};line-height:${lineHeight};">[${block.checked ? "x" : " "
                                }] ${content || "&nbsp;"}</p>`;
                        case "bulleted":
                            return `<p style="margin:10px 0;font-size:${bodyFontSize};line-height:${lineHeight};">• ${content || "&nbsp;"}</p>`;
                        case "numbered":
                            numberedCounter += 1;
                            return `<p style="margin:10px 0;font-size:${bodyFontSize};line-height:${lineHeight};">${numberedCounter}. ${content || "&nbsp;"}</p>`;
                        case "quote":
                            return `<blockquote style="margin:14px 0;padding-left:12px;border-left:2px solid #9ca3af;font-size:${bodyFontSize};line-height:${lineHeight};font-style:italic;">${content || "&nbsp;"}</blockquote>`;
                        case "callout":
                            return `<p style="margin:12px 0;padding:10px 12px;background:#fff7ed;border:1px solid #fdba74;border-radius:6px;font-size:${bodyFontSize};line-height:${lineHeight};">${content || "&nbsp;"}</p>`;
                        case "divider":
                            return `<hr style="border:none;border-top:1px solid #d1d5db;margin:16px 0;" />`;
                        case "code":
                            return `<pre style="margin:12px 0;padding:10px 12px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;font-size:14px;line-height:1.6;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${content || "&nbsp;"}</pre>`;
                        case "text":
                        default:
                            return `<p style="margin:10px 0;font-size:${bodyFontSize};line-height:${lineHeight};">${content || "&nbsp;"}</p>`;
                    }
                })
                .join("");

            const footerLogoHtml = worksheetDocumentFooter.logoDataUrl
                ? `<img src="${escapeHtml(worksheetDocumentFooter.logoDataUrl)}" alt="${escapeHtml(
                    worksheetDocumentFooter.name
                )} logo" style="height:28px;max-width:92px;object-fit:contain;display:block;" />`
                : `<div style="height:28px;width:28px;border-radius:6px;background:#2563eb;color:#ffffff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;">${escapeHtml(
                    worksheetDocumentFooter.initial
                )}</div>`;
            const footerInfoLines = [
                worksheetDocumentFooter.name,
                worksheetDocumentFooter.address,
                worksheetDocumentFooter.websiteRaw,
            ].filter(Boolean);
            const footerHtml = `<div style="margin-top:44px;padding-top:12px;border-top:1px solid #d1d5db;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:110px;vertical-align:top;">${footerLogoHtml}</td>
          <td style="vertical-align:top;font-size:11px;line-height:1.5;color:#4b5563;text-align:right;">
            ${footerInfoLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
          </td>
        </tr>
      </table>
    </div>`;

            const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(draft.title || "Visit Worksheet")}</title>
</head>
<body style="margin:0;background:#ffffff;color:#111827;font-family:${documentFontFamily};">
  <div style="max-width:820px;margin:0 auto;padding:56px 72px;">
    <div style="border-bottom:1px solid #d1d5db;padding-bottom:10px;margin-bottom:28px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="font-size:13px;line-height:1.45;font-weight:600;vertical-align:top;">
            ${escapeHtml(worksheetDocumentHeader.sponsor)}<br />
            Protocol number: ${escapeHtml(worksheetDocumentHeader.protocolNumber)}
          </td>
          <td style="font-size:13px;line-height:1.45;font-weight:600;text-align:right;vertical-align:top;">
            Protocol Version ${escapeHtml(worksheetDocumentHeader.protocolVersion)}<br />
            Amendment Version ${escapeHtml(worksheetDocumentHeader.amendmentVersion)}
          </td>
        </tr>
      </table>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <tr>
          <td style="font-size:11px;line-height:1.4;color:#4b5563;">Generated ${escapeHtml(generatedAtLabel)}</td>
          <td style="font-size:11px;line-height:1.4;color:#4b5563;text-align:right;">Generated by ${escapeHtml(
                worksheetDocumentHeader.generatedBy
            )}</td>
        </tr>
      </table>
    </div>
    ${blocksHtml}
    ${footerHtml}
  </div>
</body>
</html>`;

            const textLines: string[] = [
                `${worksheetDocumentHeader.sponsor}`,
                `Protocol number: ${worksheetDocumentHeader.protocolNumber}`,
                `Protocol Version ${worksheetDocumentHeader.protocolVersion}`,
                `Amendment Version ${worksheetDocumentHeader.amendmentVersion}`,
                `Generated ${generatedAtLabel}`,
                `Generated by ${worksheetDocumentHeader.generatedBy}`,
                "",
            ];
            let numberedTextCounter = 0;
            draft.blocks.forEach((block) => {
                const content = String(block.content || "").trim();
                if (!content && block.type !== "divider") return;
                switch (block.type) {
                    case "heading1":
                    case "heading2":
                    case "heading3":
                        numberedTextCounter = 0;
                        textLines.push(content.toUpperCase(), "");
                        break;
                    case "bulleted":
                        numberedTextCounter = 0;
                        textLines.push(`• ${content}`);
                        break;
                    case "numbered":
                        numberedTextCounter += 1;
                        textLines.push(`${numberedTextCounter}. ${content}`);
                        break;
                    case "checklist":
                        numberedTextCounter = 0;
                        textLines.push(`[${block.checked ? "x" : " "}] ${content}`);
                        break;
                    case "divider":
                        numberedTextCounter = 0;
                        textLines.push("----------------------------------------");
                        break;
                    default:
                        numberedTextCounter = 0;
                        textLines.push(content);
                        break;
                }
            });

            textLines.push("");
            textLines.push("Footer");
            textLines.push(worksheetDocumentFooter.name);
            if (worksheetDocumentFooter.address) {
                textLines.push(worksheetDocumentFooter.address);
            }
            if (worksheetDocumentFooter.websiteRaw) {
                textLines.push(worksheetDocumentFooter.websiteRaw);
            }

            return { html, plainText: textLines.join("\n") };
        },
        [
            documentFontFamily,
            documentStyle.bodySize,
            documentStyle.lineSpacing,
            worksheetDocumentHeader,
            worksheetDocumentFooter,
        ]
    );

    const handleExportWorksheet = useCallback(
        async (target: "word" | "gdocs") => {
            if (!activeWorksheet) return;
            const safeTitle =
                String(activeWorksheet.title || "visit-worksheet")
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "") || "visit-worksheet";
            const { html, plainText } = buildWorksheetExportMarkup(activeWorksheet);

            if (target === "word") {
                const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `${safeTitle}.doc`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                toast.success("Exported as Word document");
                return;
            }

            const docsWindow = window.open("https://docs.new", "_blank", "noopener,noreferrer");
            if (!docsWindow) {
                toast.error("Popup blocked. Enable popups to open Google Docs export.");
                return;
            }

            try {
                if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
                    const item = new ClipboardItem({
                        "text/html": new Blob([html], { type: "text/html" }),
                        "text/plain": new Blob([plainText], { type: "text/plain" }),
                    });
                    await navigator.clipboard.write([item]);
                } else if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(plainText);
                }
                toast.success("Google Docs opened. Worksheet copied to clipboard, paste with Cmd/Ctrl+V.");
            } catch {
                toast.info("Google Docs opened. Clipboard access was blocked, copy from the worksheet manually.");
            }
        },
        [activeWorksheet, buildWorksheetExportMarkup]
    );

    const handleClosePdfViewer = () => {
        setPdfViewerOpen(false);
        setPdfViewerExpanded(false);
        setSelectedDocument(null);
    };

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(RESPONSE_ARCHIVE_STORAGE_KEY);
            if (!raw) {
                setArchiveHydrated(true);
                return;
            }
            const parsed = JSON.parse(raw) as {
                groups?: ArchiveFolderGroup[];
                items?: ResponseArchiveItem[];
            };
            if (Array.isArray(parsed?.groups)) {
                setArchiveGroups(parsed.groups);
            }
            if (Array.isArray(parsed?.items)) {
                setArchiveItems(parsed.items);
            }
        } catch {
            // Ignore invalid local data and start with runtime defaults.
        } finally {
            setArchiveHydrated(true);
        }
    }, []);

    useEffect(() => {
        if (!archiveHydrated) return;
        window.localStorage.setItem(
            RESPONSE_ARCHIVE_STORAGE_KEY,
            JSON.stringify({
                groups: archiveGroups,
                items: archiveItems,
            })
        );
    }, [archiveHydrated, archiveGroups, archiveItems]);

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(WORKSHEET_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as WorksheetDraft[];
            if (!Array.isArray(parsed)) return;
            setWorksheetDrafts(
                parsed.map((draft) => ({
                    ...draft,
                    chatSessionId: draft.chatSessionId || null,
                    savedAt:
                        draft.savedAt ??
                        (draft.status === "published"
                            ? draft.publishedAt || draft.updatedAt || draft.createdAt || new Date().toISOString()
                            : null),
                    generatedAt: draft.generatedAt || draft.createdAt || new Date().toISOString(),
                    generatedBy: draft.generatedBy || "Unknown user",
                }))
            );
        } catch {
            // ignore corrupted local data
        }
    }, []);

    useEffect(() => {
        window.localStorage.setItem(WORKSHEET_STORAGE_KEY, JSON.stringify(worksheetDrafts));
    }, [worksheetDrafts]);

    useEffect(() => {
        if (!worksheetDrafts.length) return;

        try {
            const raw = window.localStorage.getItem(WORKSHEET_OPEN_REQUEST_KEY);
            if (!raw) return;
            const request = JSON.parse(raw) as {
                worksheetId?: string;
                trialId?: string | null;
                dataMode?: string;
                chatSessionId?: string | null;
            };

            const requestedWorksheetId = String(request?.worksheetId || "").trim();
            const requestedDataMode = String(request?.dataMode || "").trim();
            const requestedTrialId =
                request?.trialId === null || request?.trialId === undefined
                    ? null
                    : String(request.trialId);
            const requestedChatSessionId =
                request?.chatSessionId === null || request?.chatSessionId === undefined
                    ? null
                    : String(request.chatSessionId);

            if (!requestedWorksheetId) {
                window.localStorage.removeItem(WORKSHEET_OPEN_REQUEST_KEY);
                return;
            }

            if (requestedDataMode && requestedDataMode !== currentDataMode) {
                return;
            }

            if (requestedTrialId !== (trialId || null)) {
                return;
            }

            const targetWorksheet = worksheetDrafts.find((draft) => draft.id === requestedWorksheetId);
            window.localStorage.removeItem(WORKSHEET_OPEN_REQUEST_KEY);
            if (!targetWorksheet) return;

            const normalizeForMatch = (value: string) =>
                String(value || "")
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();
            const sourceQuestion = normalizeForMatch(targetWorksheet.sourceQuestion || "");
            const availableSessions = listChatSessions({
                trialId: trialId || null,
                dataMode: currentDataMode,
            });
            const inferredSession =
                (requestedChatSessionId
                    ? availableSessions.find((session) => session.id === requestedChatSessionId)
                    : null) ||
                (targetWorksheet.chatSessionId
                    ? availableSessions.find((session) => session.id === targetWorksheet.chatSessionId)
                    : null) ||
                (sourceQuestion
                    ? availableSessions.find((session) =>
                        session.messages.some(
                            (message) =>
                                message.role === "user" &&
                                normalizeForMatch(message.content || "") === sourceQuestion
                        )
                    )
                    : null);

            setActiveTab("ai-assistant");
            if (inferredSession?.id) {
                hydrateChatSession(inferredSession.id, false);
            }
            setActiveWorksheetId(targetWorksheet.id);
            setTaskPaneMode("worksheet");
            setTaskPaneOpen(true);
            setTaskPaneExpanded(false);
            setTaskPaneOpenedAt(Date.now());
            setIsWorksheetPaneGenerating(false);
            setPdfViewerOpen(false);
            setSelectedDocument(null);
        } catch {
            // Ignore malformed open request payloads.
        }
    }, [currentDataMode, trialId, worksheetDrafts, hydrateChatSession]);

    const normalizeArchiveId = (value: string) =>
        String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");

    const getCurrentRuntimeUser = () => {
        return readRuntimeUserInfo();
    };

    const getArchiveGroupIdForTrial = (trialIdentifier?: string | null) =>
        trialIdentifier ? `trial-${normalizeArchiveId(trialIdentifier)}` : "no-trial";

    const getArchiveGroupLabelForTrial = (trial?: { title?: string | null; investigationalProduct?: string | null }) =>
        String(trial?.investigationalProduct || trial?.title || "NO TRIAL")
            .trim()
            .toUpperCase();

    const getDefaultArchiveFolderId = (groupId: string) => `${groupId}-saved-responses`;

    const findGroupByFolderId = (folderId: string | null) => {
        if (!folderId) return null;
        return (
            archiveGroups.find((group) => group.folders.some((folder) => folder.id === folderId)) || null
        );
    };

    const isDefaultArchiveFolderId = (groupId: string, folderId: string) =>
        folderId === getDefaultArchiveFolderId(groupId);

    const ensureArchiveGroupAndFolder = (
        groupLabelRaw: string,
        folderLabelRaw: string,
        preferredGroupId?: string
    ) => {
        const groupLabel = String(groupLabelRaw || "NO TRIAL").trim().toUpperCase();
        const folderLabel = String(folderLabelRaw || "Saved Responses").trim();
        const groupId = preferredGroupId || normalizeArchiveId(groupLabel) || "no-trial";
        const defaultFolderId = getDefaultArchiveFolderId(groupId);
        const folderId = folderLabel === "Saved Responses"
            ? defaultFolderId
            : normalizeArchiveId(`${groupId}-${folderLabel}`) || defaultFolderId;

        setArchiveGroups((prev) => {
            const groupIndex = prev.findIndex((group) => group.id === groupId);
            if (groupIndex === -1) {
                return [
                    ...prev,
                    {
                        id: groupId,
                        label: groupLabel,
                        expanded: true,
                        folders: [{ id: folderId, label: folderLabel }],
                    },
                ];
            }
            const next = [...prev];
            const group = next[groupIndex];
            const hasFolder = group.folders.some((folder) => folder.id === folderId);
            next[groupIndex] = {
                ...group,
                expanded: true,
                folders: hasFolder ? group.folders : [...group.folders, { id: folderId, label: folderLabel }],
            };
            return next;
        });

        return { groupId, folderId, groupLabel, folderLabel };
    };

    const toggleArchiveGroup = (groupId: string) => {
        setArchiveGroups((prev) =>
            prev.map((group) =>
                group.id === groupId ? { ...group, expanded: !group.expanded } : group
            )
        );
    };

    useEffect(() => {
        const trialGroups: ArchiveFolderGroup[] = allTrials.map((trial: any) => {
            const groupId = getArchiveGroupIdForTrial(String(trial.id || ""));
            const label = getArchiveGroupLabelForTrial({
                title: trial.title,
                investigationalProduct: trial.investigationalProduct,
            });
            return {
                id: groupId,
                label,
                expanded: true,
                folders: [{ id: getDefaultArchiveFolderId(groupId), label: "Saved Responses" }],
            };
        });

        const noTrialGroup: ArchiveFolderGroup = {
            id: "no-trial",
            label: "NO TRIAL",
            expanded: true,
            folders: [{ id: getDefaultArchiveFolderId("no-trial"), label: "Saved Responses" }],
        };

        const nextBaseGroups = [...trialGroups, noTrialGroup];
        setArchiveGroups((prev) => {
            const prevById = new Map(prev.map((group) => [group.id, group]));
            return nextBaseGroups.map((base) => {
                const existing = prevById.get(base.id);
                if (!existing) return base;
                const baseFolderIds = new Set(base.folders.map((folder) => folder.id));
                const customFolders = existing.folders.filter((folder) => !baseFolderIds.has(folder.id));
                return {
                    ...base,
                    expanded: existing.expanded,
                    folders: [...base.folders, ...customFolders],
                };
            });
        });
    }, [allTrials, currentDataMode]);

    useEffect(() => {
        const scopedGroupId = trialId ? getArchiveGroupIdForTrial(trialId) : null;
        const validInScope = scopedGroupId
            ? archiveGroups
                .filter((group) => group.id === scopedGroupId)
                .some((group) => group.folders.some((folder) => folder.id === selectedArchiveFolderId))
            : archiveGroups.some((group) => group.folders.some((folder) => folder.id === selectedArchiveFolderId));

        if (selectedArchiveFolderId && !validInScope) {
            setSelectedArchiveFolderId(null);
            setSelectedArchiveItemId(null);
        }
    }, [archiveGroups, selectedArchiveFolderId, trialId]);

    const openArchiveCreateFolderDialog = () => {
        const scopedGroupId = trialId ? getArchiveGroupIdForTrial(trialId) : null;
        const selectedFolderGroup = findGroupByFolderId(selectedArchiveFolderId);
        const activeGroup =
            (scopedGroupId ? archiveGroups.find((group) => group.id === scopedGroupId) : null) ||
            selectedFolderGroup ||
            archiveGroups.find((group) => group.id !== "no-trial") ||
            archiveGroups[0] ||
            null;

        setPendingArchiveSave(null);
        setPendingArchiveMoveItemId(null);
        setArchiveFolderDialogMode("save");
        setArchiveFolderDialogStep("create");
        setArchiveDialogNewFolderName("");
        setArchiveDialogNewFolderGroupId(activeGroup?.id || scopedGroupId || "no-trial");
        setArchiveFolderDialogOpen(true);
    };

    const resolveArchiveDefaults = () => {
        const resolvedTrialId =
            trialId ||
            (activeTrials.length === 1 ? activeTrials[0] : null) ||
            null;
        const resolvedTrial = resolvedTrialId
            ? allTrials.find((trial: any) => String(trial.id) === String(resolvedTrialId))
            : null;
        const groupId = getArchiveGroupIdForTrial(resolvedTrialId);
        const groupLabel = resolvedTrial
            ? getArchiveGroupLabelForTrial({
                title: resolvedTrial.title,
                investigationalProduct: resolvedTrial.investigationalProduct,
            })
            : "NO TRIAL";
        const { folderId } = ensureArchiveGroupAndFolder(groupLabel, "Saved Responses", groupId);
        return { resolvedTrialId, groupId, groupLabel, folderId };
    };

    const saveArchiveItemToFolder = (
        messageEntry: ChatMessage,
        messageIndex: number,
        folderId: string
    ) => {
        if (messageEntry.role !== "assistant") return;
        const previousUserQuestion =
            [...chatHistory]
                .slice(0, messageIndex)
                .reverse()
                .find((entry) => entry.role === "user")?.content || "Saved Themison AI response";
        const { resolvedTrialId } = resolveArchiveDefaults();
        const folderGroup = findGroupByFolderId(folderId);
        const groupId = folderGroup?.id || "no-trial";
        const groupLabel = folderGroup?.label || "NO TRIAL";
        const runtimeUser = getCurrentRuntimeUser();
        const fallbackUser = demoState.teamMembers?.[0]?.name || "Kaleb Sanders";
        const queriedBy = runtimeUser?.name || fallbackUser;
        const queriedByEmail = runtimeUser?.email || null;
        const timestamp = new Date().toISOString();
        const title = previousUserQuestion.length > 96
            ? `${previousUserQuestion.slice(0, 93)}...`
            : previousUserQuestion;
        const archiveItem: ResponseArchiveItem = {
            id: `archive-${Date.now()}-${messageIndex}`,
            groupId,
            folderId,
            trialId: resolvedTrialId,
            dataMode: currentDataMode,
            queriedBy,
            queriedByEmail,
            question: previousUserQuestion,
            answer: messageEntry.content,
            title,
            savedAt: timestamp,
            trialLabel: groupLabel,
            sources: (messageEntry.sources || []).map((source) => ({
                filename: source.filename,
                section: source.section,
                page: source.page,
                category: source.category,
            })),
        };

        setArchiveItems((prev) => [archiveItem, ...prev]);
        setSelectedArchiveFolderId(folderId);
        setSelectedArchiveItemId(archiveItem.id);
        setActiveTab("response-archive");
        toast.success("Saved to Response Archive");
    };

    const openArchiveFolderDialogForSave = (messageEntry: ChatMessage, messageIndex: number) => {
        if (messageEntry.role !== "assistant") return;
        const { groupId, folderId } = resolveArchiveDefaults();
        const scopedGroupId = trialId ? getArchiveGroupIdForTrial(trialId) : null;
        const selectedFolderGroup = findGroupByFolderId(selectedArchiveFolderId);
        const isSelectedFolderInScope =
            !!selectedArchiveFolderId &&
            (!!selectedFolderGroup && (!scopedGroupId || selectedFolderGroup.id === scopedGroupId));
        const initialFolderId = isSelectedFolderInScope ? selectedArchiveFolderId! : folderId;
        const initialGroupId = selectedFolderGroup?.id && (!scopedGroupId || selectedFolderGroup.id === scopedGroupId)
            ? selectedFolderGroup.id
            : groupId;

        setPendingArchiveSave({ messageEntry, messageIndex });
        setPendingArchiveMoveItemId(null);
        setArchiveFolderDialogMode("save");
        setArchiveFolderDialogStep("select");
        setArchiveDialogSelectedFolderId(initialFolderId);
        setArchiveDialogNewFolderGroupId(initialGroupId);
        setArchiveDialogNewFolderName("");
        setArchiveFolderDialogOpen(true);
    };

    const openArchiveFolderDialogForMove = (item: ResponseArchiveItem) => {
        setPendingArchiveMoveItemId(item.id);
        setPendingArchiveSave(null);
        setArchiveFolderDialogMode("move");
        setArchiveFolderDialogStep("select");
        setArchiveDialogSelectedFolderId(item.folderId);
        setArchiveDialogNewFolderGroupId(item.groupId || "no-trial");
        setArchiveDialogNewFolderName("");
        setArchiveFolderDialogOpen(true);
    };

    const handleConfirmArchiveFolderDialog = () => {
        const targetFolderId = archiveDialogSelectedFolderId;

        if (!targetFolderId) {
            toast.error("Select a folder first");
            return;
        }

        if (archiveFolderDialogMode === "save" && pendingArchiveSave) {
            saveArchiveItemToFolder(
                pendingArchiveSave.messageEntry,
                pendingArchiveSave.messageIndex,
                targetFolderId
            );
            setArchiveFolderDialogOpen(false);
            setPendingArchiveSave(null);
            return;
        }

        if (archiveFolderDialogMode === "move" && pendingArchiveMoveItemId) {
            const folderGroup = findGroupByFolderId(targetFolderId);
            const nextGroupId = folderGroup?.id || "no-trial";
            setArchiveItems((prev) =>
                prev.map((item) =>
                    item.id === pendingArchiveMoveItemId
                        ? {
                            ...item,
                            folderId: targetFolderId,
                            groupId: nextGroupId,
                            trialLabel: folderGroup?.label || item.trialLabel,
                        }
                        : item
                )
            );
            setSelectedArchiveFolderId(targetFolderId);
            setSelectedArchiveItemId(pendingArchiveMoveItemId);
            setArchiveFolderDialogOpen(false);
            setPendingArchiveMoveItemId(null);
            toast.success("Response moved");
        }
    };

    const handleCreateArchiveFolderFromDialog = () => {
        const folderLabel = archiveDialogNewFolderName.trim();
        if (!folderLabel) {
            toast.error("Enter a folder name");
            return;
        }
        const scopedGroupId = trialId ? getArchiveGroupIdForTrial(trialId) : null;
        const targetGroupId = scopedGroupId || archiveDialogNewFolderGroupId;
        const activeGroup = archiveGroups.find((group) => group.id === targetGroupId);
        const groupLabel = activeGroup?.label || "NO TRIAL";
        const groupId = activeGroup?.id || targetGroupId || "no-trial";
        const { folderId } = ensureArchiveGroupAndFolder(groupLabel, folderLabel, groupId);
        setArchiveDialogSelectedFolderId(folderId);
        setArchiveDialogNewFolderGroupId(groupId);
        setArchiveDialogNewFolderName("");
        if (!pendingArchiveSave && !pendingArchiveMoveItemId) {
            setSelectedArchiveFolderId(folderId);
            setSelectedArchiveItemId(null);
            setArchiveFolderDialogOpen(false);
        } else {
            setArchiveFolderDialogStep("select");
        }
        toast.success(`Folder "${folderLabel}" created`);
    };

    const startRenameArchiveFolder = (groupId: string, folderId: string) => {
        if (isDefaultArchiveFolderId(groupId, folderId)) {
            toast.info("Default folder cannot be renamed");
            return;
        }
        const group = archiveGroups.find((entry) => entry.id === groupId);
        const folder = group?.folders.find((entry) => entry.id === folderId);
        if (!group || !folder) return;
        setRenamingFolder({ groupId, folderId });
        setRenamingFolderValue(folder.label);
    };

    const cancelRenameArchiveFolder = () => {
        setRenamingFolder(null);
        setRenamingFolderValue("");
    };

    const commitRenameArchiveFolder = () => {
        if (!renamingFolder) return;
        const { groupId, folderId } = renamingFolder;
        const group = archiveGroups.find((entry) => entry.id === groupId);
        const folder = group?.folders.find((entry) => entry.id === folderId);
        if (!group || !folder) {
            cancelRenameArchiveFolder();
            return;
        }

        const nextLabel = renamingFolderValue.trim();
        if (!nextLabel) {
            toast.error("Folder name cannot be empty");
            return;
        }
        if (nextLabel === folder.label) {
            cancelRenameArchiveFolder();
            return;
        }
        const duplicate = group.folders.some(
            (entry) => entry.id !== folderId && entry.label.toLowerCase() === nextLabel.toLowerCase()
        );
        if (duplicate) {
            toast.error("A folder with this name already exists");
            return;
        }

        setArchiveGroups((prev) =>
            prev.map((entry) =>
                entry.id === groupId
                    ? {
                        ...entry,
                        folders: entry.folders.map((target) =>
                            target.id === folderId ? { ...target, label: nextLabel } : target
                        ),
                    }
                    : entry
            )
        );
        cancelRenameArchiveFolder();
        toast.success("Folder renamed");
    };

    const handleDeleteArchiveFolder = (groupId: string, folderId: string) => {
        if (isDefaultArchiveFolderId(groupId, folderId)) {
            toast.info("Default folder cannot be deleted");
            return;
        }
        const group = archiveGroups.find((entry) => entry.id === groupId);
        const folder = group?.folders.find((entry) => entry.id === folderId);
        if (!group || !folder) return;
        const movedCount = archiveItems.filter(
            (item) => item.dataMode === currentDataMode && item.folderId === folderId
        ).length;
        setPendingFolderDelete({
            groupId,
            folderId,
            folderLabel: folder.label,
            movedCount,
        });
    };

    const handleArchiveDetailAction = (
        action: "copy" | "move" | "regenerate" | "note" | "conversation" | "thread" | "email",
        item: ResponseArchiveItem
    ) => {
        if (action === "copy") {
            const payload = `Question: ${item.question}\n\nAnswer:\n${item.answer}`;
            try {
                if (navigator?.clipboard?.writeText) {
                    navigator.clipboard.writeText(payload).then(() => {
                        toast.success("Copied response");
                    });
                } else {
                    toast.success("Copied response");
                }
            } catch {
                toast.success("Copied response");
            }
            return;
        }

        if (action === "move") {
            openArchiveFolderDialogForMove(item);
            return;
        }

        const actionLabels: Record<Exclude<typeof action, "copy" | "move">, string> = {
            regenerate: "Regenerate",
            note: "Save to notes",
            conversation: "Start conversation",
            thread: "Create thread",
            email: "Send as email",
        };
        toast.info(`${actionLabels[action]} coming soon`);
    };

    const renderResponseArchivePanel = () => {
        const scopedGroupId = trialId ? getArchiveGroupIdForTrial(trialId) : null;
        const displayGroups = scopedGroupId
            ? archiveGroups.filter((group) => group.id === scopedGroupId)
            : archiveGroups;
        const allowedFolderIds = new Set(displayGroups.flatMap((group) => group.folders.map((folder) => folder.id)));
        const visibleArchiveItems = archiveItems.filter((item) => {
            if (item.dataMode !== currentDataMode) return false;
            if (!allowedFolderIds.has(item.folderId)) return false;
            if (trialId && String(item.trialId || "") !== String(trialId)) return false;
            return true;
        });
        const groupCounts = new Map<string, number>();
        const folderCounts = new Map<string, number>();
        for (const group of displayGroups) {
            const folderIds = group.folders.map((folder) => folder.id);
            const count = visibleArchiveItems.filter((item) => folderIds.includes(item.folderId)).length;
            groupCounts.set(group.id, count);
        }
        for (const item of visibleArchiveItems) {
            folderCounts.set(item.folderId, (folderCounts.get(item.folderId) || 0) + 1);
        }

        const normalizedArchiveSearch = archiveSearchQuery.trim().toLowerCase();
        const searchFilteredItems = normalizedArchiveSearch
            ? visibleArchiveItems.filter((item) =>
                `${item.title} ${item.question} ${item.answer}`.toLowerCase().includes(normalizedArchiveSearch)
            )
            : visibleArchiveItems;
        const sortedSearchItems = [...searchFilteredItems].sort((a, b) => +new Date(b.savedAt) - +new Date(a.savedAt));
        const shouldShowGlobalSearchResults = !selectedArchiveFolderId && normalizedArchiveSearch.length > 0;
        const selectedFolderItems = selectedArchiveFolderId
            ? sortedSearchItems.filter((item) => item.folderId === selectedArchiveFolderId)
            : shouldShowGlobalSearchResults
                ? sortedSearchItems
                : [];
        const selectedArchiveItem =
            selectedArchiveItemId
                ? (normalizedArchiveSearch ? searchFilteredItems : visibleArchiveItems).find((item) => item.id === selectedArchiveItemId) || null
                : null;
        const selectedFolder =
            selectedArchiveFolderId
                ? displayGroups.flatMap((group) => group.folders).find((folder) => folder.id === selectedArchiveFolderId) || null
                : null;

        return (
            <div className="flex-1 overflow-hidden px-8 pb-8 pt-4 bg-[#F9FAFB]">
                <div className="h-full bg-white border border-gray-200 rounded-xl overflow-hidden flex">
                    <div className="w-[320px] border-r border-gray-200 flex flex-col">
                        <div className="px-5 h-14 border-b border-gray-200 flex items-center justify-between">
                            <span className="text-xs tracking-wider font-semibold text-[#667085]">FOLDERS</span>
                            <button
                                type="button"
                                onClick={openArchiveCreateFolderDialog}
                                className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                            >
                                <Plus className="w-4 h-4" />
                                New
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                            {displayGroups.map((group) => {
                                const count = groupCounts.get(group.id) ?? 0;
                                return (
                                    <div key={group.id} className="space-y-1">
                                        <button
                                            type="button"
                                            onClick={() => toggleArchiveGroup(group.id)}
                                            className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-sm font-semibold text-slate-700 uppercase tracking-wide hover:bg-gray-50 rounded"
                                        >
                                            {group.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                            <span className="truncate">{group.label}</span>
                                            <span className="ml-auto text-xs font-medium text-gray-400">{count}</span>
                                        </button>
                                        {group.expanded && (
                                            <div className="pl-6 space-y-1">
                                                {group.folders.map((folder) => (
                                                    (() => {
                                                        const folderCount = folderCounts.get(folder.id) || 0;
                                                        const isDefaultFolder = isDefaultArchiveFolderId(group.id, folder.id);
                                                        const isRenaming =
                                                            renamingFolder?.groupId === group.id && renamingFolder?.folderId === folder.id;
                                                        return (
                                                            <div key={folder.id} className="group flex items-center gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setSelectedArchiveFolderId(folder.id);
                                                                        setSelectedArchiveItemId(null);
                                                                    }}
                                                                    className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-left text-[15px] ${selectedArchiveFolderId === folder.id
                                                                        ? "bg-blue-50 text-blue-700"
                                                                        : "text-slate-600 hover:bg-gray-50"
                                                                        }`}
                                                                >
                                                                    <Folder className="w-4 h-4" />
                                                                    {isRenaming ? (
                                                                        <input
                                                                            autoFocus
                                                                            value={renamingFolderValue}
                                                                            onChange={(event) => setRenamingFolderValue(event.target.value)}
                                                                            onClick={(event) => event.stopPropagation()}
                                                                            onKeyDown={(event) => {
                                                                                if (event.key === "Enter") {
                                                                                    event.preventDefault();
                                                                                    commitRenameArchiveFolder();
                                                                                } else if (event.key === "Escape") {
                                                                                    event.preventDefault();
                                                                                    cancelRenameArchiveFolder();
                                                                                }
                                                                            }}
                                                                            onBlur={() => commitRenameArchiveFolder()}
                                                                            className="h-7 w-full min-w-0 rounded border border-blue-200 bg-white px-2 text-sm text-slate-700 outline-none ring-1 ring-blue-100"
                                                                        />
                                                                    ) : (
                                                                        <span className="truncate">{folder.label}</span>
                                                                    )}
                                                                    <span className="ml-auto text-xs font-medium text-gray-400">{folderCount}</span>
                                                                </button>
                                                                {!isDefaultFolder ? (
                                                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                        {isRenaming ? (
                                                                            <>
                                                                                <button
                                                                                    type="button"
                                                                                    className="p-1 rounded hover:bg-emerald-50 text-gray-400 hover:text-emerald-600"
                                                                                    onMouseDown={(event) => event.preventDefault()}
                                                                                    onClick={(event) => {
                                                                                        event.stopPropagation();
                                                                                        commitRenameArchiveFolder();
                                                                                    }}
                                                                                    aria-label="Confirm rename"
                                                                                >
                                                                                    <Check className="w-3.5 h-3.5" />
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                                                                                    onMouseDown={(event) => event.preventDefault()}
                                                                                    onClick={(event) => {
                                                                                        event.stopPropagation();
                                                                                        cancelRenameArchiveFolder();
                                                                                    }}
                                                                                    aria-label="Cancel rename"
                                                                                >
                                                                                    <X className="w-3.5 h-3.5" />
                                                                                </button>
                                                                            </>
                                                                        ) : (
                                                                            <button
                                                                                type="button"
                                                                                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    startRenameArchiveFolder(group.id, folder.id);
                                                                                }}
                                                                                aria-label="Rename folder"
                                                                            >
                                                                                <Pen className="w-3.5 h-3.5" />
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            type="button"
                                                                            className="p-1 rounded hover:bg-rose-50 text-gray-400 hover:text-rose-600"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                handleDeleteArchiveFolder(group.id, folder.id);
                                                                            }}
                                                                            aria-label="Delete folder"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        );
                                                    })()
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="w-[420px] border-r border-gray-200 flex flex-col">
                        <div className="px-4 h-14 border-b border-gray-200 flex items-center">
                            <div className="w-full flex items-center justify-end gap-2">
                                {archiveSearchOpen ? (
                                    <div className="relative flex-1">
                                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            ref={archiveSearchInputRef}
                                            type="text"
                                            value={archiveSearchQuery}
                                            onChange={(event) => setArchiveSearchQuery(event.target.value)}
                                            placeholder="Search responses"
                                            className="w-full h-9 rounded-md border border-gray-200 pl-9 pr-8 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                        <button
                                            type="button"
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                            onClick={() => {
                                                setArchiveSearchQuery("");
                                                setArchiveSearchOpen(false);
                                            }}
                                            aria-label="Close search"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : null}
                                <button
                                    type="button"
                                    className={`h-9 w-9 inline-flex items-center justify-center rounded-md border transition-colors ${archiveSearchOpen || archiveSearchQuery.trim()
                                        ? "border-blue-200 bg-blue-50 text-blue-600"
                                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                                        }`}
                                    onClick={() => {
                                        if (!archiveSearchOpen) {
                                            setArchiveSearchOpen(true);
                                            return;
                                        }
                                        if (archiveSearchQuery.trim()) {
                                            setArchiveSearchQuery("");
                                        } else {
                                            setArchiveSearchOpen(false);
                                        }
                                    }}
                                    aria-label="Search responses"
                                >
                                    <Search className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                        {!selectedArchiveFolderId && !shouldShowGlobalSearchResults ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                                <FileText className="w-14 h-14 text-gray-300 mb-4" />
                                <p className="text-2xl font-medium text-center leading-tight max-w-[280px]">
                                    Select a folder to view responses
                                </p>
                            </div>
                        ) : selectedFolderItems.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 px-8 text-center">
                                <FileText className="w-14 h-14 text-gray-300 mb-4" />
                                <p className="text-lg">
                                    {normalizedArchiveSearch
                                        ? "No responses match your search"
                                        : `No saved responses in ${selectedFolder?.label || "this folder"} yet`}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="px-5 py-3 border-b border-gray-200">
                                    <p className="text-sm font-semibold text-gray-700">
                                        {selectedFolder?.label || (normalizedArchiveSearch ? "Search results" : "Responses")}
                                    </p>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        {selectedFolderItems.length} {normalizedArchiveSearch ? "matching response(s)" : "saved response(s)"}
                                    </p>
                                </div>
                                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                                    {selectedFolderItems.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => setSelectedArchiveItemId(item.id)}
                                            className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${selectedArchiveItemId === item.id
                                                ? "border-blue-200 bg-blue-50"
                                                : "border-gray-200 hover:bg-gray-50"
                                                }`}
                                        >
                                            <p className="text-sm font-medium text-gray-900 line-clamp-2">{item.title}</p>
                                            <p className="text-xs text-gray-500 mt-2">
                                                {new Date(item.savedAt).toLocaleString()}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex-1 flex flex-col">
                        {!selectedArchiveItem ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                                <FileText className="w-14 h-14 text-gray-300 mb-4" />
                                <p className="text-2xl font-medium text-center leading-tight max-w-[340px]">
                                    Select a response to view details
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="px-6 py-4 border-b border-gray-200">
                                    <h2 className="text-lg font-semibold text-gray-900">{selectedArchiveItem.title}</h2>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {selectedArchiveItem.trialLabel} · Queried by {selectedArchiveItem.queriedBy}
                                        {selectedArchiveItem.queriedByEmail ? ` (${selectedArchiveItem.queriedByEmail})` : ""}
                                        {" · "}
                                        Saved {new Date(selectedArchiveItem.savedAt).toLocaleString()}
                                    </p>
                                </div>
                                <div className="px-6 py-3 border-b border-gray-100">
                                    <div className="flex items-center gap-2 text-gray-500">
                                        <div className="relative group">
                                            <button
                                                className="p-1.5 rounded hover:bg-gray-100 hover:text-gray-700"
                                                aria-label="Copy response"
                                                onClick={() => handleArchiveDetailAction("copy", selectedArchiveItem)}
                                            >
                                                <Copy className="w-4 h-4" />
                                            </button>
                                            <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                Copy response
                                            </div>
                                        </div>
                                        <div className="relative group">
                                            <button
                                                className="p-1.5 rounded hover:bg-amber-50 hover:text-amber-600"
                                                aria-label="Move to folder"
                                                onClick={() => handleArchiveDetailAction("move", selectedArchiveItem)}
                                            >
                                                <Folder className="w-4 h-4" />
                                            </button>
                                            <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                Move to folder
                                            </div>
                                        </div>
                                        <div className="relative group">
                                            <button
                                                className="p-1.5 rounded hover:bg-indigo-50 hover:text-indigo-600"
                                                aria-label="Regenerate"
                                                onClick={() => handleArchiveDetailAction("regenerate", selectedArchiveItem)}
                                            >
                                                <Play className="w-4 h-4" />
                                            </button>
                                            <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                Regenerate
                                            </div>
                                        </div>
                                        <div className="h-4 w-px bg-gray-200 mx-1" />
                                        <div className="relative group">
                                            <button
                                                className="p-1.5 rounded hover:bg-gray-100 hover:text-gray-700"
                                                aria-label="Save to notes"
                                                onClick={() => handleArchiveDetailAction("note", selectedArchiveItem)}
                                            >
                                                <Bookmark className="w-4 h-4" />
                                            </button>
                                            <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                Save to notes
                                            </div>
                                        </div>
                                        <div className="relative group">
                                            <button
                                                className="p-1.5 rounded hover:bg-blue-50 hover:text-blue-600"
                                                aria-label="Start conversation"
                                                onClick={() => handleArchiveDetailAction("conversation", selectedArchiveItem)}
                                            >
                                                <MessageSquare className="w-4 h-4" />
                                            </button>
                                            <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                Start conversation
                                            </div>
                                        </div>
                                        <div className="relative group">
                                            <button
                                                className="p-1.5 rounded hover:bg-blue-100 hover:text-blue-600"
                                                aria-label="Create thread"
                                                onClick={() => handleArchiveDetailAction("thread", selectedArchiveItem)}
                                            >
                                                <AtSign className="w-4 h-4" />
                                            </button>
                                            <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                Create thread
                                            </div>
                                        </div>
                                        <div className="relative group">
                                            <button
                                                className="p-1.5 rounded hover:bg-blue-100 hover:text-blue-600"
                                                aria-label="Send as email"
                                                onClick={() => handleArchiveDetailAction("email", selectedArchiveItem)}
                                            >
                                                <Mail className="w-4 h-4" />
                                            </button>
                                            <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                Send as email
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                    <section>
                                        <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase mb-2">Question</p>
                                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{selectedArchiveItem.question}</p>
                                    </section>
                                    <section>
                                        <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase mb-2">Answer</p>
                                        <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                                            {selectedArchiveItem.answer}
                                        </div>
                                    </section>
                                    {selectedArchiveItem.sources.length > 0 && (
                                        <section>
                                            <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase mb-2">Sources</p>
                                            <div className="space-y-2">
                                                {selectedArchiveItem.sources.map((source, index) => (
                                                    <div key={`${selectedArchiveItem.id}-source-${index}`} className="rounded-lg border border-gray-200 px-3 py-2">
                                                        <p className="text-sm font-medium text-gray-800">{source.filename}</p>
                                                        <p className="text-xs text-gray-500 mt-1">
                                                            {source.section || "Section n/a"}{source.page ? ` · p.${source.page}` : ""}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const suggestedPrompts = [
        { icon: FileText, text: "What happens at Visit 3?", color: "text-gray-500" },
        { icon: FileSearch, text: "Summarize inclusion criteria", color: "text-gray-500" },
        { icon: Calendar, text: "What are the visit windows?", color: "text-gray-500" },
        { icon: CheckSquare, text: "Generate Visit 1 checklist", color: "text-gray-500" },
    ];
    const isCrossTrialMode = !trialId;
    const allScopeSearchLabel = isCrossTrialMode
        ? "Cross-trial documents + operational data"
        : "All Documents";
    const selectedScopeSearchLabel =
        !isAllDocumentsMode && selectedDocuments.length > 0 && (trialId ? true : activeTrials.length > 0)
            ? `${selectedDocuments.length} selected document(s) from ${trialId ? 1 : activeTrials.length} trial(s)`
            : allScopeSearchLabel;
    const assistantSubtitle = isCrossTrialMode
        ? "Ask questions across trials using documents and operational data"
        : "Ask questions about your trial documents and generate operational outputs";
    const starterPromptPlaceholder = isCrossTrialMode
        ? "Ask across trials, protocols, and operational status..."
        : "Ask about your protocol, amendments, or trial documents...";

    const handleWorkspacePaneToggle = useCallback(() => {
        if (taskPaneOpen) {
            setTaskPaneOpen(false);
            setTaskPaneExpanded(false);
            return;
        }

        if (activeWorksheetId) {
            setTaskPaneMode("worksheet");
        } else if (taskPaneDocument) {
            setTaskPaneMode("source");
        }

        setTaskPaneOpen(true);
        setTaskPaneExpanded(false);
    }, [activeWorksheetId, taskPaneDocument, taskPaneOpen]);

    const renderTopNav = () => (
        <div className="bg-[#F9FAFB] px-8 pt-3 pb-1">
            <div className="flex h-11 items-center gap-6 rounded-md border border-gray-200 bg-white px-5 py-0">
                {(() => {
                    const backHref = trialId ? `/trial/${trialId}` : "/trial-workspace";
                    const backLabel = trialId ? "Trial Overview" : "Back";
                    return (
                        <button
                            onClick={() => {
                                if (typeof window !== "undefined" && window.history.length > 1) {
                                    window.history.back();
                                    return;
                                }
                                navigate(backHref);
                            }}
                            className="flex items-center gap-2 border-r border-gray-200 pr-5 text-xs text-gray-500 transition-colors hover:text-gray-700"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            <span>{backLabel}</span>
                        </button>
                    );
                })()}
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                    <button
                        onClick={() => setActiveTab("ai-assistant")}
                        className={`flex items-center gap-2 whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors ${activeTab === "ai-assistant"
                            ? "text-blue-700 bg-blue-50"
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                            }`}
                    >
                        <Brain className="w-4 h-4" />
                        <span>Themison AI</span>
                    </button>
                    <button
                        onClick={() => setActiveTab("response-archive")}
                        className={`flex items-center gap-2 whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors ${activeTab === "response-archive"
                            ? "text-blue-700 bg-blue-50"
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                            }`}
                    >
                        <Archive className="w-4 h-4" />
                        <span>Response Archive</span>
                    </button>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    {activeTab === "ai-assistant" ? (
                        <button
                            type="button"
                            onClick={handleWorkspacePaneToggle}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors ${taskPaneOpen
                                ? "bg-blue-50 text-blue-700"
                                : "bg-transparent hover:bg-gray-50 hover:text-gray-700"
                                }`}
                            aria-label={taskPaneOpen ? "Hide workspace pane" : "Show workspace pane"}
                            title={taskPaneOpen ? "Hide workspace pane" : "Show workspace pane"}
                        >
                            <PanelRight className="h-4 w-4" />
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );

    // Main Layout
    return (
        <>
            {/* Source Modal */}
            {renderSourceModal()}
            {renderArchiveFolderDialog()}
            {renderDeleteFolderDialog()}
            <div className="flex flex-col h-full overflow-hidden">
                {/* Fixed Top Nav */}
                <div className="flex-shrink-0">
                    {renderTopNav()}
                </div>

                {/* Main Content */}
                {activeTab === "response-archive" ? (
                    renderResponseArchivePanel()
                ) : (
                    <div className="flex-1 flex overflow-hidden relative transition-opacity duration-500 ease-in-out" style={{ opacity: isTransitioning ? 0 : 1 }}>
                        {/* Left: Chat Area */}
                        <div
                            className={`flex flex-col transition-all duration-300 ${taskPaneOpen
                                ? "w-[45%]"
                                : pdfViewerOpen && !pdfViewerExpanded
                                    ? "w-1/2"
                                    : "w-full"
                                }`}
                            style={{ display: taskPaneExpanded ? "none" : undefined }}
                        >
                            {/* Chat Messages Area */}
                            <div className="flex-1 overflow-y-auto py-8 relative">
                                <div className="max-w-5xl mx-auto px-6 space-y-8 relative">
                                    {chatHistory.length === 0 ? (
                                        <div className="flex flex-col items-center text-center space-y-10 pt-6">
                                            <div className="space-y-2">
                                                <h1 className="text-3xl font-semibold text-[#0E0017]">Themison AI</h1>
                                                <p className="text-gray-600">
                                                    {assistantSubtitle}
                                                </p>
                                                {trialId && scopedTrial && (
                                                    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                                                        Scoped to: {scopedTrial.investigationalProduct || "Drug not specified"} · {scopedTrial.sponsor || "Sponsor not specified"}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="w-full space-y-4">
                                                <div className="rounded-[16px] bg-[#f3f4f6] pt-2 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_rgba(15,23,42,0.06)] lg:rounded-[20px]">
                                                    <div className="flex items-center gap-1 px-2 pb-2 pt-1 text-xs text-gray-600">
                                                        <FileSearch className="h-4 w-4 flex-shrink-0" />
                                                        <span className="flex-shrink-0">Searching:</span>
                                                        <span className="truncate font-medium text-gray-900">{selectedScopeSearchLabel}</span>
                                                    </div>
                                                    <div className="space-y-4 rounded-[15px] border border-[#eceef2] bg-white px-4 pb-3 pt-6 lg:rounded-[19px]">
                                                        <Textarea
                                                            ref={textareaRef}
                                                            value={message}
                                                            onChange={(e) => setMessage(e.target.value)}
                                                            onKeyDown={handleKeyDown}
                                                            placeholder={starterPromptPlaceholder}
                                                            className="min-h-[80px] max-h-48 overflow-y-auto border-0 resize-none focus-visible:ring-0 focus-visible:border-0 shadow-none text-[#0E0017] caret-[#0E0017] placeholder:text-gray-400"
                                                        />
                                                        <div className="mt-3 flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    className="rounded-full bg-[#f3f4f6] p-1.5 text-gray-500 hover:bg-[#e9edf2] hover:text-[#0E0017]"
                                                                    onClick={() =>
                                                                        logEvent({
                                                                            eventType: "feature_used",
                                                                            action: "attach",
                                                                            entityType: "chat_input",
                                                                        })
                                                                    }
                                                                >
                                                                    <Paperclip className="h-4 w-4" />
                                                                </button>
                                                                <div ref={contextMenuRef} className="relative">
                                                                    <button
                                                                        type="button"
                                                                        className="flex items-center gap-2 rounded-full bg-[#f3f4f6] px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-[#e9edf2] hover:text-[#0E0017]"
                                                                        aria-expanded={contextMenuOpen}
                                                                        onClick={() => {
                                                                            logEvent({
                                                                                eventType: "feature_used",
                                                                                action: "add_context",
                                                                                entityType: "chat_input",
                                                                            });
                                                                            setContextMenuOpen((open) => !open);
                                                                        }}
                                                                    >
                                                                        <Plus className="h-3.5 w-3.5" />
                                                                        Add context
                                                                    </button>
                                                                    {renderAddContextMenu()}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    className="flex items-center gap-2 rounded-full bg-[#f3f4f6] px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-[#e9edf2] hover:text-[#0E0017]"
                                                                    onClick={() =>
                                                                        logEvent({
                                                                            eventType: "feature_used",
                                                                            action: "auto_mode",
                                                                            entityType: "chat_input",
                                                                        })
                                                                    }
                                                                >
                                                                    <Sparkles className="h-3.5 w-3.5" />
                                                                    Auto
                                                                </button>
                                                                <button
                                                                    className="rounded-full bg-[#f3f4f6] p-1.5 text-gray-500 hover:bg-[#e9edf2] hover:text-[#0E0017]"
                                                                    onClick={() =>
                                                                        logEvent({
                                                                            eventType: "feature_used",
                                                                            action: "voice_input",
                                                                            entityType: "chat_input",
                                                                        })
                                                                    }
                                                                >
                                                                    <Mic className="h-4 w-4" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={handleSend}
                                                                    className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-[#8FAEF6] disabled:text-white disabled:opacity-100"
                                                                    disabled={isLoading || !message.trim()}
                                                                >
                                                                    <ArrowUp className="h-4 w-4" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <div className="relative group">
                                                        <button
                                                            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-full hover:bg-gray-200 transition-colors"
                                                            onClick={() =>
                                                                logEvent({
                                                                    eventType: "feature_used",
                                                                    action: "create_output",
                                                                    entityType: "chat_toolbar",
                                                                })
                                                            }
                                                        >
                                                            <Sparkles className="w-4 h-4" />
                                                            Create
                                                        </button>
                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                            Create output
                                                        </div>
                                                    </div>
                                                    <div className="relative group">
                                                        <button
                                                            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-full hover:bg-gray-200 transition-colors"
                                                            onClick={() => {
                                                                logEvent({
                                                                    eventType: "feature_used",
                                                                    action: "open_sources",
                                                                    entityType: "chat_toolbar",
                                                                });
                                                                setSourceModalOpen(true);
                                                            }}
                                                        >
                                                            <Plus className="w-4 h-4" />
                                                            Source
                                                        </button>
                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                            Trial documents
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-3 w-full">
                                                <p className="text-center text-sm text-gray-500">Explore what you can ask</p>
                                                <div className="grid grid-cols-4 gap-3">
                                                    {suggestedPrompts.map((prompt, index) => (
                                                        <button
                                                            key={index}
                                                            onClick={() => {
                                                                logEvent({
                                                                    eventType: "feature_used",
                                                                    action: "use_suggested_prompt",
                                                                    entityType: "chat_prompt",
                                                                    payload: { prompt: prompt.text },
                                                                });
                                                                handlePromptClick(prompt.text);
                                                            }}
                                                            className="bg-white rounded-lg p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_rgba(15,23,42,0.06)] hover:scale-[1.02] transition-all group"
                                                            style={{ borderWidth: '1.5px', borderColor: '#f2f2f2', borderStyle: 'solid' }}
                                                        >
                                                            <prompt.icon className={`w-6 h-6 mb-3 ${prompt.color} group-hover:text-blue-600`} />
                                                            <p className="text-sm text-gray-700 group-hover:text-gray-900">{prompt.text}</p>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            {chatHistory.map((msg, index) => (
                                                <div key={index} className="space-y-3">
                                                    <div
                                                        className={`flex items-center gap-2 h-8 ${msg.role === "user" ? "justify-end" : "justify-start"
                                                            }`}
                                                    >
                                                        <div
                                                            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === "user" ? "bg-blue-100" : "bg-gray-100"
                                                                }`}
                                                        >
                                                            {msg.role === "user" ? (
                                                                <User className="w-4 h-4 text-blue-600" />
                                                            ) : (
                                                                <Brain className="w-5 h-5 text-gray-600" />
                                                            )}
                                                        </div>
                                                        <span className="text-sm font-medium text-gray-900">
                                                            {msg.role === "user" ? "You" : "Themison AI"}
                                                        </span>
                                                    </div>

                                                    <div className="space-y-3">
                                                        {msg.role === "assistant" && (
                                                            <div className="max-w-4xl mx-auto">
                                                                <details className="group mb-4">
                                                                    <summary className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 transition-colors">
                                                                        <div className="flex items-center gap-2">
                                                                            <Sparkles className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                                                            <span className="font-medium">Reasoning Summary</span>
                                                                        </div>
                                                                        <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" />
                                                                    </summary>
                                                                    <div className="rounded-b-lg border border-t-0 border-gray-200 px-4 py-3 text-sm text-gray-600 bg-white/60 whitespace-pre-wrap">
                                                                        {msg.thoughtsSummary || msg.thinking || "Reasoning summaries will appear here."}
                                                                    </div>
                                                                </details>
                                                                <div className="mt-4 border-t border-gray-200" />
                                                            </div>
                                                        )}

                                                        <div
                                                            className={
                                                                msg.role === "assistant"
                                                                    ? "max-w-4xl mx-auto w-full"
                                                                    : "w-full flex justify-end"
                                                            }
                                                        >
                                                            <div
                                                                className={`break-words ${msg.role === "assistant" ? "w-full" : "max-w-2xl w-fit"
                                                                    }`}
                                                            >
                                                                {msg.role === "assistant" ? (
                                                                    <ReactMarkdown
                                                                        remarkPlugins={[remarkGfm]}
                                                                        components={{
                                                                            code({ inline, className, children, ...props }: any) {
                                                                                const match = /language-(\w+)/.exec(className || "");
                                                                                return !inline && match ? (
                                                                                    <SyntaxHighlighter
                                                                                        style={vscDarkPlus}
                                                                                        language={match[1]}
                                                                                        PreTag="div"
                                                                                        className="rounded-lg my-4"
                                                                                        {...props}
                                                                                    >
                                                                                        {String(children).replace(/\n$/, "")}
                                                                                    </SyntaxHighlighter>
                                                                                ) : (
                                                                                    <code
                                                                                        className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono"
                                                                                        {...props}
                                                                                    >
                                                                                        {children}
                                                                                    </code>
                                                                                );
                                                                            },
                                                                            h1: ({ children }) => (
                                                                                <h1 className="text-3xl font-bold mt-8 mb-6 text-gray-900">
                                                                                    {children}
                                                                                </h1>
                                                                            ),
                                                                            h2: ({ children }) => (
                                                                                <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-900">
                                                                                    {children}
                                                                                </h2>
                                                                            ),
                                                                            h3: ({ children }) => (
                                                                                <h3 className="text-xl font-bold mt-6 mb-3 text-gray-900">
                                                                                    {children}
                                                                                </h3>
                                                                            ),
                                                                            p: ({ children, node }) => {
                                                                                const isFirstParagraph = node?.position?.start?.line === 1;
                                                                                if (isFirstParagraph) {
                                                                                    return (
                                                                                        <p className="mb-6 leading-relaxed text-gray-900 text-base font-bold">
                                                                                            {children}
                                                                                        </p>
                                                                                    );
                                                                                }
                                                                                return (
                                                                                    <p className="mb-5 leading-relaxed text-gray-700 text-sm">
                                                                                        {children}
                                                                                    </p>
                                                                                );
                                                                            },
                                                                            ul: ({ children }) => (
                                                                                <ul className="list-disc list-inside mb-4 space-y-2">
                                                                                    {children}
                                                                                </ul>
                                                                            ),
                                                                            ol: ({ children }) => (
                                                                                <ol className="list-decimal list-inside mb-4 space-y-2">
                                                                                    {children}
                                                                                </ol>
                                                                            ),
                                                                            li: ({ children }) => (
                                                                                <li className="leading-relaxed">{children}</li>
                                                                            ),
                                                                            blockquote: ({ children }) => (
                                                                                <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-4 italic text-gray-600 bg-blue-50 rounded-r">
                                                                                    {children}
                                                                                </blockquote>
                                                                            ),
                                                                            a: ({ children, href }) => {
                                                                                const taskLink = parseTaskEditorLinkHref(href);
                                                                                if (taskLink) {
                                                                                    const taskLabelFromLink = Array.isArray(children)
                                                                                        ? children
                                                                                            .map((item) => (typeof item === "string" ? item : ""))
                                                                                            .join("")
                                                                                            .trim()
                                                                                        : typeof children === "string"
                                                                                            ? children.trim()
                                                                                            : "";
                                                                                    return (
                                                                                        <a
                                                                                            href={href}
                                                                                            className="text-emerald-700 hover:text-emerald-800 underline decoration-emerald-400"
                                                                                            onClick={(event) => {
                                                                                                event.preventDefault();
                                                                                                handleOpenTaskEditor({
                                                                                                    ...taskLink,
                                                                                                    taskName: taskLink.taskName || taskLabelFromLink || undefined,
                                                                                                });
                                                                                            }}
                                                                                        >
                                                                                            {children}
                                                                                        </a>
                                                                                    );
                                                                                }
                                                                                return (
                                                                                    <a
                                                                                        href={href}
                                                                                        className="text-blue-600 hover:text-blue-700 underline"
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                    >
                                                                                        {children}
                                                                                    </a>
                                                                                );
                                                                            },
                                                                            strong: ({ children }) => (
                                                                                <strong className="font-semibold text-gray-900">
                                                                                    {children}
                                                                                </strong>
                                                                            ),
                                                                            em: ({ children }) => <em className="italic">{children}</em>,
                                                                        }}
                                                                    >
                                                                        {msg.content.replace(/【[^】]+】/g, "").trim()}
                                                                    </ReactMarkdown>
                                                                ) : (
                                                                    <div className="whitespace-pre-wrap break-words leading-relaxed bg-white px-4 py-3 rounded-lg text-sm">
                                                                        {msg.content}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (() => {
                                                            const previousQuestion = getPreviousUserQuestion(index).toLowerCase();
                                                            const taskIntent = /\b(task|tasks|to do|todo|today|due)\b/i.test(previousQuestion);

                                                            const normalizedSources = msg.sources
                                                                .map((source) => {
                                                                    const isTaskSource =
                                                                        Boolean(source.taskId) || String(source.category || "").toLowerCase() === "task";
                                                                    const canOpenTask = isTaskSource && Boolean(source.taskId);
                                                                    const canOpenDocument = !isTaskSource && Boolean(source.fileUrl);
                                                                    const title = String(
                                                                        (isTaskSource ? source.filename : source.filename || source.category) || "Document"
                                                                    ).trim();
                                                                    const isPlaceholderDocument =
                                                                        !isTaskSource &&
                                                                        title.toLowerCase() === "document" &&
                                                                        !canOpenDocument &&
                                                                        !source.page &&
                                                                        !source.documentId;
                                                                    return {
                                                                        source,
                                                                        isTaskSource,
                                                                        canOpenTask,
                                                                        canOpenDocument,
                                                                        title,
                                                                        isPlaceholderDocument,
                                                                    };
                                                                })
                                                                .filter((entry) => !entry.isPlaceholderDocument)
                                                                .filter((entry) => entry.canOpenTask || entry.canOpenDocument);

                                                            const taskFocusedSources = taskIntent
                                                                ? normalizedSources.filter((entry) => entry.isTaskSource)
                                                                : normalizedSources;
                                                            const displayCandidates = taskFocusedSources.length > 0 ? taskFocusedSources : normalizedSources;

                                                            const seen = new Set<string>();
                                                            const dedupedSources = displayCandidates.filter((entry) => {
                                                                const source = entry.source;
                                                                const dedupeKey = entry.isTaskSource
                                                                    ? `task:${source.taskId || source.filename || ""}`
                                                                    : `doc:${source.fileUrl || ""}:${source.section || ""}:${source.page || ""}`;
                                                                if (seen.has(dedupeKey)) return false;
                                                                seen.add(dedupeKey);
                                                                return true;
                                                            });

                                                            if (dedupedSources.length === 0) return null;
                                                            const isExpanded = expandedSources[index] || false;
                                                            const maxVisibleSources = 10;
                                                            const visibleSources = isExpanded ? dedupedSources : dedupedSources.slice(0, maxVisibleSources);
                                                            const showToggle = dedupedSources.length > maxVisibleSources;

                                                            return (
                                                                <div className="mt-8 space-y-3 max-w-4xl mx-auto pt-4 border-t border-gray-200">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                                                                            {taskIntent ? "Related tasks" : "Evidence and linked records"}
                                                                        </p>
                                                                        {showToggle ? (
                                                                            <p className="text-[11px] text-gray-500">
                                                                                {isExpanded
                                                                                    ? `Showing all ${dedupedSources.length} sources`
                                                                                    : `Showing top ${visibleSources.length} of ${dedupedSources.length}`
                                                                                }
                                                                            </p>
                                                                        ) : null}
                                                                    </div>
                                                                    {visibleSources.map((entry, sourceIndex) => {
                                                                        const source = entry.source;
                                                                        return (
                                                                            <div
                                                                                key={sourceIndex}
                                                                                className="bg-white/70 border border-gray-100 rounded-xl p-3 space-y-2"
                                                                            >
                                                                                <div className="flex items-start justify-between">
                                                                                    <div className="flex items-start gap-3">
                                                                                        {entry.isTaskSource ? (
                                                                                            <CheckSquare className="w-5 h-5 text-emerald-600 mt-0.5" />
                                                                                        ) : (
                                                                                            <FileText className="w-5 h-5 text-blue-600 mt-0.5" />
                                                                                        )}
                                                                                        <div>
                                                                                            <p className="text-sm font-semibold text-gray-900">
                                                                                                {entry.title}
                                                                                            </p>
                                                                                            <p className="text-[11px] text-gray-500 mt-0.5">
                                                                                                {entry.isTaskSource
                                                                                                    ? source.section || "Task context"
                                                                                                    : `${source.section ? `Section "${source.section}"` : "Document source"}${source.page ? ` · Page ${source.page}` : ""
                                                                                                    }`}
                                                                                            </p>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                                <p className="text-xs text-gray-600 italic ml-8 mt-2">
                                                                                    {source.excerpt
                                                                                        ? source.excerpt.replace(/【[^】]+】/g, "").trim() || "Excerpt not available."
                                                                                        : "Excerpt not available."}
                                                                                </p>
                                                                                {entry.canOpenTask ? (
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            const key = (source as any).fileId || source.filename || "";
                                                                                            const meta = liveSourceMeta[key];
                                                                                            handleOpenTaskDocument({
                                                                                                ...source,
                                                                                                highlightUrl: source.highlightUrl || meta?.highlightUrl,
                                                                                                bboxes: source.bboxes || meta?.bboxes,
                                                                                            });
                                                                                        }}
                                                                                        className="inline-flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg mt-2"
                                                                                    >
                                                                                        Open task
                                                                                        <ExternalLink className="w-4 h-4" />
                                                                                    </button>
                                                                                ) : entry.canOpenDocument ? (
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            const key = (source as any).fileId || source.filename || "";
                                                                                            const meta = liveSourceMeta[key];
                                                                                            handleOpenTaskDocument({
                                                                                                ...source,
                                                                                                highlightUrl: source.highlightUrl || meta?.highlightUrl,
                                                                                                bboxes: source.bboxes || meta?.bboxes,
                                                                                            });
                                                                                        }}

                                                                                        className="inline-flex items-center gap-2 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg mt-2"
                                                                                    >
                                                                                        Open document
                                                                                        <ExternalLink className="w-4 h-4" />
                                                                                    </button>
                                                                                ) : null}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    {showToggle && (
                                                                        <button
                                                                            onClick={() => {
                                                                                setExpandedSources((prev) => ({
                                                                                    ...prev,
                                                                                    [index]: !isExpanded,
                                                                                }));
                                                                            }}
                                                                            className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50/50 hover:bg-blue-50 px-3 py-2 rounded-xl mt-2 w-full justify-center transition-colors border border-dashed border-blue-200"
                                                                        >
                                                                            {isExpanded ? (
                                                                                <>
                                                                                    Show less
                                                                                    <ChevronUp className="w-3.5 h-3.5" />
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    Show {dedupedSources.length - visibleSources.length} more sources
                                                                                    <ChevronDown className="w-3.5 h-3.5" />
                                                                                </>
                                                                            )}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}

                                                        {msg.role === "assistant" && shouldSuggestWorksheet(index, msg) && (
                                                            <div className="mt-6 max-w-4xl mx-auto">
                                                                <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-4">
                                                                    <div className="flex items-start gap-3">
                                                                        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
                                                                            <Brain className="h-4 w-4" />
                                                                        </span>
                                                                        <div className="min-w-0">
                                                                            <p className="text-sm font-semibold text-indigo-700">Action suggestion</p>
                                                                            <p className="text-sm text-gray-700 mt-1">
                                                                                I can create a visit worksheet for your team (checklist, timing, and required documentation).
                                                                            </p>
                                                                            <div className="mt-3 flex items-center gap-3">
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => handleCreateWorksheetFromMessage(index, msg)}
                                                                                    disabled={worksheetGenerationMessageIndex === index}
                                                                                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium px-4 py-2 transition-colors"
                                                                                >
                                                                                    {worksheetGenerationMessageIndex === index ? "Creating..." : "Create Worksheet"}
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => dismissWorksheetSuggestion(index, msg)}
                                                                                    className="text-sm text-gray-500 hover:text-gray-700"
                                                                                >
                                                                                    Not now
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {msg.role === "assistant" && (
                                                            <div className="max-w-4xl mx-auto mt-6 pt-4 border-t border-gray-200">
                                                                <div className="flex items-center gap-2 text-gray-500">
                                                                    <div className="relative group">
                                                                        <button
                                                                            className="p-1.5 rounded hover:bg-gray-100 hover:text-gray-700"
                                                                            aria-label="Copy response"
                                                                            onClick={() => {
                                                                                const markCopied = () => {
                                                                                    setCopiedMessageIndex(index);
                                                                                    window.setTimeout(() => {
                                                                                        setCopiedMessageIndex((current) =>
                                                                                            current === index ? null : current
                                                                                        );
                                                                                    }, 1500);
                                                                                };

                                                                                try {
                                                                                    if (navigator?.clipboard?.writeText) {
                                                                                        navigator.clipboard
                                                                                            .writeText(msg.content)
                                                                                            .then(markCopied)
                                                                                            .catch(markCopied);
                                                                                    } else {
                                                                                        markCopied();
                                                                                    }
                                                                                } catch {
                                                                                    markCopied();
                                                                                }
                                                                            }}
                                                                        >
                                                                            {copiedMessageIndex === index ? (
                                                                                <Check className="w-4 h-4 text-emerald-600" />
                                                                            ) : (
                                                                                <Copy className="w-4 h-4" />
                                                                            )}
                                                                        </button>
                                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                                            Copy response
                                                                        </div>
                                                                    </div>
                                                                    <div className="relative group">
                                                                        <button
                                                                            className="p-1.5 rounded hover:bg-emerald-100 hover:text-emerald-600"
                                                                            aria-label="Good answer"
                                                                            onClick={() => {
                                                                                logEvent({
                                                                                    eventType: "ai_response_accepted",
                                                                                    action: "accepted",
                                                                                    entityType: "response",
                                                                                    entityId: String(index),
                                                                                    aiInvolved: true,
                                                                                    aiOutput: msg.content,
                                                                                });
                                                                            }}
                                                                        >
                                                                            <Check className="w-4 h-4" />
                                                                        </button>
                                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                                            Good answer
                                                                        </div>
                                                                    </div>
                                                                    <div className="relative group">
                                                                        <button
                                                                            className="p-1.5 rounded hover:bg-rose-100 hover:text-rose-600"
                                                                            aria-label="Bad response"
                                                                            onClick={() => {
                                                                                logEvent({
                                                                                    eventType: "ai_response_rejected",
                                                                                    action: "rejected",
                                                                                    entityType: "response",
                                                                                    entityId: String(index),
                                                                                    aiInvolved: true,
                                                                                    aiOutput: msg.content,
                                                                                });
                                                                            }}
                                                                        >
                                                                            <X className="w-4 h-4" />
                                                                        </button>
                                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                                            Bad response
                                                                        </div>
                                                                    </div>
                                                                    <div className="relative group">
                                                                        <button
                                                                            className="p-1.5 rounded hover:bg-gray-100 hover:text-gray-700"
                                                                            aria-label="Regenerate"
                                                                        >
                                                                            <Play className="w-4 h-4" />
                                                                        </button>
                                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                                            Regenerate
                                                                        </div>
                                                                    </div>
                                                                    <div className="h-4 w-px bg-gray-200 mx-1" />
                                                                    <div className="relative group">
                                                                        <button
                                                                            className="p-1.5 rounded hover:bg-gray-100 hover:text-gray-700"
                                                                            aria-label="Save to notes"
                                                                        >
                                                                            <Bookmark className="w-4 h-4" />
                                                                        </button>
                                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                                            Save to notes
                                                                        </div>
                                                                    </div>
                                                                    <div className="relative group">
                                                                        <button
                                                                            className="p-1.5 rounded hover:bg-blue-50 hover:text-blue-600"
                                                                            aria-label="Start conversation"
                                                                        >
                                                                            <MessageSquare className="w-4 h-4" />
                                                                        </button>
                                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                                            Start conversation
                                                                        </div>
                                                                    </div>
                                                                    <div className="relative group">
                                                                        <button
                                                                            className="p-1.5 rounded hover:bg-blue-100 hover:text-blue-600"
                                                                            aria-label="Create thread"
                                                                        >
                                                                            <AtSign className="w-4 h-4" />
                                                                        </button>
                                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                                            Create thread
                                                                        </div>
                                                                    </div>
                                                                    <div className="relative group">
                                                                        <button
                                                                            className="p-1.5 rounded hover:bg-blue-100 hover:text-blue-600"
                                                                            aria-label="Send as email"
                                                                        >
                                                                            <Mail className="w-4 h-4" />
                                                                        </button>
                                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                                            Send as email
                                                                        </div>
                                                                    </div>
                                                                    <div className="relative group">
                                                                        <button
                                                                            className="p-1.5 rounded hover:bg-indigo-50 hover:text-indigo-600"
                                                                            aria-label="Save to QA Repository"
                                                                            onClick={() => openArchiveFolderDialogForSave(msg, index)}
                                                                        >
                                                                            <Database className="w-4 h-4" />
                                                                        </button>
                                                                        <div className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                                            Save to QA Repository
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}

                                            {isLoading && (
                                                <div className="flex gap-4 items-start max-w-3xl">
                                                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gray-100">
                                                        <Brain className="w-5 h-5 text-gray-600" />
                                                    </div>
                                                    <div className="flex-1 space-y-3">
                                                        <div className="flex items-center h-8">
                                                            <span className="text-sm font-medium text-[#0E0017]">Themison AI</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-gray-500">
                                                            <div className="flex gap-1">
                                                                <div
                                                                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                                                                    style={{ animationDelay: "0ms" }}
                                                                />
                                                                <div
                                                                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                                                                    style={{ animationDelay: "150ms" }}
                                                                />
                                                                <div
                                                                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                                                                    style={{ animationDelay: "300ms" }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            <div ref={chatEndRef} />
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Input Area - Fixed at Bottom */}
                            {chatHistory.length > 0 && (
                                <div className="flex-shrink-0 py-4 bg-gray-50">
                                    <div className="max-w-5xl mx-auto px-6">
                                        {/* Input Box */}
                                        <div className="rounded-[16px] bg-[#f3f4f6] pt-2 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_rgba(15,23,42,0.06)] lg:rounded-[20px]">
                                            <div className="mb-2 flex items-center justify-between gap-3 px-2 pt-1 text-xs text-gray-600">
                                                <div className="min-w-0 flex-1 overflow-hidden">
                                                    <div className="flex items-center gap-1">
                                                        <FileSearch className="h-4 w-4 flex-shrink-0" />
                                                        <span className="flex-shrink-0">Searching:</span>
                                                        <span className="truncate font-medium text-gray-900">{selectedScopeSearchLabel}</span>
                                                    </div>
                                                </div>
                                                {!isAllDocumentsMode && (
                                                    <button
                                                        onClick={() => {
                                                            setIsAllDocumentsMode(true);
                                                            setSelectedDocuments([]);
                                                            setSelectedTrials([]);
                                                            setActiveTrials([]);
                                                            toast.success(
                                                                isCrossTrialMode
                                                                    ? "Now searching cross-trial documents and operational data"
                                                                    : "Now searching all documents"
                                                            );
                                                            logEvent({
                                                                eventType: "feature_used",
                                                                action: "clear_filter",
                                                                entityType: "document_filter",
                                                                payload: { trialId, demoMode: currentDataMode },
                                                            });
                                                        }}
                                                        className="flex-shrink-0 whitespace-nowrap text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                                    >
                                                        Clear filter
                                                    </button>
                                                )}
                                            </div>
                                            <div className="space-y-3 rounded-[15px] border border-[#eceef2] bg-white px-4 pb-3 pt-3 lg:rounded-[19px]">
                                                <Textarea
                                                    ref={textareaRef}
                                                    value={message}
                                                    onChange={(e) => setMessage(e.target.value)}
                                                    onKeyDown={handleKeyDown}
                                                    placeholder="Ask a follow-up question..."
                                                    className="min-h-[80px] max-h-48 overflow-y-auto border-0 resize-none focus-visible:ring-0 focus-visible:border-0 shadow-none text-[#0E0017] caret-[#0E0017] placeholder:text-gray-400"
                                                />

                                                <div className="mt-3 flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <button className="rounded-full bg-[#f3f4f6] p-1.5 text-gray-500 hover:bg-[#e9edf2] hover:text-[#0E0017]">
                                                            <Paperclip className="h-4 w-4" />
                                                        </button>
                                                        <div ref={contextMenuRef} className="relative">
                                                            <button
                                                                type="button"
                                                                className="flex items-center gap-2 rounded-full bg-[#f3f4f6] px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-[#e9edf2] hover:text-[#0E0017]"
                                                                aria-expanded={contextMenuOpen}
                                                                onClick={() => {
                                                                    logEvent({
                                                                        eventType: "feature_used",
                                                                        action: "add_context",
                                                                        entityType: "chat_input",
                                                                    });
                                                                    setContextMenuOpen((open) => !open);
                                                                }}
                                                            >
                                                                <Plus className="h-3.5 w-3.5" />
                                                                Add context
                                                            </button>
                                                            {renderAddContextMenu()}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button className="flex items-center gap-2 rounded-full bg-[#f3f4f6] px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-[#e9edf2] hover:text-[#0E0017]">
                                                            <Sparkles className="h-3.5 w-3.5" />
                                                            Auto
                                                            <ChevronDown className="h-3.5 w-3.5" />
                                                        </button>
                                                        <button className="rounded-full bg-[#f3f4f6] p-1.5 text-gray-500 hover:bg-[#e9edf2] hover:text-[#0E0017]">
                                                            <Mic className="h-4 w-4" />
                                                        </button>
                                                        <Button
                                                            onClick={handleSend}
                                                            disabled={!message.trim() || isLoading}
                                                            size="icon"
                                                            variant="ghost"
                                                            className="rounded-full bg-blue-600 text-white hover:bg-blue-700"
                                                        >
                                                            <ArrowUp className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Task Pane - Right Side */}
                        {taskPaneOpen && (
                            <div
                                className={`${taskPaneExpanded ? "fixed inset-0 z-[999] bg-white p-3 sm:p-4" : "w-[55%] pl-4 pr-6 pb-4 pt-2"} transition-all duration-500 ease-out`}
                            >
                                <div
                                    className={`${taskPaneExpanded ? "h-full rounded-2xl" : "h-full rounded-2xl"} relative bg-white border border-gray-200 flex flex-col min-h-0 overflow-hidden`}
                                >
                                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                                        <div className="min-w-0">
                                            <p className="text-[11px] uppercase tracking-wide text-gray-500">
                                                {taskPaneMode === "worksheet"
                                                    ? isWorksheetPaneGenerating
                                                        ? "Themison AI"
                                                        : `AI Generated • ${titleCase(activeWorksheet?.status || "draft")}`
                                                    : "Evidence Viewer"}
                                            </p>
                                            <p className="text-sm font-semibold text-gray-900 truncate">
                                                {taskPaneMode === "worksheet"
                                                    ? isWorksheetPaneGenerating
                                                        ? "Building Worksheet"
                                                        : activeWorksheet?.title || "Visit Worksheet"
                                                    : taskPaneDocument?.name || "Study source"}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {taskPaneMode === "worksheet" && activeWorksheet && !isWorksheetPaneGenerating && (
                                                <>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5">
                                                                <Download className="h-3.5 w-3.5" />
                                                                Export
                                                                <ChevronDown className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onSelect={() => void handleExportWorksheet("word")}>
                                                                Export to Word (.doc)
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onSelect={() => void handleExportWorksheet("gdocs")}>
                                                                Export to Google Docs
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={handleSaveWorksheetDraft}
                                                        className="h-8"
                                                    >
                                                        Save Draft
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        onClick={handlePublishWorksheet}
                                                        className="h-8"
                                                    >
                                                        {activeWorksheet.status === "published" ? "Published" : "Publish to Team"}
                                                    </Button>
                                                </>
                                            )}
                                            {taskPaneMode === "source" && taskPaneDocument?.url && (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => window.open(
                                                        taskPaneDocument.url,
                                                        "_blank",
                                                        "noopener,noreferrer"
                                                    )}
                                                    className="h-8"
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                                    Open
                                                </Button>
                                            )}
                                            <div className="h-4 w-px bg-gray-200 mx-1" />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setTaskPaneExpanded(prev => {
                                                        const next = !prev;
                                                        logEvent({
                                                            eventType: "feature_used",
                                                            action: next ? "expand_pane" : "collapse_pane",
                                                            entityType: "task_pane",
                                                        });
                                                        return next;
                                                    });
                                                }}
                                                className="text-gray-400 hover:text-gray-600"
                                                aria-label={taskPaneExpanded ? "Exit fullscreen" : "Expand pane"}
                                            >
                                                {taskPaneExpanded ? (
                                                    <Minimize2 className="h-4 w-4" />
                                                ) : (
                                                    <Maximize2 className="h-4 w-4" />
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (taskPaneOpenedAt && taskPaneDocument) {
                                                        logEvent({
                                                            eventType: "protocol_section_viewed",
                                                            action: "closed",
                                                            entityType: "protocol",
                                                            entityId: taskPaneDocument.name,
                                                            durationMs: Date.now() - taskPaneOpenedAt,
                                                            payload: {
                                                                section: taskPaneDocument.section,
                                                                page: taskPaneDocument.page,
                                                                trialId,
                                                                demoMode: currentDataMode,
                                                            },
                                                        });
                                                    }
                                                    setTaskPaneExpanded(false);
                                                    setTaskPaneOpen(false);
                                                }}
                                                className="text-gray-400 hover:text-gray-600"
                                                aria-label="Close pane"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex-1 min-h-0 relative">
                                        {taskPaneExpanded && taskPaneMode === "worksheet" && activeWorksheet && !isWorksheetPaneGenerating && (
                                            <aside className="absolute inset-y-0 left-0 z-20 w-[262px] border-r border-gray-200 bg-[#f8f9fb]">
                                                <div className="h-full min-h-0 flex flex-col">
                                                    <div className="shrink-0 border-b border-gray-200 bg-[#f8f9fb]">
                                                        <div className="grid grid-cols-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setWorksheetSidebarTab("attributes");
                                                                    setWorksheetSidebarSearch("");
                                                                }}
                                                                className={`h-10 px-4 text-left text-sm border-r border-gray-200 transition-colors ${worksheetSidebarTab === "attributes"
                                                                    ? "bg-white font-semibold text-gray-900"
                                                                    : "bg-[#f8f9fb] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                                                                    }`}
                                                            >
                                                                Attributes
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setWorksheetSidebarTab("basic");
                                                                    setWorksheetSidebarSearch("");
                                                                }}
                                                                className={`h-10 px-4 text-left text-sm transition-colors ${worksheetSidebarTab === "basic"
                                                                    ? "bg-white font-semibold text-gray-900"
                                                                    : "bg-[#f8f9fb] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                                                                    }`}
                                                            >
                                                                Basic
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="shrink-0 px-3 py-3 border-b border-gray-200 bg-[#f8f9fb]">
                                                        <button
                                                            type="button"
                                                            onClick={() => setFloatingAIOpen(true)}
                                                            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                                                        >
                                                            <Brain className="h-3.5 w-3.5" />
                                                            Themison Assistant
                                                        </button>
                                                        {worksheetSidebarTab === "attributes" && (
                                                            <div className="mt-3 space-y-2">
                                                                <label className="block">
                                                                    <span className="text-[11px] uppercase tracking-wide text-gray-500">Font</span>
                                                                    <select
                                                                        value={documentStyle.fontFamily}
                                                                        onChange={(event) =>
                                                                            setDocumentStyle((prev) => ({
                                                                                ...prev,
                                                                                fontFamily: event.target.value as "times" | "calibri" | "arial",
                                                                            }))
                                                                        }
                                                                        className="mt-1 h-8 w-full rounded border border-gray-300 bg-white px-2 text-xs text-gray-700"
                                                                    >
                                                                        <option value="times">Times New Roman</option>
                                                                        <option value="calibri">Calibri</option>
                                                                        <option value="arial">Arial</option>
                                                                    </select>
                                                                </label>
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    <label className="block">
                                                                        <span className="text-[11px] uppercase tracking-wide text-gray-500">Size</span>
                                                                        <select
                                                                            value={documentStyle.bodySize}
                                                                            onChange={(event) =>
                                                                                setDocumentStyle((prev) => ({
                                                                                    ...prev,
                                                                                    bodySize: event.target.value as "11" | "12" | "14",
                                                                                }))
                                                                            }
                                                                            className="mt-1 h-8 w-full rounded border border-gray-300 bg-white px-2 text-xs text-gray-700"
                                                                        >
                                                                            <option value="11">11 pt</option>
                                                                            <option value="12">12 pt</option>
                                                                            <option value="14">14 pt</option>
                                                                        </select>
                                                                    </label>
                                                                    <label className="block">
                                                                        <span className="text-[11px] uppercase tracking-wide text-gray-500">Line</span>
                                                                        <select
                                                                            value={documentStyle.lineSpacing}
                                                                            onChange={(event) =>
                                                                                setDocumentStyle((prev) => ({
                                                                                    ...prev,
                                                                                    lineSpacing: event.target.value as "1.15" | "1.5",
                                                                                }))
                                                                            }
                                                                            className="mt-1 h-8 w-full rounded border border-gray-300 bg-white px-2 text-xs text-gray-700"
                                                                        >
                                                                            <option value="1.15">1.15</option>
                                                                            <option value="1.5">1.5</option>
                                                                        </select>
                                                                    </label>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3">
                                                        {worksheetSidebarTab === "attributes" ? (
                                                            <>
                                                                {(["sections", "layout"] as const).map((category) => {
                                                                    const actions = worksheetSidebarAttributeActions.filter(
                                                                        (action) => action.category === category
                                                                    );
                                                                    if (actions.length === 0) return null;
                                                                    return (
                                                                        <div key={category}>
                                                                            <p className="px-2 text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                                                                                {category === "sections" ? "Sections" : "Layout"}
                                                                            </p>
                                                                            <div className="space-y-0.5">
                                                                                {actions.map((action) => (
                                                                                    <button
                                                                                        key={action.id}
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            const targetBlockId = getWorksheetInsertionAnchor();
                                                                                            if (!targetBlockId) return;
                                                                                            insertWorksheetBlockAfter(
                                                                                                targetBlockId,
                                                                                                action.type,
                                                                                                action.initialContent
                                                                                            );
                                                                                        }}
                                                                                        className="w-full rounded-md px-2 py-1.5 text-left hover:bg-white border border-transparent hover:border-gray-200"
                                                                                    >
                                                                                        <div className="flex items-start justify-between gap-2">
                                                                                            <div className="min-w-0">
                                                                                                <p className="text-xs font-medium text-gray-900 truncate">{action.title}</p>
                                                                                                <p className="text-[11px] text-gray-500 truncate">{action.subtitle}</p>
                                                                                            </div>
                                                                                            {action.shortcut ? (
                                                                                                <span className="mt-0.5 text-[10px] text-gray-400">{action.shortcut}</span>
                                                                                            ) : null}
                                                                                        </div>
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </>
                                                        ) : (
                                                            (["basic", "advanced"] as const).map((group) => {
                                                                const commands = worksheetSidebarBasicCommands.filter((command) => command.group === group);
                                                                if (commands.length === 0) return null;
                                                                return (
                                                                    <div key={group}>
                                                                        <p className="px-2 text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                                                                            {worksheetCommandGroupLabel(group)}
                                                                        </p>
                                                                        <div className="space-y-0.5">
                                                                            {commands.map((command) => (
                                                                                <button
                                                                                    key={command.kind === "block" ? command.type : command.action}
                                                                                    type="button"
                                                                                    onClick={() => {
                                                                                        const targetBlockId = getWorksheetInsertionAnchor();
                                                                                        if (!targetBlockId) return;
                                                                                        if (command.kind === "block") {
                                                                                            insertWorksheetBlockAfter(targetBlockId, command.type);
                                                                                            return;
                                                                                        }
                                                                                        void runWorksheetAICommand({
                                                                                            action: command.action,
                                                                                            targetBlockId,
                                                                                        });
                                                                                    }}
                                                                                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-white border border-transparent hover:border-gray-200"
                                                                                >
                                                                                    <div className="flex items-center justify-between">
                                                                                        <div className="flex items-start gap-2 min-w-0">
                                                                                            <span className="mt-0.5 text-[10px] text-gray-500">{command.shortcut || "•"}</span>
                                                                                            <div className="min-w-0">
                                                                                                <p className="text-xs font-medium text-gray-900 truncate">{command.title}</p>
                                                                                                <p className="text-[11px] text-gray-500 truncate">{command.subtitle}</p>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })
                                                        )}
                                                    </div>
                                                    {worksheetSidebarTab === "basic" && (
                                                        <div className="border-t border-gray-200 p-2">
                                                            <div className="relative">
                                                                <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
                                                                <input
                                                                    value={worksheetSidebarSearch}
                                                                    onChange={(event) => setWorksheetSidebarSearch(event.target.value)}
                                                                    placeholder="Search commands..."
                                                                    className="w-full h-8 rounded border border-gray-300 bg-white pl-7 pr-2 text-xs text-gray-700 outline-none focus:border-gray-400"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </aside>
                                        )}
                                        <div
                                            className={`h-full min-h-0 overflow-y-auto px-6 py-5 ${taskPaneExpanded && taskPaneMode === "worksheet" && activeWorksheet && !isWorksheetPaneGenerating
                                                ? "ml-[286px]"
                                                : ""
                                                }`}
                                        >
                                            {taskPaneMode === "source" ? (
                                                taskPaneDocument ? (
                                                    <div className="h-full flex flex-col gap-4">
                                                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div>
                                                                    <p className="text-sm font-semibold text-gray-900">
                                                                        {taskPaneDocument.section || "Source evidence"}
                                                                    </p>
                                                                    <p className="text-xs text-gray-500 mt-1">
                                                                        {taskPaneDocument.page
                                                                            ? `Page ${taskPaneDocument.page}`
                                                                            : "Page reference not available"}
                                                                    </p>
                                                                </div>
                                                                {activeWorksheet && (
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        onClick={() => setTaskPaneMode("worksheet")}
                                                                    >
                                                                        Back to worksheet
                                                                    </Button>
                                                                )}
                                                            </div>
                                                            {taskPaneDocument.excerpt ? (
                                                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                                                    <p className="text-sm leading-relaxed text-amber-900 italic">
                                                                        "{taskPaneDocument.excerpt.replace(/【[^】]+】/g, "").trim()}"
                                                                    </p>
                                                                </div>
                                                            ) : (
                                                                <p className="text-sm text-gray-600">
                                                                    No highlighted excerpt available for this source.
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-h-[460px] rounded-xl border border-gray-200 overflow-hidden bg-white">
                                                            <object
                                                                data={taskPaneDocument.url}
                                                                type="application/pdf"
                                                                className="w-full h-full"
                                                                aria-label={taskPaneDocument.name}
                                                            >
                                                                <iframe
                                                                    src={taskPaneDocument.url}
                                                                    className="w-full h-full"
                                                                    title={taskPaneDocument.name}
                                                                />
                                                            </object>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="h-full flex items-center justify-center text-center px-8">
                                                        <div>
                                                            <p className="text-sm font-semibold text-gray-900">Select an evidence item</p>
                                                            <p className="text-sm text-gray-600 mt-2">
                                                                Click "Open in Document" from an evidence card to jump to the exact source section.
                                                            </p>
                                                        </div>
                                                    </div>
                                                )
                                            ) : isWorksheetPaneGenerating ? (
                                                <div className="relative h-full w-full overflow-hidden flex items-center justify-center">
                                                    <div
                                                        className="absolute inset-0 pointer-events-none"
                                                        style={{
                                                            backgroundColor: "#ffffff",
                                                            backgroundImage: "radial-gradient(rgba(148, 163, 184, 0.16) 1px, transparent 1px)",
                                                            backgroundSize: "18px 18px",
                                                        }}
                                                    />
                                                    <div
                                                        className="absolute inset-0 bg-center bg-cover bg-no-repeat opacity-75 pointer-events-none"
                                                        style={{ backgroundImage: `url(${studySetupBackground})` }}
                                                    />
                                                    <div className="relative z-10 text-center max-w-xl px-6">
                                                        <div className="mx-auto h-[280px] w-[280px]">
                                                            <DotLottieReact
                                                                src="https://lottie.host/d8617406-7b38-4ae4-968d-b934a05d4a10/UKTFUbeuwK.lottie"
                                                                autoplay
                                                                loop
                                                                className="h-full w-full"
                                                            />
                                                        </div>
                                                        <h3 className="mt-2 text-2xl font-bold text-gray-900">Themison is building your worksheet</h3>
                                                        <p className="mt-2 text-sm text-gray-500">
                                                            Reading protocol context, structuring operational blocks, and preparing an editable draft.
                                                        </p>
                                                    </div>
                                                </div>
                                            ) : activeWorksheet ? (
                                                <div className="mx-auto w-full max-w-[940px] py-4 space-y-3">
                                                    <p className="mx-auto w-full max-w-[816px] text-[11px] text-gray-500">
                                                        Press "/" for commands, click "+" for block options, drag the grip to reorder.
                                                    </p>
                                                    {!taskPaneExpanded && (
                                                        <div className="mx-auto w-full max-w-[816px] flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                                                            <div className="flex items-center gap-2 text-xs text-gray-600">
                                                                <span className="font-medium">Style:</span>
                                                                <select
                                                                    value={documentStyle.fontFamily}
                                                                    onChange={(event) =>
                                                                        setDocumentStyle((prev) => ({
                                                                            ...prev,
                                                                            fontFamily: event.target.value as "times" | "calibri" | "arial",
                                                                        }))
                                                                    }
                                                                    className="h-7 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700"
                                                                >
                                                                    <option value="times">Times New Roman</option>
                                                                    <option value="calibri">Calibri</option>
                                                                    <option value="arial">Arial</option>
                                                                </select>
                                                                <select
                                                                    value={documentStyle.bodySize}
                                                                    onChange={(event) =>
                                                                        setDocumentStyle((prev) => ({
                                                                            ...prev,
                                                                            bodySize: event.target.value as "11" | "12" | "14",
                                                                        }))
                                                                    }
                                                                    className="h-7 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700"
                                                                >
                                                                    <option value="11">11 pt</option>
                                                                    <option value="12">12 pt</option>
                                                                    <option value="14">14 pt</option>
                                                                </select>
                                                                <select
                                                                    value={documentStyle.lineSpacing}
                                                                    onChange={(event) =>
                                                                        setDocumentStyle((prev) => ({
                                                                            ...prev,
                                                                            lineSpacing: event.target.value as "1.15" | "1.5",
                                                                        }))
                                                                    }
                                                                    className="h-7 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700"
                                                                >
                                                                    <option value="1.15">Line 1.15</option>
                                                                    <option value="1.5">Line 1.5</option>
                                                                </select>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => setFloatingAIOpen((prev) => !prev)}
                                                                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                                                            >
                                                                <Brain className="h-3.5 w-3.5" />
                                                                Themison Assistant
                                                            </button>
                                                        </div>
                                                    )}
                                                    <div
                                                        className="mx-auto w-full max-w-[816px] min-h-[1056px] border border-[#d6d6d6] bg-white px-[72px] py-[56px] shadow-[0_12px_30px_rgba(15,23,42,0.12)]"
                                                        style={{ fontFamily: documentFontFamily }}
                                                    >
                                                        <div className="space-y-7">
                                                            <div className="border-b border-gray-300 pb-3">
                                                                <div className="grid grid-cols-2 gap-4 text-[13px] leading-5 text-[#111827]">
                                                                    <div className="font-semibold">
                                                                        <p>{worksheetDocumentHeader.sponsor}</p>
                                                                        <p>Protocol number: {worksheetDocumentHeader.protocolNumber}</p>
                                                                    </div>
                                                                    <div className="text-right font-semibold">
                                                                        <p>Protocol Version {worksheetDocumentHeader.protocolVersion}</p>
                                                                        <p>Amendment Version {worksheetDocumentHeader.amendmentVersion}</p>
                                                                    </div>
                                                                </div>
                                                                <div className="mt-2 flex items-center justify-between text-[11px] text-gray-600">
                                                                    <span>
                                                                        Generated {new Date(worksheetDocumentHeader.generatedAt).toLocaleString()}
                                                                    </span>
                                                                    <span>Generated by {worksheetDocumentHeader.generatedBy}</span>
                                                                </div>
                                                            </div>

                                                            <div>
                                                                <input
                                                                    value={activeWorksheet.title}
                                                                    onChange={(event) => updateWorksheetTitle(event.target.value)}
                                                                    className="w-full bg-transparent border-0 p-0 text-[42px] leading-[1.12] font-bold text-[#111827] placeholder:text-gray-400 focus:outline-none"
                                                                    placeholder="Worksheet title"
                                                                />
                                                            </div>

                                                            <div className="space-y-0.5">
                                                                {activeWorksheet.blocks.map((block, blockIndex) => {
                                                                    const showSlashForBlock = slashMenu?.blockId === block.id;
                                                                    const showInsertForBlock = insertMenu?.blockId === block.id;
                                                                    const numberedIndex = activeWorksheet.blocks
                                                                        .slice(0, blockIndex + 1)
                                                                        .filter((entry) => entry.type === "numbered").length;
                                                                    const placeholder =
                                                                        block.type === "heading1"
                                                                            ? "Heading 1"
                                                                            : block.type === "heading2"
                                                                                ? "Heading 2"
                                                                                : block.type === "heading3"
                                                                                    ? "Heading 3"
                                                                                    : block.type === "checklist"
                                                                                        ? "To-do item"
                                                                                        : block.type === "quote"
                                                                                            ? "Quoted protocol text"
                                                                                            : block.type === "callout"
                                                                                                ? "Important callout"
                                                                                                : block.type === "code"
                                                                                                    ? "Code snippet"
                                                                                                    : block.type === "bulleted" || block.type === "numbered"
                                                                                                        ? "List item"
                                                                                                        : "Write something...";
                                                                    const textClass =
                                                                        block.type === "heading1"
                                                                            ? "text-[34px] leading-[1.2] font-bold"
                                                                            : block.type === "heading2"
                                                                                ? "text-[28px] leading-[1.28] font-bold"
                                                                                : block.type === "heading3"
                                                                                    ? "text-[22px] leading-[1.35] font-semibold"
                                                                                    : block.type === "quote"
                                                                                        ? `${documentBodyTextClass} ${documentLineHeightClass} italic`
                                                                                        : block.type === "code"
                                                                                            ? "text-[14px] leading-[1.6] font-mono"
                                                                                            : `${documentBodyTextClass} ${documentLineHeightClass}`;
                                                                    const isDivider = block.type === "divider";
                                                                    const isQuote = block.type === "quote";
                                                                    const isCallout = block.type === "callout";
                                                                    const isCode = block.type === "code";
                                                                    const isSectionHeading =
                                                                        block.type === "heading1" ||
                                                                        block.type === "heading2" ||
                                                                        block.type === "heading3";
                                                                    const previousType = blockIndex > 0 ? activeWorksheet.blocks[blockIndex - 1]?.type : null;
                                                                    const previousWasHeading =
                                                                        previousType === "heading1" ||
                                                                        previousType === "heading2" ||
                                                                        previousType === "heading3";
                                                                    const rowSpacingClass = isSectionHeading
                                                                        ? blockIndex === 0
                                                                            ? "pt-1 pb-2"
                                                                            : "pt-6 pb-2"
                                                                        : previousWasHeading
                                                                            ? "pt-4 pb-1.5"
                                                                            : "py-1.5";
                                                                    const controlOffsetClass = isSectionHeading ? "mt-2" : "mt-1";

                                                                    return (
                                                                        <div
                                                                            key={block.id}
                                                                            onDragOver={(event) => handleWorksheetDragOver(block.id, event)}
                                                                            onDrop={(event) => handleWorksheetDrop(block.id, event)}
                                                                            className={`relative group flex items-start gap-2 px-0.5 ${rowSpacingClass} ${draggingBlockId === block.id
                                                                                ? "opacity-50"
                                                                                : dragOverBlockId === block.id && draggingBlockId
                                                                                    ? "outline outline-1 outline-blue-300 bg-blue-50/50"
                                                                                    : ""
                                                                                }`}
                                                                        >
                                                                            <div className={`${controlOffsetClass} flex h-5 w-8 shrink-0 items-center justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100`}>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => {
                                                                                        setActiveWorksheetBlockId(block.id);
                                                                                        setInsertMenu((prev) =>
                                                                                            prev?.blockId === block.id ? null : { blockId: block.id, query: "" }
                                                                                        );
                                                                                        setSlashMenu(null);
                                                                                    }}
                                                                                    className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                                                                                    aria-label="Open block menu"
                                                                                >
                                                                                    <Plus className="h-3 w-3" />
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    draggable
                                                                                    onDragStart={(event) => handleWorksheetDragStart(block.id, event)}
                                                                                    onDragEnd={handleWorksheetDragEnd}
                                                                                    className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-grab active:cursor-grabbing"
                                                                                    aria-label="Drag block"
                                                                                >
                                                                                    <GripVertical className="h-3 w-3" />
                                                                                </button>
                                                                            </div>
                                                                            {block.type === "checklist" && (
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={Boolean(block.checked)}
                                                                                    onChange={(event) =>
                                                                                        updateWorksheetBlock(block.id, { checked: event.target.checked })
                                                                                    }
                                                                                    onFocus={() => setActiveWorksheetBlockId(block.id)}
                                                                                    className={`${controlOffsetClass} h-4 w-4 rounded border-gray-300 text-blue-600`}
                                                                                />
                                                                            )}
                                                                            {block.type === "bulleted" && (
                                                                                <span className={`${controlOffsetClass} text-base text-gray-500 leading-none`}>•</span>
                                                                            )}
                                                                            {block.type === "numbered" && (
                                                                                <span className={`${controlOffsetClass} min-w-[1.5rem] text-sm text-gray-500 leading-none`}>
                                                                                    {numberedIndex}.
                                                                                </span>
                                                                            )}
                                                                            <div className="flex-1 min-w-0 flex items-start gap-2">
                                                                                {isDivider ? (
                                                                                    <div className="w-full py-3">
                                                                                        <div className="h-px bg-gray-300" />
                                                                                    </div>
                                                                                ) : (
                                                                                    <div
                                                                                        className={`w-full ${isQuote
                                                                                            ? "border-l-2 border-gray-400 pl-3"
                                                                                            : isCallout
                                                                                                ? "rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2"
                                                                                                : isCode
                                                                                                    ? "rounded-md border border-gray-300 bg-[#f7f7f7] px-3 py-2"
                                                                                                    : ""
                                                                                            }`}
                                                                                    >
                                                                                        <Textarea
                                                                                            value={block.content}
                                                                                            onChange={(event) => {
                                                                                                const nextValue = event.target.value;
                                                                                                updateWorksheetBlock(block.id, { content: nextValue });
                                                                                                const trimmed = nextValue.trim();
                                                                                                if (trimmed.startsWith("/")) {
                                                                                                    setSlashMenu({
                                                                                                        blockId: block.id,
                                                                                                        query: trimmed.slice(1),
                                                                                                    });
                                                                                                    setInsertMenu(null);
                                                                                                } else if (showSlashForBlock) {
                                                                                                    setSlashMenu(null);
                                                                                                }
                                                                                            }}
                                                                                            onFocus={() => setActiveWorksheetBlockId(block.id)}
                                                                                            onKeyDown={(event) => {
                                                                                                if (event.key === "Enter" && !event.shiftKey) {
                                                                                                    event.preventDefault();
                                                                                                    insertWorksheetBlockAfter(
                                                                                                        block.id,
                                                                                                        block.type === "checklist" || block.type === "bulleted" || block.type === "numbered"
                                                                                                            ? block.type
                                                                                                            : "text"
                                                                                                    );
                                                                                                    return;
                                                                                                }
                                                                                                if (
                                                                                                    event.key === "Backspace" &&
                                                                                                    event.currentTarget.value.length === 0 &&
                                                                                                    activeWorksheet.blocks.length > 1
                                                                                                ) {
                                                                                                    event.preventDefault();
                                                                                                    removeWorksheetBlock(block.id);
                                                                                                }
                                                                                            }}
                                                                                            placeholder={placeholder}
                                                                                            className={`min-h-[34px] border-0 p-0 shadow-none focus-visible:ring-0 resize-none bg-transparent text-[#111827] ${textClass}`}
                                                                                        />
                                                                                    </div>
                                                                                )}
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => removeWorksheetBlock(block.id)}
                                                                                    disabled={activeWorksheet.blocks.length <= 1}
                                                                                    className={`${controlOffsetClass} rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:text-gray-400 disabled:hover:bg-transparent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`}
                                                                                    aria-label="Delete block"
                                                                                >
                                                                                    <Trash2 className="h-4 w-4" />
                                                                                </button>
                                                                            </div>

                                                                            {showInsertForBlock && (
                                                                                <div className="absolute left-10 top-8 z-30 w-[340px] rounded-xl border border-gray-200 bg-white shadow-lg">
                                                                                    <div className="border-b border-gray-100 p-2">
                                                                                        <input
                                                                                            value={insertMenu?.query || ""}
                                                                                            onChange={(event) =>
                                                                                                setInsertMenu((prev) =>
                                                                                                    prev ? { ...prev, query: event.target.value } : prev
                                                                                                )
                                                                                            }
                                                                                            placeholder="Type to filter..."
                                                                                            className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-gray-300"
                                                                                        />
                                                                                    </div>
                                                                                    <div className="max-h-64 overflow-y-auto py-1">
                                                                                        {insertMenuOptions.length > 0 ? (
                                                                                            (["basic", "advanced", "themison"] as WorksheetCommandGroup[]).map((group) => {
                                                                                                const commandsInGroup = insertMenuOptions.filter(
                                                                                                    (entry) => entry.group === group
                                                                                                );
                                                                                                if (commandsInGroup.length === 0) return null;
                                                                                                return (
                                                                                                    <div key={group}>
                                                                                                        <p className="px-3 py-1 text-[11px] uppercase tracking-wide text-gray-500">
                                                                                                            {worksheetCommandGroupLabel(group)}
                                                                                                        </p>
                                                                                                        {commandsInGroup.map((command) => (
                                                                                                            <button
                                                                                                                key={command.kind === "block" ? command.type : command.action}
                                                                                                                type="button"
                                                                                                                onClick={() => {
                                                                                                                    setInsertMenu(null);
                                                                                                                    if (command.kind === "block") {
                                                                                                                        insertWorksheetBlockAfter(block.id, command.type);
                                                                                                                        return;
                                                                                                                    }
                                                                                                                    void runWorksheetAICommand({
                                                                                                                        action: command.action,
                                                                                                                        targetBlockId: block.id,
                                                                                                                    });
                                                                                                                }}
                                                                                                                className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                                                                                                            >
                                                                                                                <div className="flex items-start gap-2">
                                                                                                                    {command.group === "themison" && (
                                                                                                                        <Brain className="mt-0.5 h-3.5 w-3.5 text-indigo-600" />
                                                                                                                    )}
                                                                                                                    <div>
                                                                                                                        <p className="text-sm font-medium text-gray-900">{command.title}</p>
                                                                                                                        <p className="text-xs text-gray-500 mt-0.5">{command.subtitle}</p>
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                                {command.shortcut && (
                                                                                                                    <span className="text-xs text-gray-400">{command.shortcut}</span>
                                                                                                                )}
                                                                                                            </button>
                                                                                                        ))}
                                                                                                    </div>
                                                                                                );
                                                                                            })
                                                                                        ) : (
                                                                                            <p className="px-3 py-3 text-sm text-gray-500">No matching block type</p>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            )}

                                                                            {showSlashForBlock && (
                                                                                <div className="absolute left-10 top-full z-20 mt-2 w-[340px] rounded-xl border border-gray-200 bg-white shadow-lg">
                                                                                    <div className="border-b border-gray-100 p-2">
                                                                                        <input
                                                                                            value={slashMenu?.query || ""}
                                                                                            onChange={(event) =>
                                                                                                setSlashMenu((prev) =>
                                                                                                    prev ? { ...prev, query: event.target.value } : prev
                                                                                                )
                                                                                            }
                                                                                            placeholder="Type to filter..."
                                                                                            className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-gray-300"
                                                                                        />
                                                                                    </div>
                                                                                    <div className="max-h-60 overflow-y-auto py-1">
                                                                                        {slashCommandOptions.length > 0 ? (
                                                                                            (["basic", "advanced", "themison"] as WorksheetCommandGroup[]).map((group) => {
                                                                                                const commandsInGroup = slashCommandOptions.filter(
                                                                                                    (entry) => entry.group === group
                                                                                                );
                                                                                                if (commandsInGroup.length === 0) return null;
                                                                                                return (
                                                                                                    <div key={group}>
                                                                                                        <p className="px-3 py-1 text-[11px] uppercase tracking-wide text-gray-500">
                                                                                                            {worksheetCommandGroupLabel(group)}
                                                                                                        </p>
                                                                                                        {commandsInGroup.map((command) => (
                                                                                                            <button
                                                                                                                key={command.kind === "block" ? command.type : command.action}
                                                                                                                type="button"
                                                                                                                onClick={() => {
                                                                                                                    if (command.kind === "block") {
                                                                                                                        applySlashCommandToBlock(block.id, command.type);
                                                                                                                        return;
                                                                                                                    }
                                                                                                                    updateWorksheetBlock(block.id, {
                                                                                                                        content: block.content.replace(/^\/\S*/, "").trim(),
                                                                                                                    });
                                                                                                                    setSlashMenu(null);
                                                                                                                    void runWorksheetAICommand({
                                                                                                                        action: command.action,
                                                                                                                        targetBlockId: block.id,
                                                                                                                    });
                                                                                                                }}
                                                                                                                className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                                                                                                            >
                                                                                                                <div className="flex items-start gap-2">
                                                                                                                    {command.group === "themison" && (
                                                                                                                        <Brain className="mt-0.5 h-3.5 w-3.5 text-indigo-600" />
                                                                                                                    )}
                                                                                                                    <div>
                                                                                                                        <p className="text-sm font-medium text-gray-900">{command.title}</p>
                                                                                                                        <p className="text-xs text-gray-500 mt-0.5">{command.subtitle}</p>
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                                {command.shortcut && (
                                                                                                                    <span className="text-xs text-gray-400">{command.shortcut}</span>
                                                                                                                )}
                                                                                                            </button>
                                                                                                        ))}
                                                                                                    </div>
                                                                                                );
                                                                                            })
                                                                                        ) : (
                                                                                            <p className="px-3 py-3 text-sm text-gray-500">No matching block type</p>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>

                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const lastBlockId = activeWorksheet.blocks[activeWorksheet.blocks.length - 1]?.id;
                                                                    if (!lastBlockId) return;
                                                                    insertWorksheetBlockAfter(lastBlockId);
                                                                }}
                                                                className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-2.5 py-1.5 text-[12px] text-gray-700 hover:bg-gray-50"
                                                            >
                                                                <Plus className="h-3.5 w-3.5" />
                                                                Add block
                                                            </button>

                                                            <div className="mt-8 border-t border-gray-300 pt-3">
                                                                <div className="flex items-start justify-between gap-3">
                                                                    {worksheetDocumentFooter.logoDataUrl ? (
                                                                        <img
                                                                            src={worksheetDocumentFooter.logoDataUrl}
                                                                            alt={`${worksheetDocumentFooter.name} logo`}
                                                                            className="h-7 max-w-[96px] object-contain"
                                                                        />
                                                                    ) : (
                                                                        <div className="h-7 w-7 rounded-md bg-blue-600 text-white text-[12px] font-semibold flex items-center justify-center">
                                                                            {worksheetDocumentFooter.initial}
                                                                        </div>
                                                                    )}
                                                                    <div className="text-[11px] leading-[1.5] text-gray-600 text-right">
                                                                        <p className="font-semibold text-gray-800">{worksheetDocumentFooter.name}</p>
                                                                        {worksheetDocumentFooter.address ? (
                                                                            <p>{worksheetDocumentFooter.address}</p>
                                                                        ) : null}
                                                                        {worksheetDocumentFooter.websiteRaw ? (
                                                                            <p>{worksheetDocumentFooter.websiteRaw}</p>
                                                                        ) : null}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {floatingAIOpen && (
                                                        <div
                                                            className="fixed inset-0 z-[1001] bg-black/25 backdrop-blur-[1px] flex items-center justify-center p-4"
                                                            onClick={() => {
                                                                if (floatingAILoading) return;
                                                                setFloatingAIOpen(false);
                                                            }}
                                                        >
                                                            <div
                                                                className="w-full max-w-2xl rounded-xl border border-indigo-200 bg-white shadow-2xl"
                                                                onClick={(event) => event.stopPropagation()}
                                                            >
                                                                <div className="flex items-center justify-between px-4 py-3 border-b border-indigo-100">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
                                                                            <Brain className="h-4 w-4" />
                                                                        </span>
                                                                        <p className="text-sm font-semibold text-indigo-800">Themison Assistant</p>
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setFloatingAIOpen(false)}
                                                                        className="text-gray-400 hover:text-gray-600"
                                                                    >
                                                                        <X className="h-4 w-4" />
                                                                    </button>
                                                                </div>
                                                                <div className="px-4 py-3 space-y-3">
                                                                    <Textarea
                                                                        value={floatingAIPrompt}
                                                                        onChange={(event) => setFloatingAIPrompt(event.target.value)}
                                                                        placeholder='Example: "Write a summary of what this trial is about and the purpose of this template, and put it at the beginning."'
                                                                        className="min-h-[110px] border border-gray-200 bg-white resize-none"
                                                                    />
                                                                    <div className="flex flex-wrap gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                void runWorksheetAICommand({
                                                                                    action: "find_protocol_section",
                                                                                    targetBlockId: getWorksheetInsertionAnchor(),
                                                                                })
                                                                            }
                                                                            disabled={floatingAILoading}
                                                                            className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                                                        >
                                                                            Find protocol section
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                void runWorksheetAICommand({
                                                                                    action: "draft_trial_overview",
                                                                                    targetBlockId: getWorksheetInsertionAnchor(),
                                                                                })
                                                                            }
                                                                            disabled={floatingAILoading}
                                                                            className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                                                        >
                                                                            Draft trial overview
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                void runWorksheetAICommand({
                                                                                    action: "draft_visit_paragraph",
                                                                                    targetBlockId: getWorksheetInsertionAnchor(),
                                                                                })
                                                                            }
                                                                            disabled={floatingAILoading}
                                                                            className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                                                        >
                                                                            Draft visit paragraph
                                                                        </button>
                                                                    </div>
                                                                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                                                                        Themison understands natural language location requests like "at the beginning", "after this section", or "at the end".
                                                                    </div>
                                                                    <div className="flex items-center justify-end gap-2">
                                                                        <Button
                                                                            type="button"
                                                                            variant="outline"
                                                                            onClick={() => {
                                                                                setFloatingAIPrompt("");
                                                                                setFloatingAIOpen(false);
                                                                            }}
                                                                            disabled={floatingAILoading}
                                                                        >
                                                                            Cancel
                                                                        </Button>
                                                                        <Button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                void runWorksheetAICommand({
                                                                                    action: inferWorksheetActionFromPrompt(floatingAIPrompt),
                                                                                    targetBlockId: getWorksheetInsertionAnchor(),
                                                                                    customPrompt: floatingAIPrompt,
                                                                                })
                                                                            }
                                                                            disabled={floatingAILoading || floatingAIPrompt.trim().length === 0}
                                                                        >
                                                                            {floatingAILoading ? "Generating..." : "Insert from prompt"}
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {activeWorksheet.sources.length > 0 && (
                                                        <div className="mx-auto w-full max-w-[816px] rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                                                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                                                                Source Evidence
                                                            </p>
                                                            <div className="space-y-2">
                                                                {activeWorksheet.sources.slice(0, 4).map((source, sourceIndex) => (
                                                                    <button
                                                                        key={`${source.filename}-${sourceIndex}`}
                                                                        type="button"
                                                                        onClick={() =>
                                                                            handleOpenTaskDocument({
                                                                                filename: source.filename,
                                                                                section: source.section,
                                                                                page: source.page || undefined,
                                                                                fileUrl: source.fileUrl,
                                                                                excerpt: source.excerpt,
                                                                                highlightUrl: source.highlightUrl,
                                                                            })
                                                                        }
                                                                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:bg-gray-50"
                                                                    >
                                                                        <p className="text-sm font-medium text-gray-900">
                                                                            {source.category || source.filename}
                                                                        </p>
                                                                        <p className="text-xs text-gray-500 mt-0.5">
                                                                            {source.section ? `Section ${source.section}` : source.filename}
                                                                            {source.page ? ` • Page ${source.page}` : ""}
                                                                        </p>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="h-full flex items-center justify-center text-center px-8">
                                                    <div>
                                                        <p className="text-sm font-semibold text-gray-900">No worksheet selected</p>
                                                        <p className="text-sm text-gray-600 mt-2">
                                                            Generate a worksheet from an AI answer to start editing here.
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {taskPaneMode === "worksheet" && activeWorksheet && !isWorksheetPaneGenerating && (
                                        <div className="border-t border-gray-100 px-6 py-3 flex items-center justify-between text-xs text-gray-500">
                                            <span>
                                                Last updated {new Date(activeWorksheet.updatedAt).toLocaleString()}
                                            </span>
                                            {activeWorksheet.publishedAt ? (
                                                <span className="text-emerald-600">
                                                    Published {new Date(activeWorksheet.publishedAt).toLocaleString()}
                                                </span>
                                            ) : (
                                                <span>Draft</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {taskManagerOverlayOpen ? (
                            <div className="fixed inset-0 z-[70]">
                                {taskManagerOverlayUrl ? (
                                    <iframe
                                        src={taskManagerOverlayUrl}
                                        className="h-full w-full border-0 bg-transparent"
                                        style={{ background: "transparent" }}
                                        title="Task Manager Editor"
                                    />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-black/20 text-sm text-gray-700">
                                        Loading task editor...
                                    </div>
                                )}
                            </div>
                        ) : null}

                        <Dialog open={taskEditorOpen} onOpenChange={(open) => !open && handleCloseTaskEditor()}>
                            <DialogContent className="sm:max-w-[640px] max-h-[86vh] overflow-y-auto">
                                <DialogTitle className="text-lg font-semibold text-gray-900">Edit Task</DialogTitle>
                                {isTaskEditorLoading ? (
                                    <div className="py-6 text-sm text-gray-600">Loading task details...</div>
                                ) : !taskEditorTask ? (
                                    <div className="space-y-3 py-2">
                                        <p className="text-sm text-gray-700">Task details could not be loaded for this source.</p>
                                        <p className="text-xs text-gray-500">
                                            Try asking again so Themison AI returns a fresh task link.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Title</label>
                                            <Input
                                                value={taskEditorForm.title}
                                                onChange={(event) => setTaskEditorForm((prev) => ({ ...prev, title: event.target.value }))}
                                                placeholder="Task title"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Description</label>
                                            <Textarea
                                                value={taskEditorForm.description}
                                                onChange={(event) => setTaskEditorForm((prev) => ({ ...prev, description: event.target.value }))}
                                                placeholder="Task description"
                                                className="min-h-[96px]"
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <div className="space-y-1">
                                                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Due date</label>
                                                <Input
                                                    type="date"
                                                    value={taskEditorForm.dueDate}
                                                    onChange={(event) => setTaskEditorForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Priority</label>
                                                <select
                                                    value={taskEditorForm.priority}
                                                    onChange={(event) => setTaskEditorForm((prev) => ({ ...prev, priority: event.target.value }))}
                                                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
                                                >
                                                    {TASK_EDITOR_PRIORITY_OPTIONS.map((value) => (
                                                        <option key={value} value={value}>
                                                            {value.replace(/_/g, " ")}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</label>
                                                <select
                                                    value={taskEditorForm.status}
                                                    onChange={(event) => setTaskEditorForm((prev) => ({ ...prev, status: event.target.value }))}
                                                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
                                                >
                                                    {TASK_EDITOR_STATUS_OPTIONS.map((value) => (
                                                        <option key={value} value={value}>
                                                            {value.replace(/_/g, " ")}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Assigned role</label>
                                                <select
                                                    value={taskEditorForm.assignedRole}
                                                    onChange={(event) => setTaskEditorForm((prev) => ({ ...prev, assignedRole: event.target.value }))}
                                                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
                                                >
                                                    <option value="">Unassigned</option>
                                                    {TASK_EDITOR_ROLE_OPTIONS.map((value) => (
                                                        <option key={value} value={value}>
                                                            {value.replace(/_/g, " ")}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Assignee name</label>
                                            <Input
                                                value={taskEditorForm.assigneeName}
                                                onChange={(event) => setTaskEditorForm((prev) => ({ ...prev, assigneeName: event.target.value }))}
                                                placeholder="e.g. Kaleb Sanders"
                                            />
                                        </div>
                                    </div>
                                )}
                                <div className="mt-4 flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
                                    <Button variant="outline" onClick={handleCloseTaskEditor} disabled={isTaskEditorSaving}>
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={() => void handleSaveTaskEditor()}
                                        disabled={isTaskEditorSaving || isTaskEditorLoading || !taskEditorTask}
                                    >
                                        {isTaskEditorSaving ? "Saving..." : "Save task"}
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>

                        {/* Right: PDF Viewer Pane - Fixed Position */}
                        {pdfViewerOpen && selectedDocument && !pdfViewerExpanded && !taskPaneOpen && (
                            <div className="absolute top-0 right-0 w-1/2 h-full flex flex-col pt-0 pb-3 pr-6 pl-3">
                                <div className="flex-1 bg-white flex flex-col rounded-xl overflow-hidden">
                                    {/* PDF Viewer Header */}
                                    <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
                                        <div className="flex items-center gap-3">
                                            <FileText className="w-5 h-5 text-gray-600" />
                                            <div>
                                                <h3 className="font-semibold text-gray-900">{selectedDocument.name}</h3>
                                                {selectedDocument.page && (
                                                    <p className="text-xs text-gray-500">Page {selectedDocument.page}</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setPdfViewerExpanded(true)}
                                                className="text-gray-600 hover:text-gray-900"
                                            >
                                                <Maximize2 className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={handleClosePdfViewer}
                                                className="text-gray-600 hover:text-gray-900"
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* PDF Content */}
                                    <div className="flex-1 overflow-hidden bg-gray-100">
                                        <iframe
                                            src={selectedDocument.url}
                                            className="w-full h-full"
                                            title={selectedDocument.name}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Expanded PDF Viewer (Full Screen) */}
                        {pdfViewerOpen && selectedDocument && pdfViewerExpanded && (
                            <div className="fixed inset-0 z-50 bg-white flex flex-col">
                                {/* PDF Viewer Header */}
                                <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
                                    <div className="flex items-center gap-3">
                                        <FileText className="w-5 h-5 text-gray-600" />
                                        <div>
                                            <h3 className="font-semibold text-gray-900">{selectedDocument.name}</h3>
                                            {selectedDocument.page && (
                                                <p className="text-xs text-gray-500">Page {selectedDocument.page}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setPdfViewerExpanded(false)}
                                            className="text-gray-600 hover:text-gray-900"
                                        >
                                            <Minimize2 className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={handleClosePdfViewer}
                                            className="text-gray-600 hover:text-gray-900"
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>

                                {/* PDF Content */}
                                <div className="flex-1 overflow-hidden bg-gray-100">
                                    <iframe
                                        src={selectedDocument.url}
                                        className="w-full h-full"
                                        title={selectedDocument.name}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
