export type ChatDataMode = "sample" | "full" | "building";

export interface ChatSessionSource {
  filename: string;
  section?: string;
  excerpt?: string;
  fileId?: string;
  fileUrl?: string;
  protocolId?: number;
  page?: number;
  category?: string;
  bboxes?: number[][];
  highlightUrl?: string;
}

export interface ChatSessionMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  thoughtsSummary?: string;
  sources?: ChatSessionSource[];
}

export interface ChatSessionRecord {
  id: string;
  trialId: string | null;
  dataMode: ChatDataMode;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatSessionMessage[];
}

interface ActiveChatSessionMap {
  [scopeKey: string]: string;
}

const CHAT_SESSIONS_STORAGE_KEY = "themison-chat-sessions:v1";
const ACTIVE_CHAT_SESSION_STORAGE_KEY = "themison-active-chat:v1";
const MAX_CHAT_SESSIONS = 250;

export const CHAT_SESSIONS_UPDATED_EVENT = "themison-chat-sessions-updated";
export const CHAT_ACTIVE_UPDATED_EVENT = "themison-chat-active-updated";
export const CHAT_NEW_REQUESTED_EVENT = "themison-chat-new-requested";
export const CHAT_OPEN_REQUESTED_EVENT = "themison-chat-open-requested";

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const asIso = (value: unknown): string => {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
};

const normalizeSource = (value: unknown): ChatSessionSource | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const filename = String(source.filename || "").trim();
  if (!filename) return null;
  return {
    filename,
    section: source.section ? String(source.section) : undefined,
    excerpt: source.excerpt ? String(source.excerpt) : undefined,
    fileId: source.fileId ? String(source.fileId) : undefined,
    fileUrl: source.fileUrl ? String(source.fileUrl) : undefined,
    protocolId: typeof source.protocolId === "number" ? source.protocolId : undefined,
    page: typeof source.page === "number" ? source.page : undefined,
    category: source.category ? String(source.category) : undefined,
    bboxes: Array.isArray(source.bboxes) ? (source.bboxes as number[][]) : undefined,
    highlightUrl: source.highlightUrl ? String(source.highlightUrl) : undefined,
  };
};

const normalizeMessage = (value: unknown): ChatSessionMessage | null => {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : null;
  const content = String(message.content || "").trim();
  if (!role || !content) return null;
  const rawSources = Array.isArray(message.sources) ? message.sources : [];
  return {
    role,
    content,
    thinking: typeof message.thinking === "string" ? message.thinking : undefined,
    thoughtsSummary: typeof message.thoughtsSummary === "string" ? message.thoughtsSummary : undefined,
    sources: rawSources.map(normalizeSource).filter(Boolean) as ChatSessionSource[],
  };
};

const normalizeSession = (value: unknown): ChatSessionRecord | null => {
  if (!value || typeof value !== "object") return null;
  const session = value as Record<string, unknown>;
  const id = String(session.id || "").trim();
  const dataModeValue = String(session.dataMode || "").trim() as ChatDataMode;
  if (!id || !["sample", "full", "building"].includes(dataModeValue)) return null;
  const rawMessages = Array.isArray(session.messages) ? session.messages : [];
  const messages = rawMessages.map(normalizeMessage).filter(Boolean) as ChatSessionMessage[];
  if (messages.length === 0) return null;
  const fallbackTitle = getSessionTitleFromMessages(messages, "New chat");
  return {
    id,
    trialId: session.trialId == null ? null : String(session.trialId),
    dataMode: dataModeValue,
    title: String(session.title || fallbackTitle),
    createdAt: asIso(session.createdAt),
    updatedAt: asIso(session.updatedAt),
    messages,
  };
};

const readSessions = (): ChatSessionRecord[] => {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeSession)
      .filter(Boolean)
      .sort((a, b) => +new Date(b!.updatedAt) - +new Date(a!.updatedAt)) as ChatSessionRecord[];
  } catch {
    return [];
  }
};

