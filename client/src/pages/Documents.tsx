import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Plus,
  FileText,
  Upload,
  Trash2,
  RefreshCw,
  Search,
  ArrowUpDown,
  Filter,
  Eye,
  Archive,
  RotateCcw,
  Brain,
  FolderOpen,
  Lock,
  Users,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useDemoState } from "@/contexts/DemoStateContext";
import { logEvent } from "@/lib/telemetry";
import { useLocation } from "wouter";
import { EditableField } from "@/components/EditableField";

type WorksheetDraftStatus = "draft" | "published";

type WorksheetGeneratedOutput = {
  id: string;
  trialId: string | null;
  dataMode?: string;
  chatSessionId?: string | null;
  title: string;
  status: WorksheetDraftStatus;
  createdAt: string;
  updatedAt: string;
  savedAt?: string | null;
  publishedAt?: string | null;
  generatedBy?: string | null;
};

const WORKSHEET_STORAGE_KEY = "themison-worksheet-drafts:v1";
const WORKSHEET_OPEN_REQUEST_KEY = "themison-open-worksheet-request:v1";

export default function Documents({ trialId = '1' }: { trialId?: string } = {}) {
  const [, navigate] = useLocation();
  const { getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState("Protocol");
  const [isUploading, setIsUploading] = useState(false);
  const [showCustomCategory, setShowCustomCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "archived" | "all">("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"latest" | "oldest" | "name-asc" | "name-desc">("latest");
  const [generatedOutputs, setGeneratedOutputs] = useState<WorksheetGeneratedOutput[]>([]);

  const loadGeneratedOutputs = useCallback(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(WORKSHEET_STORAGE_KEY);
      if (!raw) {
        setGeneratedOutputs([]);
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setGeneratedOutputs([]);
        return;
      }

      const outputs = (parsed as any[])
        .map((entry) => {
          const status: WorksheetDraftStatus =
            entry?.status === "published" ? "published" : "draft";
          return {
          id: String(entry?.id || ""),
          trialId:
            entry?.trialId === null || entry?.trialId === undefined
              ? null
              : String(entry.trialId),
          dataMode: entry?.dataMode ? String(entry.dataMode) : undefined,
          chatSessionId: entry?.chatSessionId ? String(entry.chatSessionId) : null,
          title: String(entry?.title || "Untitled Worksheet"),
          status,
          createdAt: String(entry?.createdAt || ""),
          updatedAt: String(entry?.updatedAt || entry?.createdAt || ""),
          savedAt: entry?.savedAt ? String(entry.savedAt) : null,
          publishedAt: entry?.publishedAt ? String(entry.publishedAt) : null,
          generatedBy: entry?.generatedBy ? String(entry.generatedBy) : null,
          };
        })
        .filter((entry) => entry.id.length > 0)
        .filter((entry) => entry.status === "published" || Boolean(entry.savedAt))
        .filter((entry) => {
          if (!entry.dataMode) return true;
          return entry.dataMode === currentDataMode;
        })
        .filter((entry) => {
          if (!trialId) return true;
          return entry.trialId === String(trialId);
        })
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt || 0).getTime() -
            new Date(a.updatedAt || a.createdAt || 0).getTime()
        );

      setGeneratedOutputs(outputs);
    } catch {
      setGeneratedOutputs([]);
    }
  }, [currentDataMode, trialId]);

  useEffect(() => {
    loadGeneratedOutputs();
  }, [loadGeneratedOutputs]);

  useEffect(() => {
    const refresh = () => loadGeneratedOutputs();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadGeneratedOutputs();
      }
    };

    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadGeneratedOutputs]);

  // Query documents
  const { data: documents, isLoading, refetch } = trpc.documents.list.useQuery({
    trialId: trialId,
    demoMode: currentDataMode,
    pageContext: "document-hub",
  });

  const { data: trial } = trpc.trials.getById.useQuery({
    id: trialId,
    demoMode: currentDataMode,
  });
  const { data: trialContext } = trpc.trials.getContext.useQuery(
    {
      id: trialId,
      demoMode: currentDataMode,
      include: ["documents", "telemetry", "suggestions", "insights"],
      pageContext: "document-hub",
      emitTelemetry: false,
    },
    {
      enabled: Boolean(trialId),
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: trialId ? 5000 : false,
      refetchIntervalInBackground: true,
    }
  );

  // Query categories
  const { data: categories } = trpc.documents.getCategories.useQuery();

  // Upload mutation
  const uploadMutation = trpc.documents.upload.useMutation({
    onSuccess: () => {
      toast.success("Document uploaded successfully");
      setUploadDialogOpen(false);
      setSelectedFile(null);
      refetch();
      logEvent({
        eventType: "feature_used",
        action: "upload_document",
        entityType: "document",
        payload: { trialId, demoMode: currentDataMode },
      });
    },
    onError: (error: any) => {
      toast.error("Failed to upload document", {
        description: error.message,
      });
    },
  });

  // Delete document mutation
  const deleteMutation = trpc.documents.delete.useMutation({
    onSuccess: () => {
      toast.success("Document deleted successfully");
      refetch();
      logEvent({
        eventType: "feature_used",
        action: "delete_document",
        entityType: "document",
        payload: { trialId, demoMode: currentDataMode },
      });
    },
    onError: (error: any) => {
      toast.error("Failed to delete document", {
        description: error.message,
      });
    },
  });

  // Retry processing mutation
  const retryMutation = trpc.documents.retryProcessing.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || "Document processing retried");
      refetch();
      logEvent({
        eventType: "feature_used",
        action: "retry_processing",
        entityType: "document",
        payload: { trialId, demoMode: currentDataMode },
      });
    },
    onError: (error: any) => {
      toast.error("Failed to retry processing", {
        description: error.message,
      });
    },
  });

  // Create category mutation
  const createCategoryMutation = trpc.documents.createCategory.useMutation({
    onSuccess: () => {
      toast.success("Category created successfully");
      logEvent({
        eventType: "feature_used",
        action: "create_category",
        entityType: "document_category",
      });
    },
    onError: (error: any) => {
      toast.error("Failed to create category", {
        description: error.message,
      });
    },
  });

  // Update category mutation
  const updateCategoryMutation = trpc.documents.updateCategory.useMutation({
    onSuccess: () => {
      toast.success("Category updated successfully");
      refetch();
      logEvent({
        eventType: "feature_used",
        action: "update_category",
        entityType: "document_category",
      });
    },
    onError: (error: any) => {
      toast.error("Failed to update category", {
        description: error.message,
      });
    },
  });

  const updateControlMutation = trpc.documents.updateControl.useMutation({
    onSuccess: () => {
      refetch();
      logEvent({
        eventType: "feature_used",
        action: "update_document_control",
        entityType: "document",
        payload: { trialId, demoMode: currentDataMode },
      });
    },
    onError: (error: any) => {
      toast.error("Failed to update document control", {
        description: error.message,
      });
    },
  });

  const archiveMutation = trpc.documents.setArchived.useMutation({
    onSuccess: () => {
      refetch();
      logEvent({
        eventType: "feature_used",
        action: "set_document_archive_state",
        entityType: "document",
        payload: { trialId, demoMode: currentDataMode },
      });
    },
    onError: (error: any) => {
      toast.error("Failed to update archive state", {
        description: error.message,
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }

    setIsUploading(true);

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const base64Data = base64.split(",")[1]; // Remove data:...;base64, prefix

        await uploadMutation.mutateAsync({
          trialId,
          filename: selectedFile.name,
          fileData: base64Data,
          category,
          documentVersion:
            category.toLowerCase() === "protocol" ? trial?.currentVersion || undefined : undefined,
          amendmentVersion:
            category.toLowerCase() === "protocol" ? trial?.amendmentVersion || undefined : undefined,
          releaseDate:
            category.toLowerCase() === "protocol" ? trial?.releaseDate || undefined : undefined,
          markAsCurrent: category.toLowerCase() === "protocol",
          sourceType: "manual",
          demoMode: currentDataMode,
        });
        setIsUploading(false);
      };
      reader.onerror = () => {
        toast.error("Failed to read file");
        setIsUploading(false);
      };
      reader.readAsDataURL(selectedFile);
    } catch (error) {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const protocolDocsSorted = useMemo(() => {
    if (!documents?.length) return [];
    return [...documents]
      .filter((doc: any) => String(doc.category || "").toLowerCase() === "protocol")
      .sort(
        (a: any, b: any) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }, [documents]);

  const protocolVersionById = useMemo(() => {
    const versionMap: Record<number, string> = {};
    protocolDocsSorted.forEach((doc: any, index: number) => {
      versionMap[doc.id] = `v${index + 1}`;
    });
    return versionMap;
  }, [protocolDocsSorted]);

  const currentProtocolId = protocolDocsSorted.length
    ? protocolDocsSorted[protocolDocsSorted.length - 1].id
    : null;
  const hasPersistedCurrentProtocol = protocolDocsSorted.some((doc: any) => Boolean(doc.isCurrent));

  const getAmendmentLabel = (filename: string) => {
    const match = filename.match(/(?:amendment|amd|amnd|rev(?:ision)?)[\s\-_]*([a-z0-9.]+)/i);
    return match?.[1] ? match[1].toUpperCase() : "-";
  };

  const typeOptions = useMemo(() => {
    const base = new Set<string>(["Protocol"]);
    (categories || []).forEach((c) => base.add(c.name));
    return Array.from(base);
  }, [categories]);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredDocuments = useMemo(() => {
    const rows = [...(documents || [])];
    const matchesTab = (doc: any) => {
      const isArchived = Boolean(doc.archivedAt);
      if (activeTab === "all") return true;
      if (activeTab === "archived") return isArchived;
      return !isArchived;
    };

    const matchesType = (cat: string) => {
      if (typeFilter === "all") return true;
      return cat === typeFilter;
    };

    const matchesSearch = (doc: any) => {
      if (!normalizedSearch) return true;
      const haystack = `${doc.filename} ${doc.category} ${doc.uploaderName || ""}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    };

    const filtered = rows.filter((doc) =>
      matchesTab(doc) && matchesType(doc.category) && matchesSearch(doc)
    );

    filtered.sort((a: any, b: any) => {
      if (sortBy === "latest") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortBy === "oldest") {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sortBy === "name-asc") {
        return String(a.filename).localeCompare(String(b.filename));
      }
      return String(b.filename).localeCompare(String(a.filename));
    });

    return filtered;
  }, [documents, activeTab, typeFilter, normalizedSearch, sortBy]);

  const latestProtocol = protocolDocsSorted.length
    ? protocolDocsSorted[protocolDocsSorted.length - 1]
    : null;
  const contextDocuments = trialContext?.documents;
  const contextTelemetry = trialContext?.telemetry;
  const contextSignals = ((trialContext?.suggestions || []) as any[])
    .filter((signal) => signal?.actionTarget !== "document-hub")
    .slice(0, 3);
  const totalDocumentCount = contextDocuments?.total ?? documents?.length ?? 0;
  const indexedDocumentCount =
    contextDocuments?.indexed ??
    (documents ? documents.filter((doc: any) => !!doc.isIndexed).length : 0);
  // "Ask Themison AI" needs at least one INDEXED document to retrieve from; while
  // docs are still processing or failed (or none uploaded), it should be disabled.
  // Use the per-document list status (matches the row "Indexed" badge), not the
  // trial-context aggregate which can be stale.
  const hasIndexedDocument = (documents ?? []).some((doc: any) => !!doc.isIndexed);
  const activeDocumentCount =
    contextDocuments?.active ??
    (documents ? documents.filter((doc: any) => !doc.archivedAt).length : 0);
  const personalGeneratedOutputs = useMemo(
    () => generatedOutputs.filter((output) => output.status !== "published"),
    [generatedOutputs]
  );
  const teamGeneratedOutputs = useMemo(
    () => generatedOutputs.filter((output) => output.status === "published"),
    [generatedOutputs]
  );

  const formatOutputDate = (value?: string | null) => {
    if (!value) return "Unknown";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Unknown";
    return parsed.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const openGeneratedOutput = useCallback(
    (output: WorksheetGeneratedOutput) => {
      const targetTrialId = output.trialId || trialId;

      try {
        window.localStorage.setItem(
          WORKSHEET_OPEN_REQUEST_KEY,
            JSON.stringify({
              worksheetId: output.id,
              trialId: targetTrialId,
              dataMode: currentDataMode,
              chatSessionId: output.chatSessionId || null,
              requestedAt: new Date().toISOString(),
            })
          );
      } catch {
        // Ignore storage errors and continue navigation.
      }

      navigate(`/trial/${targetTrialId}/assistant`);
    },
    [currentDataMode, navigate, trialId]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              Themison Document Hub
            </div>
            <h2 className="text-2xl font-semibold leading-tight text-gray-900">
              {trial?.investigationalProduct || trial?.title || "Trial Documentation"}
            </h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
              <span>
                Protocol Number:{" "}
                <span className="font-medium text-gray-900">
                  {trial?.protocolNumber || "Not set"}
                </span>
              </span>
              <span>
                Documents:{" "}
                <span className="font-medium text-gray-900">{totalDocumentCount}</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => navigate(`/trial/${trialId}/assistant`)}
              disabled={!hasIndexedDocument}
              title={!hasIndexedDocument ? "Upload a document and wait for it to finish indexing before asking Themison AI" : undefined}
            >
              <Brain className="h-4 w-4 mr-2" />
              Ask Themison AI
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!latestProtocol?.fileUrl) {
                  toast.error("No protocol available yet.");
                  return;
                }
                window.open(latestProtocol.fileUrl, "_blank", "noopener,noreferrer");
              }}
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              View Latest Protocol
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">AI Readiness</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            {activeDocumentCount > 0 ? Math.round((indexedDocumentCount / activeDocumentCount) * 100) : 0}%
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {indexedDocumentCount} indexed of {activeDocumentCount} active documents
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">Current Protocol</p>
          <p className="mt-2 text-sm font-semibold text-gray-900">
            {contextDocuments?.currentProtocol?.documentVersion || trial?.currentVersion || "Not set"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Release: {contextDocuments?.currentProtocol?.releaseDate || trial?.releaseDate || "Not set"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">Activity Signals</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{contextTelemetry?.eventsLast7Days ?? 0}</p>
          <p className="mt-1 text-xs text-gray-500">Events in the last 7 days</p>
        </div>
      </div>

      {contextSignals.length > 0 ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Themison AI Signals</p>
          <div className="mt-2 grid gap-2">
            {contextSignals.map((signal: any) => (
              <div key={signal.id} className="flex items-start justify-between gap-4 rounded-md bg-white/80 border border-blue-100 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{signal.title}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{signal.description}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    logEvent({
                      eventType: "ai_signal_clicked",
                      action: "clicked",
                      entityType: "trial",
                      entityId: trialId,
                      payload: { signalId: signal.id, target: signal.actionTarget, demoMode: currentDataMode },
                      aiInvolved: true,
                    });
                    if (signal.actionTarget === "assistant") {
                      navigate(`/trial/${trialId}/assistant`);
                      return;
                    }
                    if (signal.actionTarget === "study-setup-wizard") {
                      navigate(`/trial/${trialId}?tab=study-setup-wizard`);
                      return;
                    }
                    navigate(`/trial/${trialId}`);
                  }}
                >
                  {signal.actionLabel}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">Documents</h1>
            <p className="text-sm text-gray-500">
              {filteredDocuments.length} shown • {documents?.length || 0} total
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Dialog
              open={uploadDialogOpen}
              onOpenChange={(open) => {
                setUploadDialogOpen(open);
                if (open) {
                  logEvent({
                    eventType: "feature_used",
                    action: "open_upload_dialog",
                    entityType: "document",
                    payload: { trialId, demoMode: currentDataMode },
                  });
                }
              }}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Upload Document
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload Document</DialogTitle>
                  <DialogDescription>
                    Upload a protocol or other trial document
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mt-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                      Category
                    </label>
                    {!showCustomCategory ? (
                      <select
                        value={category}
                        onChange={(e) => {
                          if (e.target.value === "__add_new__") {
                            setShowCustomCategory(true);
                            setCustomCategory("");
                          } else {
                            setCategory(e.target.value);
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      >
                        {categories?.map((cat) => (
                          <option key={cat.id} value={cat.name}>
                            {cat.name}
                          </option>
                        ))}
                        <option value="__add_new__">+ Add New Category</option>
                      </select>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customCategory}
                          onChange={(e) => setCustomCategory(e.target.value)}
                          placeholder="Enter category name"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                          autoFocus
                        />
                        <Button
                          variant="outline"
                          onClick={async () => {
                            if (customCategory.trim()) {
                              await createCategoryMutation.mutateAsync({ name: customCategory.trim() });
                              setCategory(customCategory.trim());
                              setShowCustomCategory(false);
                            }
                          }}
                          disabled={!customCategory.trim() || createCategoryMutation.isPending}
                        >
                          Add
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowCustomCategory(false);
                            setCustomCategory("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                      File
                    </label>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="file-upload"
                      />
                      <label
                        htmlFor="file-upload"
                        className="cursor-pointer flex flex-col items-center"
                      >
                        <Upload className="h-8 w-8 text-gray-400 mb-2" />
                        {selectedFile ? (
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {selectedFile.name}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {formatFileSize(selectedFile.size)}
                            </p>
                          </div>
                        ) : (
                          <div>
                            <p className="text-sm text-gray-600">
                              Click to upload or drag and drop
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              PDF, DOC, DOCX up to 50MB
                            </p>
                          </div>
                        )}
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 mt-6">
                    <Button
                      variant="outline"
                      onClick={() => setUploadDialogOpen(false)}
                      disabled={isUploading}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleUpload} disabled={isUploading || !selectedFile}>
                      {isUploading ? "Uploading..." : "Upload"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-5">
              <button
                className={`text-sm pb-2 border-b-2 transition-colors ${
                  activeTab === "active"
                    ? "border-gray-900 text-gray-900 font-medium"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => {
                  setActiveTab("active");
                  logEvent({
                    eventType: "document_tab_changed",
                    action: "active",
                    entityType: "trial",
                    entityId: trialId,
                    payload: { demoMode: currentDataMode },
                  });
                }}
              >
                Active
              </button>
              <button
                className={`text-sm pb-2 border-b-2 transition-colors ${
                  activeTab === "archived"
                    ? "border-gray-900 text-gray-900 font-medium"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => {
                  setActiveTab("archived");
                  logEvent({
                    eventType: "document_tab_changed",
                    action: "archived",
                    entityType: "trial",
                    entityId: trialId,
                    payload: { demoMode: currentDataMode },
                  });
                }}
              >
                Archived
              </button>
              <button
                className={`text-sm pb-2 border-b-2 transition-colors ${
                  activeTab === "all"
                    ? "border-gray-900 text-gray-900 font-medium"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => {
                  setActiveTab("all");
                  logEvent({
                    eventType: "document_tab_changed",
                    action: "all",
                    entityType: "trial",
                    entityId: trialId,
                    payload: { demoMode: currentDataMode },
                  });
                }}
              >
                All Documents
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px]">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search documents..."
                  className="w-full h-9 rounded-md border border-gray-200 pl-9 pr-3 text-sm"
                />
              </div>
              <div className="relative">
                <ArrowUpDown className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={sortBy}
                  onChange={(e) => {
                    const nextSort = e.target.value as "latest" | "oldest" | "name-asc" | "name-desc";
                    setSortBy(nextSort);
                    logEvent({
                      eventType: "document_sort_changed",
                      action: "changed",
                      entityType: "trial",
                      entityId: trialId,
                      payload: { sortBy: nextSort, demoMode: currentDataMode },
                    });
                  }}
                  className="h-9 rounded-md border border-gray-200 pl-9 pr-8 text-sm bg-white"
                >
                  <option value="latest">Latest</option>
                  <option value="oldest">Oldest</option>
                  <option value="name-asc">Name A-Z</option>
                  <option value="name-desc">Name Z-A</option>
                </select>
              </div>
              <div className="relative">
                <Filter className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={typeFilter}
                  onChange={(e) => {
                    const nextFilter = e.target.value;
                    setTypeFilter(nextFilter);
                    logEvent({
                      eventType: "document_type_filter_changed",
                      action: "changed",
                      entityType: "trial",
                      entityId: trialId,
                      payload: { typeFilter: nextFilter, demoMode: currentDataMode },
                    });
                  }}
                  className="h-9 rounded-md border border-gray-200 pl-9 pr-8 text-sm bg-white"
                >
                  <option value="all">All Types</option>
                  {typeOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="w-full">
          <table className="w-full table-auto">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  File Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Uploader
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Document Control
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Uploaded
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    Loading documents...
                  </td>
                </tr>
              ) : filteredDocuments.length > 0 ? (
                filteredDocuments.map((doc: any) => {
                  const isProtocol = String(doc.category || "").toLowerCase() === "protocol";
                  const versionLabel = doc.documentVersion || (isProtocol ? protocolVersionById[doc.id] || "v1" : "v1");
                  const isCurrentProtocol =
                    isProtocol &&
                    (Boolean(doc.isCurrent) || (!hasPersistedCurrentProtocol && currentProtocolId === doc.id));
                  const amendmentLabel = doc.amendmentVersion || (isProtocol ? getAmendmentLabel(doc.filename) : "-");
                  const isArchived = Boolean(doc.archivedAt);
                  const uploaderLabel = doc.uploaderName || (doc.uploadedBy ? `User ${doc.uploadedBy}` : "Unknown");
                  const releaseValue = doc.releaseDate || (isProtocol ? (trial?.releaseDate || "") : "");

                  return (
                    <tr key={doc.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 align-middle">
                        <div className="min-w-0 flex items-center gap-3">
                          <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-900 font-medium truncate">{doc.filename}</span>
                        </div>
                      </td>

                      <td className="px-4 py-4 align-middle">
                        <span className="text-sm text-gray-600 truncate block">{uploaderLabel}</span>
                      </td>

                      <td className="px-4 py-4 align-middle">
                        <select
                          value={doc.category}
                          onChange={(e) => {
                            updateCategoryMutation.mutate({
                              id: doc.id,
                              category: e.target.value,
                            });
                          }}
                          className="w-full min-w-0 max-w-[130px] px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md border border-blue-100 focus:ring-2 focus:ring-blue-500 cursor-pointer truncate overflow-hidden text-ellipsis whitespace-nowrap"
                          disabled={updateCategoryMutation.isPending}
                        >
                          {categories?.map((cat) => (
                            <option key={cat.id} value={cat.name}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="px-4 py-4 align-middle">
                        <div className="space-y-1 text-xs min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-500">Version:</span>
                            <span className="font-semibold text-gray-900">{versionLabel}</span>
                            {isCurrentProtocol && (
                              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-semibold">
                                Current
                              </span>
                            )}
                          </div>
                          <div className="text-gray-500 truncate">
                            <span>Amend:</span> <span className="text-gray-700">{amendmentLabel}</span>
                          </div>
                          <div className="text-gray-500 truncate">
                            <span>Release:</span>{" "}
                            <EditableField
                              value={releaseValue}
                              onSave={async (newValue) => {
                                await updateControlMutation.mutateAsync({
                                  id: doc.id,
                                  releaseDate: newValue,
                                });
                              }}
                              emptyText="Add release date"
                              className="inline-flex"
                              displayClassName="text-gray-700"
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-4 align-middle">
                        <div className="flex items-center gap-2">
                          {doc.isIndexed ? (
                            <span className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded">
                              Indexed
                            </span>
                          ) : doc.indexStatus === "failed" ? (
                            <>
                              <span
                                className="px-2 py-1 bg-red-50 text-red-700 text-xs rounded"
                                title={doc.indexFailureReason || "Indexing failed"}
                              >
                                Failed
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => retryMutation.mutate({ id: doc.id })}
                                disabled={doc.indexStatus !== "failed" || retryMutation.isPending}
                                className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                title={doc.indexFailureReason || "Retry processing"}
                              >
                                <RefreshCw className="h-3 w-3" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <span className="px-2 py-1 bg-yellow-50 text-yellow-700 text-xs rounded">
                                Processing
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => retryMutation.mutate({ id: doc.id })}
                                disabled={doc.indexStatus !== "failed" || retryMutation.isPending}
                                className="h-6 w-6 p-0 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50"
                                title="Retry processing"
                              >
                                <RefreshCw className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-4 align-middle whitespace-nowrap">
                        <span className="text-sm text-gray-600">{formatDate(doc.createdAt)}</span>
                      </td>

                      <td className="px-4 py-4 align-middle">
                        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              logEvent({
                                eventType: "document_viewed",
                                action: "opened",
                                entityType: "protocol",
                                entityId: String(doc.id),
                                payload: { trialId, filename: doc.filename, demoMode: currentDataMode },
                              });
                              window.open(doc.fileUrl, "_blank", "noopener,noreferrer");
                            }}
                            className="h-8 w-8 p-0 text-gray-600 hover:text-gray-700 hover:bg-gray-100"
                            title="Open document"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              archiveMutation.mutate({
                                id: doc.id,
                                archived: !isArchived,
                              });
                            }}
                            className="h-8 w-8 p-0 text-gray-600 hover:text-gray-700 hover:bg-gray-100"
                            title={isArchived ? "Restore document" : "Archive document"}
                          >
                            {isArchived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm(`Delete "${doc.filename}"?`)) {
                                deleteMutation.mutate({ id: doc.id });
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No documents in this view yet</p>
                    <p className="text-gray-400 text-xs mt-1">
                      Upload documents or adjust filters to continue
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-900">Generated Outputs</h2>
          <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-medium">
            {generatedOutputs.length} total
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-gray-200 p-4 bg-slate-50">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Lock className="h-4 w-4 text-gray-500" />
                Personal Outputs
              </h3>
              <span className="text-xs font-medium text-gray-500">
                {personalGeneratedOutputs.length}
              </span>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              Draft source documents created by you. Private by default until shared.
            </p>
            <div className="mt-4 space-y-2">
              {personalGeneratedOutputs.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No personal outputs yet. Save a worksheet draft to see it here.
                </p>
              ) : (
                personalGeneratedOutputs.slice(0, 5).map((output) => (
                  <button
                    key={output.id}
                    type="button"
                    onClick={() => openGeneratedOutput(output)}
                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-left transition-colors hover:bg-blue-50/40 hover:border-blue-200"
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">{output.title}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Updated {formatOutputDate(output.updatedAt)}
                      {output.generatedBy ? ` • ${output.generatedBy}` : ""}
                    </p>
                  </button>
                ))
              )}
              {personalGeneratedOutputs.length > 5 ? (
                <p className="text-xs text-gray-500">
                  +{personalGeneratedOutputs.length - 5} more personal outputs
                </p>
              ) : null}
            </div>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => navigate(`/trial/${trialId}/assistant`)}
              disabled={!hasIndexedDocument}
              title={!hasIndexedDocument ? "Upload a document and wait for it to finish indexing before asking Themison AI" : undefined}
            >
              <Brain className="h-4 w-4 mr-2" />
              Ask Themison AI
            </Button>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 bg-slate-50">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-600" />
                Team Outputs
              </h3>
              <span className="text-xs font-medium text-gray-500">
                {teamGeneratedOutputs.length}
              </span>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              Shared approved artifacts for the site team and audit-ready workflows.
            </p>
            <div className="mt-4 space-y-2">
              {teamGeneratedOutputs.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No team outputs yet. Publish a worksheet to share it with your team.
                </p>
              ) : (
                teamGeneratedOutputs.slice(0, 5).map((output) => (
                  <button
                    key={output.id}
                    type="button"
                    onClick={() => openGeneratedOutput(output)}
                    className="w-full rounded-md border border-blue-100 bg-white px-3 py-2 text-left transition-colors hover:bg-blue-50/40 hover:border-blue-200"
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">{output.title}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Published {formatOutputDate(output.publishedAt || output.updatedAt)}
                      {output.generatedBy ? ` • ${output.generatedBy}` : ""}
                    </p>
                  </button>
                ))
              )}
              {teamGeneratedOutputs.length > 5 ? (
                <p className="text-xs text-gray-500">
                  +{teamGeneratedOutputs.length - 5} more team outputs
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
