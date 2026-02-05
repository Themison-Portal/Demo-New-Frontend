import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { 
  Send, 
  ArrowUp,
  FileText, 
  FileSearch, 
  List, 
  Calendar,
  CheckSquare,
  Bot,
  Paperclip,
  Sparkles,
  Plus,
  ChevronDown,
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
  FlaskConical
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";

interface DocumentAIAssistantProps {
  trialId?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string; // AI's reasoning/thought process
  thoughtsSummary?: string; // UI-friendly summary (no raw chain-of-thought)
  sources?: Array<{ filename: string; section?: string; excerpt?: string; fileId?: string; fileUrl?: string; protocolId?: number; page?: number; category?: string }>;
}

export default function DocumentAIAssistant({ trialId }: DocumentAIAssistantProps) {
  const [, navigate] = useLocation();
  const [message, setMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [showMorePrompts, setShowMorePrompts] = useState(false);
  const [activeTab, setActiveTab] = useState("ai-assistant");
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [pdfViewerExpanded, setPdfViewerExpanded] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<{name: string, url: string, page?: number} | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [taskPaneOpen, setTaskPaneOpen] = useState(false);
  const [taskPaneExpanded, setTaskPaneExpanded] = useState(false);
  const [taskPaneDocument, setTaskPaneDocument] = useState<{ name: string; url: string; section?: string; page?: number } | null>(null);
  // If trialId is provided, we're in trial-specific mode; otherwise, search all trials
  const searchMode = trialId ? 'single' : 'all';
  const selectedTrialId = trialId || 'all';
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  
  useEffect(() => {
    console.log('sourceModalOpen state changed to:', sourceModalOpen);
  }, [sourceModalOpen]);
  const [selectedTrials, setSelectedTrials] = useState<string[]>(trialId ? [trialId] : []);
  const [activeTrials, setActiveTrials] = useState<string[]>(trialId ? [trialId] : []);
  const [selectedDocuments, setSelectedDocuments] = useState<number[]>([]);
  const [isAllDocumentsMode, setIsAllDocumentsMode] = useState(true); // Default to searching all documents
  const [autoScoped, setAutoScoped] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalTrialIds = trialId ? [trialId] : selectedTrials;

  const renderSourceModal = () => (
    <Dialog open={sourceModalOpen} onOpenChange={setSourceModalOpen}>
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
                        onClick={() => {
                          if (selected) {
                            setSelectedTrials(selectedTrials.filter(t => t !== trial.id));
                          } else {
                            setSelectedTrials([...selectedTrials, trial.id]);
                          }
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-left ${
                          selected
                            ? "bg-blue-50 text-blue-700"
                            : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            if (selected) {
                              setSelectedTrials(selectedTrials.filter(t => t !== trial.id));
                            } else {
                              setSelectedTrials([...selectedTrials, trial.id]);
                            }
                          }}
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
                                className={`w-full flex items-start gap-3 px-3 py-3 rounded border-2 transition-all text-left ${
                                  selected
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
                toast.error('Please select at least one document');
                return;
              }
              setIsAllDocumentsMode(false);
              setActiveTrials(modalTrialIds);
              setSourceModalOpen(false);
              toast.success(`Now querying ${selectedDocuments.length} selected document(s)`);
            }}
            disabled={selectedDocuments.length === 0}
          >
            Select
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  const chatMutation = trpc.documentAI.chat.useMutation();
  
  // Query all trials with documents
  const { data: trialsWithDocs } = trpc.documents.getTrialsWithDocuments.useQuery();
  
  // Query documents for all selected trials using a single query
  const { data: sourceDocumentsByTrial = {} } = trpc.documents.listMultipleTrials.useQuery(
    { trialIds: trialId ? [trialId] : selectedTrials },
    { 
      enabled: trialId ? true : selectedTrials.length > 0,
      refetchInterval: 2000, // Refetch every 2 seconds to keep status fresh
      refetchOnMount: 'always' // Always refetch when modal opens
    }
  );

  // Trial info for scoped view
  const { data: scopedTrial } = trpc.trials.getById.useQuery(
    { id: selectedTrialId },
    { enabled: !!trialId && trialId !== 'all' }
  );

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
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isLoading]);

  useEffect(() => {
    if (!trialId) return;
    setIsAllDocumentsMode(false);
    setSelectedTrials([trialId]);
    setActiveTrials([trialId]);
  }, [trialId]);

  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    const userMessage = message.trim();
    setMessage("");
    
    // Add transition delay for smoother UX
    setIsTransitioning(true);
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const newUserMessage: ChatMessage = { role: 'user', content: userMessage };
    setChatHistory(prev => [...prev, newUserMessage]);
    setIsTransitioning(false);
    setIsLoading(true);

    try {
      // Send entire conversation history to maintain context
      // Pass selected documents to query specific documents
      const response = await chatMutation.mutateAsync({
        messages: [...chatHistory, newUserMessage].map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        // If in all documents mode, don't send documentIds (backend will search all)
        // If in filtered mode, send specific documentIds
        ...(!isAllDocumentsMode && selectedDocuments.length > 0 ? { documentIds: selectedDocuments.map(String) } : {})
      });

      const sources = (response as any).sources as Array<any> | undefined;

      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: response.message,
        thinking: response.thinking,
        thoughtsSummary: response.thinking,
        sources,
      }]);
    } catch (error) {
      console.error('Error in chat:', error);
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error while processing your message. Please try again.',
      }]);
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

  const handleOpenDocument = (docName: string, page?: number) => {
    setSelectedDocument({
      name: docName,
      url: 'https://pdfobject.com/pdf/sample.pdf', // Placeholder PDF
      page,
    });
    setPdfViewerOpen(true);
  };

  const handleOpenTaskDocument = (source: { filename: string; section?: string; page?: number; fileUrl?: string }) => {
    const baseUrl = source.fileUrl || 'https://pdfobject.com/pdf/sample.pdf';
    const urlWithPage = source.page ? `${baseUrl}#page=${source.page}` : baseUrl;
    setTaskPaneDocument({
      name: source.filename,
      section: source.section,
      page: source.page,
      url: urlWithPage,
    });
    setTaskPaneExpanded(false);
    setTaskPaneOpen(true);
  };

  const handleClosePdfViewer = () => {
    setPdfViewerOpen(false);
    setPdfViewerExpanded(false);
    setSelectedDocument(null);
  };

  const suggestedPrompts = [
    { icon: FileText, text: "What happens at Visit 3?", color: "text-gray-500" },
    { icon: FileSearch, text: "Summarize inclusion criteria", color: "text-gray-500" },
    { icon: Calendar, text: "What are the visit windows?", color: "text-gray-500" },
    { icon: CheckSquare, text: "Generate Visit 1 checklist", color: "text-gray-500" },
  ];

  const renderTopNav = () => (
    <div className="bg-[#F9FAFB] px-8 pt-3 pb-1">
      <div className="bg-white rounded-lg border border-gray-200 px-6 py-2 flex items-center gap-6">
        <button
          onClick={() => navigate('/trial-workspace')}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors pr-6 border-r border-gray-200"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>All Trials</span>
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("ai-assistant")}
            className={`flex items-center gap-2 px-3 py-1 text-xs transition-colors rounded ${
              activeTab === "ai-assistant"
                ? "text-blue-600 bg-[#F3F4F6]"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>AI Assistant</span>
          </button>
          <button
            onClick={() => setActiveTab("response-archive")}
            className={`flex items-center gap-2 px-3 py-1 text-xs transition-colors rounded ${
              activeTab === "response-archive"
                ? "text-blue-600 bg-[#F3F4F6]"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Archive className="w-4 h-4" />
            <span>Response Archive</span>
          </button>
        </div>
        <div className="ml-auto flex items-center gap-3" />
      </div>
    </div>
  );

  // Main Layout
  return (
      <>
        {/* Source Modal */}
      {renderSourceModal()}
    <div className="flex flex-col h-full overflow-hidden">
      {/* Fixed Top Nav */}
      <div className="flex-shrink-0">
        {renderTopNav()}
      </div>
      
      {/* Split Pane Container - fills remaining height */}
      <div className="flex-1 flex overflow-hidden relative transition-opacity duration-500 ease-in-out" style={{opacity: isTransitioning ? 0 : 1}}>
        {/* Left: Chat Area */}
        <div
          className={`flex flex-col transition-all duration-300 ${
            taskPaneOpen
              ? "w-[45%]"
              : pdfViewerOpen && !pdfViewerExpanded
                ? "w-1/2"
                : "w-full"
          }`}
          style={{ display: taskPaneExpanded ? "none" : undefined }}
        >
          {/* Chat Messages Area */}
          <div className="flex-1 overflow-y-auto py-8 relative">
            <div className="absolute right-6 top-2 z-10">
              <button
                type="button"
                onClick={() => setTaskPaneOpen(true)}
                className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                <CheckSquare className="h-4 w-4" />
                Task Pane
              </button>
            </div>
            <div className="max-w-5xl mx-auto px-6 space-y-8 relative">
              {chatHistory.length === 0 ? (
                <div className="flex flex-col items-center text-center space-y-10 pt-6">
                  <div className="space-y-2">
                    <h1 className="text-3xl font-semibold text-gray-900">Themison AI</h1>
                    <p className="text-gray-600">
                      Ask questions about your trial documents and generate operational outputs
                    </p>
                    {trialId && scopedTrial && (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                        Scoped to: {scopedTrial.title}
                      </div>
                    )}
                  </div>

                  <div className="w-full space-y-4">
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <FileSearch className="w-4 h-4" />
                      <span>Searching: <span className="font-medium text-gray-900">All Documents</span></span>
                    </div>
                    <div className="bg-white rounded-2xl px-4 pt-6 pb-3 space-y-4" style={{borderWidth: '1.5px', borderColor: '#f2f2f2', borderStyle: 'solid'}}>
                      <Textarea
                        ref={textareaRef}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask about your protocol, amendments, or trial documents..."
                        className="min-h-[80px] max-h-48 overflow-y-auto border-0 resize-none focus-visible:ring-0 focus-visible:border-0 shadow-none text-gray-700 placeholder:text-gray-400"
                      />
                      <div className="flex items-center mt-3 justify-between">
                        <div className="flex items-center gap-2">
                          <button className="text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-300 rounded-full p-1.5">
                            <Paperclip className="w-4 h-4" />
                          </button>
                          <button className="flex items-center gap-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-300 rounded-full px-3 py-1.5 transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                            Add context
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="flex items-center gap-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-300 rounded-full px-3 py-1.5 transition-colors">
                            <Sparkles className="w-3.5 h-3.5" />
                            Auto
                          </button>
                          <button className="text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-300 rounded-full p-1.5">
                            <Mic className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={handleSend}
                            className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            disabled={isLoading || !message.trim()}
                          >
                            <ArrowUp className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="relative group">
                        <button className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-full hover:bg-gray-200 transition-colors">
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
                          onClick={() => setSourceModalOpen(true)}
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
                          onClick={() => handlePromptClick(prompt.text)}
                          className="bg-white rounded-lg p-4 text-left hover:scale-[1.02] transition-all group"
                          style={{borderWidth: '1.5px', borderColor: '#f2f2f2', borderStyle: 'solid'}}
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
                        className={`flex items-center gap-2 h-8 ${
                          msg.role === "user" ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            msg.role === "user" ? "bg-blue-100" : "bg-gray-100"
                          }`}
                        >
                          {msg.role === "user" ? (
                            <User className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Bot className="w-5 h-5 text-gray-600" />
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
                                  <span className="font-medium">Thoughts</span>
                                </div>
                                <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" />
                              </summary>
                              <div className="rounded-b-lg border border-t-0 border-gray-200 px-4 py-3 text-sm text-gray-600 bg-white/60 whitespace-pre-wrap">
                                {msg.thoughtsSummary || msg.thinking || "Thought summaries will appear here."}
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
                            className={`break-words ${
                              msg.role === "assistant" ? "w-full" : "max-w-2xl w-fit"
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
                                  a: ({ children, href }) => (
                                    <a
                                      href={href}
                                      className="text-blue-600 hover:text-blue-700 underline"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {children}
                                    </a>
                                  ),
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

                    {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                          <div className="mt-8 space-y-3 max-w-4xl mx-auto pt-4 border-t border-gray-200">
                            <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                              Evidence from study documents (click to open)
                            </p>
                            {msg.sources.map((source, sourceIndex) => {
                              return (
                                <div
                                  key={sourceIndex}
                                  className="bg-white/70 border border-gray-100 rounded-xl p-3 space-y-2"
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-3">
                                      <FileText className="w-5 h-5 text-blue-600 mt-0.5" />
                                      <div>
                                        <p className="text-sm font-semibold text-gray-900">
                                          {source.category || "Document"}
                                        </p>
                                        <p className="text-[11px] text-gray-500 mt-0.5">
                                          {source.section ? `Section "${source.section}"` : "Section not available"}
                                          {" · "}
                                          {source.page ? `Page ${source.page}` : "Page not available"}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                  <p className="text-xs text-gray-600 italic ml-8 mt-2">
                                    {source.excerpt
                                      ? source.excerpt.replace(/【[^】]+】/g, "").trim() || "Excerpt not available."
                                      : "Excerpt not available."}
                                  </p>
                                  <button
                                    onClick={() => handleOpenTaskDocument(source)}
                                    className="inline-flex items-center gap-2 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg mt-2"
                                  >
                                    Open in {source.category || "Document"}
                                    <ExternalLink className="w-4 h-4" />
                                  </button>
                                </div>
                              );
                            })}
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
                                  className="p-1.5 rounded hover:bg-gray-200 hover:text-gray-700"
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
                        <Bot className="w-5 h-5 text-gray-600" />
                      </div>
                      <div className="flex-1 space-y-3">
                        <div className="flex items-center h-8">
                          <span className="text-sm font-medium text-gray-900">Themison AI</span>
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
              {/* Active Documents Indicator */}
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-1 text-xs text-gray-600 min-w-0 flex-1 overflow-hidden">
                  <FileSearch className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-shrink-0">Searching:</span>
                  {isAllDocumentsMode ? (
                    <span className="font-medium text-gray-900 flex-shrink-0">All Documents</span>
                  ) : (
                    <span className="font-medium text-gray-900 truncate">{selectedDocuments.length} selected document(s) from {activeTrials.length} trial(s)</span>
                  )}
                </div>
                {!isAllDocumentsMode && (
                  <button
                    onClick={() => {
                      setIsAllDocumentsMode(true);
                      setSelectedDocuments([]);
                      setSelectedTrials([]);
                      setActiveTrials([]);
                      toast.success('Now searching all documents');
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 hover:underline flex-shrink-0 whitespace-nowrap"
                  >
                    Clear filter
                  </button>
                )}
              </div>
              {/* Input Box */}
              <div className="bg-white rounded-2xl px-4 pt-3 pb-3 space-y-3" style={{borderWidth: '1.5px', borderColor: '#f2f2f2', borderStyle: 'solid'}}>
                <Textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a follow-up question..."
                  className="min-h-[80px] max-h-48 overflow-y-auto border-0 resize-none focus-visible:ring-0 focus-visible:border-0 shadow-none text-gray-700 placeholder:text-gray-400"
                />
                
                <div className="flex items-center mt-3 justify-between">
                  <div className="flex items-center gap-2">
                    <button className="text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full p-1.5">
                      <Paperclip className="w-4 h-4" />
                    </button>
                    <button className="flex items-center gap-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 transition-colors">
                      <Plus className="w-3.5 h-3.5" />
                      Add context
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="flex items-center gap-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 transition-colors">
                      <Sparkles className="w-3.5 h-3.5" />
                      Auto
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button className="text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full p-1.5">
                      <Mic className="w-4 h-4" />
                    </button>
                    <Button
                      onClick={handleSend}
                      disabled={!message.trim() || isLoading}
                      size="icon"
                      variant="ghost"
                      className="rounded-full text-white bg-blue-600 hover:bg-blue-700"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </Button>
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
            className={`${taskPaneExpanded ? "fixed inset-0 z-[999] bg-white" : "w-[55%] pl-4 pr-6 pb-4 pt-2"} transition-all duration-500 ease-out`}
          >
            <div
              className={`${taskPaneExpanded ? "h-full rounded-none" : "h-full rounded-2xl"} bg-white border border-gray-200 flex flex-col`}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Task Pane</p>
                  <p className="text-xs text-gray-500">AI-generated follow-ups</p>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setTaskPaneExpanded(prev => !prev)}
                    className="text-gray-400 hover:text-gray-600"
                    aria-label={taskPaneExpanded ? "Exit fullscreen" : "Expand pane"}
                  >
                    {taskPaneExpanded ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </button>
                  <div className="h-4 w-px bg-gray-200" />
                  <button
                    type="button"
                    onClick={() => {
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
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                {taskPaneDocument && (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{taskPaneDocument.name}</p>
                        {taskPaneDocument.section && (
                          <p className="text-xs text-gray-500">Section: {taskPaneDocument.section}</p>
                        )}
                      </div>
                      {taskPaneDocument.page && (
                        <span className="text-xs text-gray-500">Page {taskPaneDocument.page}</span>
                      )}
                    </div>
                    <div className="h-64 bg-white">
                      <iframe
                        src={taskPaneDocument.url}
                        className="w-full h-full"
                        title={taskPaneDocument.name}
                      />
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">Task completed</p>
                    <span className="text-xs text-emerald-600">✔ Done</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    Generated exclusion criteria summary.
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Suggested follow-ups
                  </p>
                  <div className="space-y-2">
                    {[
                      "Generate a visit checklist for Visit 5",
                      "Summarize key safety monitoring steps",
                      "Draft patient eligibility notes for the team",
                    ].map((item, idx) => (
                      <button
                        key={idx}
                        className="w-full text-left px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 text-sm text-gray-700"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Task List
                  </p>
                  <div className="space-y-2">
                    {[
                      "Review protocol section 6.2",
                      "Confirm visit window ranges",
                      "Send summary to sponsor",
                    ].map((item, idx) => (
                      <label key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600" />
                        {item}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="border-t border-gray-100 px-6 py-4 flex items-center gap-2">
                <Button variant="outline" className="flex-1">
                  Save
                </Button>
                <Button className="flex-1">Create Task</Button>
              </div>
            </div>
          </div>
        )}

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
    </div>
    </>
  );
}