const writeSessions = (sessions: ChatSessionRecord[]) => {
  if (!isBrowser()) return;
  const sorted = [...sessions]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, MAX_CHAT_SESSIONS);
  window.localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sorted));
  window.dispatchEvent(new CustomEvent(CHAT_SESSIONS_UPDATED_EVENT));
};

const getScopeKey = (trialId: string | null, dataMode: ChatDataMode) => `${dataMode}:${trialId || "no-trial"}`;

const parseScopeKey = (scopeKey: string): { dataMode: ChatDataMode | null; trialId: string | null } => {
  const delimiter = scopeKey.indexOf(":");
  const dataModeToken = delimiter >= 0 ? scopeKey.slice(0, delimiter) : scopeKey;
  const trialToken = delimiter >= 0 ? scopeKey.slice(delimiter + 1) : "no-trial";
  const dataMode = ["sample", "full", "building"].includes(dataModeToken)
    ? (dataModeToken as ChatDataMode)
    : null;
  return {
    dataMode,
    trialId: trialToken === "no-trial" ? null : trialToken,
  };
};

const readActiveMap = (): ActiveChatSessionMap => {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(ACTIVE_CHAT_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ActiveChatSessionMap) : {};
  } catch {
    return {};
  }
};

const writeActiveMap = (next: ActiveChatSessionMap) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(ACTIVE_CHAT_SESSION_STORAGE_KEY, JSON.stringify(next));
};

