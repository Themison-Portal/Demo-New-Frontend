import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  FlaskConical,
  Globe,
  ListChecks,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  Search,
  Send,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";

interface MessageInputProps {
  placeholder?: string;
  onSend: (content: string) => Promise<void> | void;
  onStructuredSend?: (payload: StructuredMessagePayload) => Promise<void> | void;
  disabled?: boolean;
  variant?: "default" | "messages";
}

type StructuredMessagePayload = {
  content: string;
  contentType: "protocol_snippet" | "task_card";
  embeddedContent: Record<string, unknown>;
};

type ContextOption = {
  id: string;
  label: string;
  defaultSelected?: boolean;
  disabled?: boolean;
  hint?: string;
};

type ContextCategory = {
  id: string;
  label: string;
  options: ContextOption[];
};

const ADD_CONTEXT_CATEGORIES: ContextCategory[] = [
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

const getCategoryIcon = (categoryId: string) => {
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

const buildStructuredContextPayload = (optionId: string): StructuredMessagePayload | null => {
  if (optionId === "doc_protocol_latest") {
    return {
      content: "Here's the relevant section from the protocol:",
      contentType: "protocol_snippet",
      embeddedContent: {
        document_name: "Protocol DN-2024-01",
        section_ref: "Section 5.5.3",
        quoted_text:
          "At Visit 3, the subject must undergo a safety assessment including vital signs, physical examination, and review of adverse events. Blood samples must be collected within 2 hours of the visit start.",
        document_link: "#",
      },
    };
  }

  if (optionId === "tasks_selected" || optionId === "tasks_board_current") {
    return {
      content: "Done! Created a task for you:",
      contentType: "task_card",
      embeddedContent: {
        title: "Update site training on Visit 3 timing",
        assignee_name: "Susan Johnson",
        due_date: "Tomorrow",
        status: "Open",
      },
    };
  }

  return null;
};

export function MessageInput({
  placeholder = "Write a message...",
  onSend,
  onStructuredSend,
  disabled = false,
  variant = "default",
}: MessageInputProps) {
  const [value, setValue] = useState("");
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [activeContextCategoryId, setActiveContextCategoryId] = useState(ADD_CONTEXT_CATEGORIES[0]?.id || "");
  const [selectedContextIds, setSelectedContextIds] = useState<Set<string>>(() => createDefaultSelectedContextIds());
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const showAiHint = useMemo(() => /@themison/i.test(value), [value]);
  const activeContextCategory = useMemo(
    () => ADD_CONTEXT_CATEGORIES.find((category) => category.id === activeContextCategoryId) || ADD_CONTEXT_CATEGORIES[0],
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    if (!next || disabled) return;
    setValue("");
    await onSend(next);
  };

  const toggleContextOption = (option: ContextOption) => {
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

  const handleContextOptionClick = async (option: ContextOption) => {
    if (option.disabled) return;
    const structuredPayload = buildStructuredContextPayload(option.id);
    if (structuredPayload && onStructuredSend) {
      setContextMenuOpen(false);
      try {
        await onStructuredSend(structuredPayload);
      } catch (error) {
        console.error(error);
      }
      return;
    }
    toggleContextOption(option);
  };

  const getContextOptionIcon = (option: ContextOption, isSelected: boolean) => {
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

  if (variant === "messages") {
    return (
      <form onSubmit={submit} className="space-y-1 bg-white px-6 py-4">
        <div className="rounded-[16px] bg-[#f3f4f6] pt-2 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_rgba(15,23,42,0.06)] lg:rounded-[20px]">
          <div className="space-y-3 rounded-[15px] border border-[#eceef2] bg-white px-4 pb-3 pt-3 lg:rounded-[19px]">
            <textarea
              className="min-h-[80px] max-h-48 w-full resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 text-[14px] leading-[1.5] text-gray-700 outline-none placeholder:text-gray-400"
              placeholder={placeholder}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={disabled}
              rows={2}
            />

            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full bg-[#f3f4f6] p-1.5 text-gray-500 transition-colors duration-150 hover:bg-[#e9edf2] hover:text-[#0E0017] focus:outline-none"
                  aria-label="Attach"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <div ref={contextMenuRef} className="relative">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full bg-[#f3f4f6] px-3 py-1.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-[#e9edf2] hover:text-[#0E0017] focus:outline-none"
                    aria-label="Add context"
                    aria-expanded={contextMenuOpen}
                    onClick={() => setContextMenuOpen((open) => !open)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add context
                  </button>

                  {contextMenuOpen ? (
                    <div className="absolute bottom-full left-0 z-40 mb-2 w-[520px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                      <div className="grid grid-cols-[200px_1fr]">
                        <div className="max-h-[320px] overflow-y-auto border-r border-gray-200 bg-gray-50/60 py-2">
                          <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
                            Add context
                          </p>
                          {ADD_CONTEXT_CATEGORIES.map((category) => {
                            const isActive = category.id === activeContextCategoryId;
                            const CategoryIcon = getCategoryIcon(category.id);
                            return (
                              <button
                                key={category.id}
                                type="button"
                                onClick={() => setActiveContextCategoryId(category.id)}
                                className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors ${
                                  isActive ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-100"
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
                                  onClick={() => void handleContextOptionClick(option)}
                                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                                    option.disabled
                                      ? "cursor-not-allowed opacity-60"
                                      : "text-gray-700 hover:bg-gray-50"
                                  }`}
                                >
                                  <span className="shrink-0">{getContextOptionIcon(option, isSelected)}</span>
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
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full bg-[#f3f4f6] px-3 py-1.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-[#e9edf2] hover:text-[#0E0017] focus:outline-none"
                  aria-label="Auto"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Auto
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded-full bg-[#f3f4f6] p-1.5 text-gray-500 transition-colors duration-150 hover:bg-[#e9edf2] hover:text-[#0E0017] focus:outline-none"
                  aria-label="Voice input"
                >
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  type="submit"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors duration-150 focus:outline-none ${
                    value.trim() ? "bg-blue-600 hover:bg-blue-700" : "bg-[#8FAEF6] hover:bg-[#8FAEF6]"
                  } disabled:cursor-not-allowed disabled:opacity-100`}
                  disabled={disabled || !value.trim()}
                  aria-label="Send"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={submit}
      className={
        "space-y-1 border-t border-neutral-300 bg-[#f3f4f6] px-6 py-4"
      }
    >
      <div
      className={
          "rounded-[24px] border border-neutral-300 bg-white p-4"
        }
      >
        <textarea
          className={
            "min-h-[84px] w-full resize-none border-none bg-transparent px-1 py-1 text-base text-neutral-800 outline-none placeholder:text-neutral-400"
          }
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled}
          rows={2}
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={
                "inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50 hover:text-[#0E0017]"
              }
              aria-label="Attach"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={
                "inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50 hover:text-[#0E0017]"
              }
              aria-label="Add"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <button
            type="submit"
            className={
              "inline-flex h-10 w-10 items-center justify-center rounded-full bg-neutral-300 text-white transition hover:bg-neutral-400 disabled:cursor-not-allowed disabled:opacity-50"
            }
            disabled={disabled || !value.trim()}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
      {showAiHint ? (
        <div className="inline-flex items-center gap-1 text-xs text-neutral-500">
          <Brain className="h-3.5 w-3.5" />
          Themison AI will respond with trial context
        </div>
      ) : null}
    </form>
  );
}
