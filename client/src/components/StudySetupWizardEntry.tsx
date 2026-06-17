import { useEffect, useMemo, useRef, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Button } from "@/components/ui/button";
import { Check, ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useDemoState } from "@/contexts/DemoStateContext";
import studySetupBackground from "@/assets/study-setup-background.svg";

interface StudySetupWizardEntryProps {
  trialId: string;
  onGenerate: () => void;
  onSeePlan: () => void;
  onCancelGenerate: () => void;
  generationReady: boolean;
  isGenerating: boolean;
}

type Step = 1 | 2 | 3;

type DocTypeConfig = {
  name: string;
  description: string;
  required: boolean;
  aliases?: string[];
  filenameHints?: string[];
};

const DOCUMENT_TYPES: DocTypeConfig[] = [
  {
    name: "Protocol",
    description: "Core task scaffold and visit structure",
    required: true,
    filenameHints: ["protocol"],
  },
  {
    name: "Lab Manual",
    description: "Lab prep tasks and sample handling",
    required: false,
    filenameHints: ["lab manual"],
  },
  {
    name: "Pharmacy Manual",
    description: "Drug handling and storage workflows",
    required: false,
    filenameHints: ["pharmacy manual"],
  },
  {
    name: "Schedule of Assessments (SoA)",
    description: "Detailed per-visit assessments",
    required: false,
    aliases: ["Schedule of Assessments", "SOA"],
    filenameHints: ["schedule of assessments", "soa"],
  },
  {
    name: "Informed Consent Form (ICF)",
    description: "Consent and re-consent requirements",
    required: false,
    aliases: ["Informed Consent Form", "ICF"],
    filenameHints: ["informed consent", "icf"],
  },
  {
    name: "EDC/CRF Completion Guide",
    description: "Data entry and query handling guidance",
    required: false,
    aliases: ["EDC CRF Completion Guide", "EDC Guide", "CRF Guide"],
    filenameHints: ["edc", "crf"],
  },
  {
    name: "Safety Reporting Manual",
    description: "Safety escalation and reporting rules",
    required: false,
    aliases: ["Safety Manual"],
    filenameHints: ["safety reporting", "safety manual"],
  },
  {
    name: "Monitoring Plan",
    description: "Monitoring cadence and prep checklist",
    required: false,
    filenameHints: ["monitoring plan"],
  },
];