export const createChatSessionId = () =>
  `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const getSessionTitleFromMessages = (
  messages: Array<Pick<ChatSessionMessage, "role" | "content">>,
  fallback = "New chat"
) => {
  const firstUser = messages.find((message) => message.role === "user")?.content?.trim();
  const source = firstUser || fallback;
  return source.length > 88 ? `${source.slice(0, 85)}...` : source;
};

export const listChatSessions = ({
  trialId,
  dataMode,
  limit,
}: {
  trialId: string | null;
  dataMode: ChatDataMode;
  limit?: number;
}) => {
  const rows = readSessions().filter(
    (session) => session.dataMode === dataMode && (session.trialId || null) === (trialId || null)
  );
  return typeof limit === "number" ? rows.slice(0, limit) : rows;
};

export const getChatSessionById = (id: string) => readSessions().find((session) => session.id === id) || null;

export const upsertChatSession = (input: {
  id: string;
  trialId: string | null;
  dataMode: ChatDataMode;
  messages: ChatSessionMessage[];
  title?: string;
}) => {
  const nowIso = new Date().toISOString();
  const sessions = readSessions();
  const index = sessions.findIndex((session) => session.id === input.id);
  const existing = index >= 0 ? sessions[index] : null;
  const nextSession: ChatSessionRecord = {
    id: input.id,
    trialId: input.trialId,
    dataMode: input.dataMode,
    title: String(input.title || existing?.title || getSessionTitleFromMessages(input.messages, "New chat")),
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    messages: input.messages,
  };

  if (index >= 0) {
    sessions[index] = nextSession;
  } else {
    sessions.push(nextSession);
  }

  writeSessions(sessions);
  return nextSession;
};

export const getActiveChatSessionId = ({
  trialId,
  dataMode,
}: {
  trialId: string | null;
  dataMode: ChatDataMode;
}) => {
  const map = readActiveMap();
  return map[getScopeKey(trialId, dataMode)] || null;
};

export const setActiveChatSessionId = ({
  trialId,
  dataMode,
  sessionId,
}: {
  trialId: string | null;
  dataMode: ChatDataMode;
  sessionId: string;
}) => {
  if (!sessionId || !isBrowser()) return;
  const scopeKey = getScopeKey(trialId, dataMode);
  const currentMap = readActiveMap();
  if (currentMap[scopeKey] === sessionId) return;
  const nextMap = { ...currentMap, [scopeKey]: sessionId };
  writeActiveMap(nextMap);
  window.dispatchEvent(
    new CustomEvent(CHAT_ACTIVE_UPDATED_EVENT, {
      detail: { trialId, dataMode, sessionId },
    })
  );
};

export const clearActiveChatSessionId = ({
  trialId,
  dataMode,
}: {
  trialId: string | null;
  dataMode: ChatDataMode;
}) => {
  if (!isBrowser()) return;
  const scopeKey = getScopeKey(trialId, dataMode);
  const currentMap = readActiveMap();
  if (!(scopeKey in currentMap)) return;
  const nextMap = { ...currentMap };
  delete nextMap[scopeKey];
  writeActiveMap(nextMap);
  window.dispatchEvent(
    new CustomEvent(CHAT_ACTIVE_UPDATED_EVENT, {
      detail: { trialId, dataMode, sessionId: null },
    })
  );
};

export const requestNewChatSession = ({
  trialId,
  dataMode,
}: {
  trialId: string | null;
  dataMode: ChatDataMode;
}) => {
  clearActiveChatSessionId({ trialId, dataMode });
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent(CHAT_NEW_REQUESTED_EVENT, {
      detail: { trialId, dataMode },
    })
  );
};

export const requestOpenChatSession = ({
  trialId,
  dataMode,
  sessionId,
}: {
  trialId: string | null;
  dataMode: ChatDataMode;
  sessionId: string;
}) => {
  if (!sessionId) return;
  setActiveChatSessionId({ trialId, dataMode, sessionId });
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent(CHAT_OPEN_REQUESTED_EVENT, {
      detail: { trialId, dataMode, sessionId },
    })
  );
};

export const deleteChatSession = ({ sessionId }: { sessionId: string }) => {
  if (!sessionId || !isBrowser()) return false;

  const sessions = readSessions();
  const nextSessions = sessions.filter((session) => session.id !== sessionId);
  if (nextSessions.length === sessions.length) return false;
  writeSessions(nextSessions);

  const activeMap = readActiveMap();
  let mapUpdated = false;
  for (const [scopeKey, activeSessionId] of Object.entries(activeMap)) {
    if (activeSessionId !== sessionId) continue;
    delete activeMap[scopeKey];
    mapUpdated = true;

    const { dataMode, trialId } = parseScopeKey(scopeKey);
    if (!dataMode) continue;
    window.dispatchEvent(
      new CustomEvent(CHAT_ACTIVE_UPDATED_EVENT, {
        detail: { trialId, dataMode, sessionId: null },
      })
    );
  }

  if (mapUpdated) {
    writeActiveMap(activeMap);
  }

  return true;
};

export const clearChatSessionsByMode = ({ dataMode }: { dataMode: ChatDataMode }) => {
  if (!isBrowser()) return 0;

  const sessions = readSessions();
  const nextSessions = sessions.filter((session) => session.dataMode !== dataMode);
  const removedCount = sessions.length - nextSessions.length;
  if (removedCount > 0) {
    writeSessions(nextSessions);
  }

  const activeMap = readActiveMap();
  let mapUpdated = false;
  for (const [scopeKey] of Object.entries(activeMap)) {
    const parsed = parseScopeKey(scopeKey);
    if (parsed.dataMode !== dataMode) continue;
    delete activeMap[scopeKey];
    mapUpdated = true;
    window.dispatchEvent(
      new CustomEvent(CHAT_ACTIVE_UPDATED_EVENT, {
        detail: { trialId: parsed.trialId, dataMode, sessionId: null },
      })
    );
  }
  if (mapUpdated) {
    writeActiveMap(activeMap);
  }

  return removedCount;
};

export const formatRelativeChatTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < hour) {
    const minutes = Math.max(1, Math.round(diffMs / minute));
    return `${minutes}m ago`;
  }
  if (diffMs < day) {
    const hours = Math.max(1, Math.round(diffMs / hour));
    return `${hours}h ago`;
  }
  if (diffMs < 2 * day) return "Yesterday";
  if (diffMs < 7 * day) {
    const days = Math.max(2, Math.round(diffMs / day));
    return `${days} days ago`;
  }
  return date.toLocaleDateString();
};
