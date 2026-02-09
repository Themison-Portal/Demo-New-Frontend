import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, FileText, Check, ChevronRight, ChevronLeft, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useDemoState } from "@/contexts/DemoStateContext";

interface StudySetupWizardEntryProps {
  trialId: string;
  onGenerate: () => void;
  isGenerating: boolean;
}

type Step = 1 | 2 | 3;

export function StudySetupWizardEntry({
  trialId,
  onGenerate,
  isGenerating,
}: StudySetupWizardEntryProps) {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const { getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  
  // Fetch documents for this trial
  const { data: documents, refetch: refetchDocuments } = trpc.documents.list.useQuery({
    trialId,
    demoMode: currentDataMode,
  });
  
  // Upload mutation
  const uploadMutation = trpc.documents.upload.useMutation({
    onSuccess: () => {
      toast.success("Document uploaded successfully");
      refetchDocuments();
      setUploading(false);
    },
    onError: (error) => {
      toast.error("Upload failed: " + error.message);
      setUploading(false);
    },
  });
  
  const handleFileSelect = (category: string) => {
    setSelectedCategory(category);
    fileInputRef.current?.click();
  };
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      toast.error("File size exceeds 50MB limit");
      return;
    }
    
    setUploading(true);
    
    // Convert file to base64
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result?.toString().split(',')[1];
      if (!base64) {
        toast.error("Failed to read file");
        setUploading(false);
        return;
      }
      
      await uploadMutation.mutateAsync({
        trialId,
        filename: file.name,
        fileData: base64,
        category: selectedCategory,
        demoMode: currentDataMode,
      });
    };
    reader.readAsDataURL(file);
    
    // Reset input
    e.target.value = '';
  };
  
  const uploadedDocs = documents || [];

  const normalize = (value: string | null | undefined) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  // Helper function to find document by category with resilient matching.
  const findDocByCategory = (
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

  const protocolDoc = findDocByCategory("Protocol", [], ["protocol"]);
  const labManualDoc = findDocByCategory("Lab Manual", [], ["lab manual"]);
  const pharmacyManualDoc = findDocByCategory("Pharmacy Manual", [], ["pharmacy manual"]);
  const soaDoc = findDocByCategory(
    "Schedule of Assessments (SoA)",
    ["Schedule of Assessments", "SOA"],
    ["schedule of assessments", "soa"]
  );
  const icfDoc = findDocByCategory(
    "Informed Consent Form (ICF)",
    ["Informed Consent Form", "ICF"],
    ["informed consent", "icf"]
  );
  const edcDoc = findDocByCategory(
    "EDC/CRF Completion Guide",
    ["EDC CRF Completion Guide", "EDC Guide", "CRF Guide"],
    ["edc", "crf"]
  );
  const safetyManualDoc = findDocByCategory(
    "Safety Reporting Manual",
    ["Safety Manual"],
    ["safety reporting", "safety manual"]
  );
  const monitoringPlanDoc = findDocByCategory("Monitoring Plan", [], ["monitoring plan"]);
  
  const documentTypes = [
    { name: "Protocol", description: "Core task scaffold, visit structure", uploaded: !!protocolDoc, filename: protocolDoc?.filename, required: true },
    { name: "Lab Manual", description: "Lab prep tasks, sample handling steps", uploaded: !!labManualDoc, filename: labManualDoc?.filename, required: false },
    { name: "Pharmacy Manual", description: "Drug handling tasks, temperature logs", uploaded: !!pharmacyManualDoc, filename: pharmacyManualDoc?.filename, required: false },
    { name: "Schedule of Assessments (SoA)", description: "Detailed per-visit procedures", uploaded: !!soaDoc, filename: soaDoc?.filename, required: false },
    { name: "Informed Consent Form (ICF)", description: "Consent tasks, re-consent reminders", uploaded: !!icfDoc, filename: icfDoc?.filename, required: false },
    { name: "EDC/CRF Completion Guide", description: "Data entry tasks, query resolution", uploaded: !!edcDoc, filename: edcDoc?.filename, required: false },
    { name: "Safety Reporting Manual", description: "Safety reporting tasks, escalation workflows", uploaded: !!safetyManualDoc, filename: safetyManualDoc?.filename, required: false },
    { name: "Monitoring Plan", description: "Prep for monitoring visits", uploaded: !!monitoringPlanDoc, filename: monitoringPlanDoc?.filename, required: false },
  ];
  
  const uploadedCount = documentTypes.filter(d => d.uploaded).length;
  const coveragePercentage = Math.round((uploadedCount / documentTypes.length) * 100);
  
  const steps = [
    { number: 1, title: "Upload Documents", description: "Add your study documents" },
    { number: 2, title: "Review Coverage", description: "See what will be extracted" },
    { number: 3, title: "Generate Plan", description: "Create execution plan" },
  ];
  
  const canProceedToStep2 = !!protocolDoc;
  const canProceedToStep3 = !!protocolDoc;
  
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div className="px-8 py-4 border-b border-gray-200">
        <h2 className="text-2xl font-semibold text-gray-900">Study Setup Agent</h2>
        <p className="text-sm text-gray-700 mt-2 max-w-3xl">
          Transform your protocol into an operational execution plan. Themison will extract visits, procedures, and assessments from your clinical documents and turn them into tasks you can assign and track.
        </p>
      </div>
      
      {/* Progress Indicator */}
      <div className="px-8 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center justify-center max-w-4xl mx-auto">
          {steps.map((step, index) => (
            <div key={step.number} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs transition-colors ${
                    currentStep === step.number
                      ? "text-blue-600"
                      : currentStep > step.number
                      ? ""
                      : "bg-gray-200 text-gray-500"
                  }`}
                  style={
                    currentStep === step.number
                      ? { backgroundColor: '#eff8ff', border: '2px solid rgb(178, 221, 255)' }
                      : currentStep > step.number
                      ? { backgroundColor: '#edfcf2', border: '2px solid #62D686' }
                      : {}
                  }
                >
                  {currentStep > step.number ? <Check className="w-4 h-4" style={{ stroke: '#62D686', strokeWidth: 3 }} /> : step.number}
                </div>
                <div className="mt-1.5 text-center w-32">
                  <div className={`text-xs font-medium ${currentStep === step.number ? "text-blue-600" : "text-gray-600"}`}>
                    {step.title}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{step.description}</div>
                </div>
              </div>
              {index < steps.length - 1 && (
                <ChevronRight className={`w-5 h-5 mx-6 flex-shrink-0 ${currentStep > step.number ? "text-green-500" : "text-gray-300"}`} />
              )}
            </div>
          ))}
        </div>
      </div>
      
      {/* Step Content */}
      <div className="px-8 py-4 overflow-y-auto max-h-[calc(100vh-430px)]">
        {/* Step 1: Upload Documents */}
        {currentStep === 1 && (
          <div className="max-w-4xl mx-auto">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-gray-900 mb-1.5">Add Your Study Documents</h3>
              <p className="text-sm text-gray-600">Upload documents to generate a comprehensive execution plan. Protocol is required.</p>
            </div>
            
            {/* Required Section */}
            <div className="mb-6">
              <h4 className="text-xs font-semibold text-gray-700 mb-2">REQUIRED</h4>
              <div className="space-y-3">
                {documentTypes.filter(d => d.required).map((doc) => (
                  <div key={doc.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-3">
                      {doc.uploaded ? (
                        <Check className="w-5 h-5 text-green-600 flex-shrink-0" style={{ strokeWidth: 3 }} />
                      ) : (
                        <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      )}
                      <div>
                        <div className="font-medium text-gray-900">{doc.name}</div>
                        {doc.uploaded && doc.filename && (
                          <div className="text-xs text-gray-500 mt-0.5">{doc.filename}</div>
                        )}
                        <div className="text-xs text-gray-600 mt-1">{doc.description}</div>
                      </div>
                    </div>
                    {!doc.uploaded && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-blue-600 hover:text-blue-700"
                        onClick={() => handleFileSelect(doc.name)}
                        disabled={uploading}
                      >
                        {uploading && selectedCategory === doc.name ? "Uploading..." : "+ Add"}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            {/* Recommended Section */}
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-2">RECOMMENDED (FOR RICHER EXECUTION PLAN)</h4>
              <div className="space-y-3">
                {documentTypes.filter(d => !d.required).map((doc) => (
                  <div key={doc.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-3">
                      {doc.uploaded ? (
                        <Check className="w-5 h-5 text-green-600 flex-shrink-0" style={{ strokeWidth: 3 }} />
                      ) : (
                        <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      )}
                      <div>
                        <div className="font-medium text-gray-900">{doc.name}</div>
                        {doc.uploaded && doc.filename && (
                          <div className="text-xs text-gray-500 mt-0.5">{doc.filename}</div>
                        )}
                        <div className="text-xs text-gray-600 mt-1">{doc.description}</div>
                      </div>
                    </div>
                    {!doc.uploaded && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-blue-600 hover:text-blue-700"
                        onClick={() => handleFileSelect(doc.name)}
                        disabled={uploading}
                      >
                        {uploading && selectedCategory === doc.name ? "Uploading..." : "+ Add"}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              
              {/* Add Other Document */}
              <div className="mt-4">
                <Button
                  variant="outline"
                  className="w-full justify-start text-gray-700 hover:bg-gray-50 border-dashed border-2 min-h-[70px] py-3"
                  onClick={() => console.log('Add custom document')}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Other Document Type
                </Button>
              </div>
            </div>
            
            <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm text-gray-700">
                <strong>{uploadedCount} of {documentTypes.length} documents uploaded.</strong> You can proceed with what you have, or add more for richer task coverage.
              </p>
            </div>
          </div>
        )}
        
        {/* Step 2: Review Coverage */}
        {currentStep === 2 && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Review What Gets Extracted</h3>
              <p className="text-sm text-gray-600">Based on your uploaded documents, here's what Themison will generate.</p>
            </div>
            
            <div className="space-y-6">
              {/* Coverage Card */}
              <div className="p-6 bg-white rounded-lg border border-gray-200">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg border" style={{backgroundColor: '#eff8ff', borderColor: 'rgb(178, 221, 255)'}}>
                    <Sparkles className="w-6 h-6" style={{color: 'rgb(21, 112, 239)'}} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900 mb-1">Plan Completeness: {coveragePercentage}%</h4>
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                      <div className="h-2 rounded-full transition-all" style={{ width: `${coveragePercentage}%`, backgroundColor: '#d9d9d9' }} />
                    </div>
                    <p className="text-sm text-gray-700">
                      {uploadedCount === 1 ? "You have the minimum required document. " : `You have ${uploadedCount} documents uploaded. `}
                      {uploadedCount < documentTypes.length && "Add more documents for more complete task coverage."}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* What Gets Generated */}
              <div className="p-6 bg-white rounded-lg border border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-4">Themison Will Generate:</h4>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-gray-100 rounded">
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">Visit Schedule</div>
                      <div className="text-sm text-gray-600">Screening, Treatment, Follow-up visits with timelines</div>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-gray-100 rounded">
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">Task Scaffolds</div>
                      <div className="text-sm text-gray-600">Lab prep, consent, data entry, monitoring tasks</div>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-gray-100 rounded">
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">Team Workflows</div>
                      <div className="text-sm text-gray-600">Role assignments, dependencies, collaboration points</div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Missing Documents Alert */}
              {uploadedCount < 3 && (
                <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                  <p className="text-sm text-gray-700">
                    <strong>Tip:</strong> Adding Pharmacy Manual and Schedule of Assessments would increase task coverage by ~30%.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Step 3: Generate Plan */}
        {currentStep === 3 && (
          <div className="max-w-2xl mx-auto text-center overflow-hidden">
            <div className="mb-4">
              <div className="inline-flex p-3 bg-blue-100 rounded-full mb-3">
                <Sparkles className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Ready to Generate</h3>
              <p className="text-gray-600">
                Themison will analyze your {uploadedCount} document{uploadedCount !== 1 ? 's' : ''} and create a comprehensive execution plan with visits, tasks, and workflows.
              </p>
            </div>
            
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 mb-6">
              <h4 className="font-semibold text-gray-900 mb-3">What Happens Next:</h4>
              <div className="space-y-2 text-left">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0" style={{ backgroundColor: '#eff8ff', border: '2px solid rgb(178, 221, 255)', color: 'rgb(21, 112, 239)' }}>1</div>
                  <div className="text-sm text-gray-700">AI extracts visit schedules, procedures, and assessments from your documents</div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0" style={{ backgroundColor: '#eff8ff', border: '2px solid rgb(178, 221, 255)', color: 'rgb(21, 112, 239)' }}>2</div>
                  <div className="text-sm text-gray-700">Tasks are organized into phases with dependencies and timelines</div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0" style={{ backgroundColor: '#eff8ff', border: '2px solid rgb(178, 221, 255)', color: 'rgb(21, 112, 239)' }}>3</div>
                  <div className="text-sm text-gray-700">You can review, edit, and customize the generated plan</div>
                </div>
              </div>
            </div>
            
            <Button
              onClick={onGenerate}
              disabled={isGenerating}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 text-base"
            >
              {isGenerating ? (
                <>
                  <Sparkles className="w-5 h-5 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  Generate Execution Plan
                </>
              )}
            </Button>
          </div>
        )}
      </div>
      
      {/* Navigation Footer */}
      <div className="px-8 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1) as Step)}
          disabled={currentStep === 1}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        
        <div className="text-sm text-gray-600">
          Step {currentStep} of {steps.length}
        </div>
        
        {currentStep < 3 ? (
          <Button
            onClick={() => setCurrentStep((prev) => Math.min(3, prev + 1) as Step)}
            disabled={(currentStep === 1 && !canProceedToStep2) || (currentStep === 2 && !canProceedToStep3)}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <div className="w-20" /> // Spacer to keep center alignment
        )}
      </div>
    </div>
    </>
  );
}