const STEPS = [
  { number: 1 as const, title: "Upload Documents", subtitle: "Themison AI will extract trial details as soon as your documents are uploaded." },
  { number: 2 as const, title: "Review Coverage", subtitle: "Validate document coverage before generating your plan." },
  { number: 3 as const, title: "Generate Plan", subtitle: "Create the execution plan and open it for review." },
];

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      const base64 = value.split(",")[1];
      if (!base64) {
        reject(new Error("Failed to encode file"));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function StudySetupWizardEntry({
  trialId,
  onGenerate,
  onSeePlan,
  onCancelGenerate,
  generationReady,
  isGenerating,
}: StudySetupWizardEntryProps) {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [uploading, setUploading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("Protocol");
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [isFullscreenVisible, setIsFullscreenVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();

  const { data: documents, refetch: refetchDocuments } = trpc.documents.list.useQuery({
    trialId,
    demoMode: currentDataMode,
  });

  const normalize = (value: string | null | undefined) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const findDocByCategory = (
    uploadedDocs: any[],
    category: string,
    aliases: string[] = [],
    filenameHints: string[] = []
  ) => {
    const expected = [category, ...aliases].map((item) => normalize(item));
    const hints = [category, ...aliases, ...filenameHints].map((item) => normalize(item));
    return uploadedDocs.find((doc) => {
      if (doc.archivedAt) return false;
      const docCategory = normalize(doc.category);
      const docFilename = normalize(doc.filename);
      const categoryMatch = expected.some((item) => docCategory === item || docCategory.includes(item));
      const filenameMatch = hints.some((item) => item && docFilename.includes(item));
      return categoryMatch || filenameMatch;
    });
  };

  const uploadedDocs = documents || [];

  const docStates = useMemo(
    () =>
      DOCUMENT_TYPES.map((entry) => {
        const doc = findDocByCategory(
          uploadedDocs,
          entry.name,
          entry.aliases || [],
          entry.filenameHints || []
        );
        return {
          ...entry,
          uploaded: Boolean(doc),
          filename: doc?.filename as string | undefined,
        };
      }),
    [uploadedDocs]
  );

  const protocolState = docStates.find((item) => item.name === "Protocol");
  const uploadedCount = docStates.filter((item) => item.uploaded).length;
  const requiredCount = docStates.filter((item) => item.required).length;
  const coveragePercentage = Math.round((uploadedCount / docStates.length) * 100);
  const progressPercentage = Math.max(8, Math.round((currentStep / STEPS.length) * 100));

  const uploadMutation = trpc.documents.upload.useMutation({
    onSuccess: async () => {
      toast.success("Document uploaded successfully");
      await refetchDocuments();
      setUploading(false);
    },
    onError: (error) => {
      toast.error(`Upload failed: ${error.message}`);
      setUploading(false);
    },
  });

  const uploadFile = async (file: File, category: string) => {
    if (file.size > 50 * 1024 * 1024) {
      toast.error("File size exceeds 50MB limit");
      return;
    }

    try {
      setUploading(true);
      setSelectedCategory(category);
      const base64 = await toBase64(file);
      console.log("[wizard-upload] document upload", {
        filename: file.name,
        trialId,
        category,
      });
      await uploadMutation.mutateAsync({
        trialId,
        filename: file.name,
        fileData: base64,
        category,
        demoMode: currentDataMode,
      });
    } catch (error: any) {
      toast.error(error?.message || "Upload failed");
      setUploading(false);
    }
  };

  const openPicker = (category: string) => {
    setSelectedCategory(category);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadFile(file, selectedCategory || "Protocol");
    event.target.value = "";
  };

  const canProceedToStep2 = Boolean(protocolState?.uploaded);
  const canProceedToStep3 = Boolean(protocolState?.uploaded);
  const isGeneratingView = isGenerating;
  const isReadyView = !isGeneratingView && generationReady && currentStep === 3;
  const handleBack = () => {
    if (isGeneratingView) {
      onCancelGenerate();
    }
    setCurrentStep((step) => Math.max(1, step - 1) as Step);
  };

  useEffect(() => {
    if (!isFullscreenOpen || typeof window === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreenVisible(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreenOpen]);

  useEffect(() => {
    if (!isFullscreenOpen || isFullscreenVisible || typeof window === "undefined") return;
    const timeout = window.setTimeout(() => {
      setIsFullscreenOpen(false);
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [isFullscreenOpen, isFullscreenVisible]);

  const openFullscreen = () => {
    if (isFullscreenOpen) return;
    setIsFullscreenOpen(true);
    if (typeof window === "undefined") {
      setIsFullscreenVisible(true);
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setIsFullscreenVisible(true);
      });
    });
  };

  const renderWizardShell = (fullscreen: boolean) => (
    <div
      className={
        fullscreen
          ? "h-full w-full bg-white flex flex-col"
          : "bg-white rounded-xl border border-gray-200 overflow-hidden h-[calc(100vh-150px)] min-h-[700px] flex flex-col"
      }
    >
      <div className="relative px-6 py-5 border-b border-gray-200">
        <div className="w-full max-w-[720px]">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-900">
            Step {currentStep} of {STEPS.length}
          </p>
          <div className="mt-3 h-1.5 w-full max-w-[640px] rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-[#0E0017] transition-all" style={{ width: `${progressPercentage}%` }} />
          </div>
          <h2 className="mt-8 text-2xl font-bold text-gray-900">{STEPS[currentStep - 1].title}</h2>
          <p className="mt-2 text-sm text-gray-500">{STEPS[currentStep - 1].subtitle}</p>
        </div>
        {fullscreen ? (
          <div className="absolute right-6 top-6 flex items-center gap-4">
            <button
              type="button"
              className="h-8 px-3 rounded-full border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700"
            >
              Beta version
            </button>
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600 transition-colors"
              onClick={() => {
                if (isGeneratingView) {
                  onCancelGenerate();
                }
                setIsFullscreenVisible(false);
              }}
              aria-label="Close wizard fullscreen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="absolute right-6 top-6 flex items-center gap-4">
            <button
              type="button"
              className="h-8 px-3 rounded-full border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700"
            >
              Beta version
            </button>
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600 transition-colors"
              onClick={openFullscreen}
              aria-label="Expand wizard"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div
        className={
          isGeneratingView || isReadyView
            ? "flex-1 overflow-hidden p-0"
            : "flex-1 overflow-y-auto overflow-x-hidden px-6 py-6"
        }
      >
        {isGeneratingView ? (
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
              <div className="mx-auto h-[380px] w-[380px]">
                <DotLottieReact
                  src="https://lottie.host/d8617406-7b38-4ae4-968d-b934a05d4a10/UKTFUbeuwK.lottie"
                  autoplay
                  loop
                  className="h-full w-full"
                />
              </div>
              <h3 className="mt-2 text-2xl font-bold text-gray-900">Your study plan is being generated</h3>
              <p className="mt-2 text-sm text-gray-500">
                Themison is extracting document details, building task dependencies, and preparing your execution views.
              </p>
            </div>
          </div>
        ) : null}

        {isReadyView ? (
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
              <div className="mx-auto h-[360px] w-[360px]">
                <DotLottieReact
                  src="https://lottie.host/83fd8277-5c96-4552-b39d-e5cca2fc8e75/LU0ipQCTro.lottie"
                  autoplay
                  loop
                  className="h-full w-full"
                />
              </div>
              <h3 className="mt-2 text-2xl font-bold text-gray-900">Your study plan is ready</h3>
              <p className="mt-2 text-sm text-gray-500">
                Review the generated scaffold and continue in List, Timeline, Kanban, or Themison Wall.
              </p>
            </div>
          </div>
        ) : null}

        {!isGeneratingView && !isReadyView && currentStep === 1 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-xs font-semibold tracking-wide uppercase text-gray-500">Required document</h3>
              <div className="mt-3 rounded-lg border border-gray-200 bg-white px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">Protocol</p>
                  <p className="text-xs text-gray-500 mt-0.5">Core task scaffold and visit structure</p>
                  {protocolState?.uploaded && protocolState.filename ? (
                    <p className="text-xs text-gray-600 mt-1">{protocolState.filename}</p>
                  ) : null}
                </div>
                {!protocolState?.uploaded ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => openPicker("Protocol")}
                    disabled={uploading}
                  >
                    {uploading ? "Uploading..." : "Add"}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-1">
                      Uploaded
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => openPicker("Protocol")}
                      disabled={uploading}
                    >
                      Replace
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-400">PDF, Excel, CSV, ODM XML, DOCX only. Max 20MB</p>
            </div>

            <div>
              <h3 className="text-xs font-semibold tracking-wide uppercase text-gray-500">
                Optional supporting documents
              </h3>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {docStates
                  .filter((item) => !item.required)
                  .map((item) => (
                    <div
                      key={item.name}
                      className="rounded-lg border border-gray-200 bg-white px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                        {item.uploaded && item.filename ? (
                          <p className="text-xs text-gray-600 mt-1">{item.filename}</p>
                        ) : null}
                      </div>
                      {!item.uploaded ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 px-3 text-xs"
                          onClick={() => openPicker(item.name)}
                          disabled={uploading}
                        >
                          Add
                        </Button>
                      ) : (
                        <span className="inline-flex items-center text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-1">
                          Uploaded
                        </span>
                      )}
                    </div>
                  ))}
                <button
                  type="button"
                  className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => openPicker("Other")}
                  disabled={uploading}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">Add another document</p>
                    <p className="text-xs text-gray-500 mt-0.5">Upload any additional supporting file</p>
                  </div>
                  <Button type="button" variant="outline" className="h-8 px-3 text-xs pointer-events-none" tabIndex={-1}>
                    Add
                  </Button>
                </button>
              </div>
            </div>
          </div>
        )}

        {!isGeneratingView && !isReadyView && currentStep === 2 && (
          <div className="max-w-4xl">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Coverage</p>
                <p className="mt-2 text-2xl font-semibold text-[#0E0017]">{coveragePercentage}%</p>
                <p className="mt-1 text-xs text-gray-500">{uploadedCount}/{docStates.length} documents uploaded</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Required Docs</p>
                <p className="mt-2 text-2xl font-semibold text-[#0E0017]">{requiredCount}</p>
                <p className="mt-1 text-xs text-gray-500">Protocol required to continue</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Uploaded</p>
                <p className="mt-2 text-2xl font-semibold text-[#0E0017]">{uploadedCount}</p>
                <p className="mt-1 text-xs text-gray-500">Optional docs improve task quality</p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-gray-200 overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_120px] bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <div>Document type</div>
                <div>Status</div>
              </div>
              {docStates.map((item) => (
                <div
                  key={item.name}
                  className="grid grid-cols-[minmax(0,1fr)_120px] items-center px-4 py-3 border-t border-gray-100"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                  </div>
                  <div>
                    {item.uploaded ? (
                      <span className="inline-flex items-center text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-1">
                        Uploaded
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-2 py-1">
                        Missing
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isGeneratingView && !isReadyView && currentStep === 3 && (
          <div className="max-w-3xl">
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-5">
              <p className="text-sm text-gray-600">Ready to generate execution plan</p>
              <h3 className="mt-2 text-xl font-semibold text-[#0E0017]">
                Themison will create tasks from your uploaded trial documents.
              </h3>
              <ul className="mt-4 space-y-2 text-sm text-gray-700">
                <li>• Build protocol-linked tasks with source references</li>
                <li>• Organize tasks into phases and dependencies</li>
                <li>• Prepare the plan for review in Kanban, Timeline, List, and Wall views</li>
              </ul>
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                {uploadedCount} document{uploadedCount === 1 ? "" : "s"} uploaded. You can generate now and refine after review.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          {currentStep > 1 ? (
            <Button variant="outline" onClick={handleBack}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              {isGeneratingView ? "Stop" : "Back"}
            </Button>
          ) : null}
        </div>

          <div>
            {currentStep < 3 ? (
              <Button
                className="bg-[#2F6FED] hover:bg-[#255BD1] text-white"
                onClick={() => setCurrentStep((step) => Math.min(3, step + 1) as Step)}
                disabled={(currentStep === 1 && !canProceedToStep2) || (currentStep === 2 && !canProceedToStep3) || uploading || isGeneratingView}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                className="bg-[#2F6FED] hover:bg-[#255BD1] text-white"
                onClick={generationReady ? onSeePlan : onGenerate}
                disabled={isGenerating || uploading}
              >
                {isGenerating ? "Generating..." : generationReady ? "See Plan" : "Generate Plan"}
              </Button>
            )}
          </div>
        </div>
      </div>
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.csv,.xls,.xlsx,.xml"
        onChange={handleFileChange}
        className="hidden"
      />
      {renderWizardShell(false)}
      {isFullscreenOpen ? (
        <div className="fixed inset-0 z-[70] pointer-events-auto">
          <div
            className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-500 ${
              isFullscreenVisible ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setIsFullscreenVisible(false)}
          />
          <div
            className={`absolute left-0 top-0 h-full w-full bg-white flex flex-col transform-gpu transition-[transform,opacity] duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
              isFullscreenVisible ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"
            }`}
          >
            {renderWizardShell(true)}
          </div>
        </div>
      ) : null}
    </>
  );
}
