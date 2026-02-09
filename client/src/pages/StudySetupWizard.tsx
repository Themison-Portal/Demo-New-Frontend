import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Wand2, Sparkles, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useDemoState } from "@/contexts/DemoStateContext";

/**
 * Study Setup Agent - Entry Point Screen
 * Transforms protocol into operational execution plan
 */
export default function StudySetupWizard() {
  const [, setLocation] = useLocation();
  const [isGenerating, setIsGenerating] = useState(false);
  const { getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();

  // For demo purposes, we'll use hardcoded values
  // In production, these would come from route params or context
  const trialId = '1';
  
  // Get the list of protocols for this trial
  const { data: protocols, isLoading: protocolsLoading } = trpc.documents.list.useQuery({
    trialId,
    demoMode: currentDataMode,
  });
  
  // Use the most recently uploaded protocol
  const latestProtocol = protocols?.[0]; // protocols are ordered by createdAt DESC
  const protocolId = latestProtocol?.id;
  const protocolFilename = latestProtocol?.filename || "No protocol uploaded";

  const generateScaffold = trpc.studySetupWizard.generateScaffold.useMutation({
    onSuccess: (data) => {
      setIsGenerating(false);
      // Navigate to scaffold view
      setLocation(`/trial/${trialId}/wizard/scaffold`);
    },
    onError: (error) => {
      setIsGenerating(false);
      console.error("Failed to generate scaffold:", error);
      alert("Failed to generate execution plan. Please try again.");
    },
  });

  const handleGenerate = () => {
    if (!protocolId) {
      alert("No protocol found. Please upload a protocol first.");
      return;
    }
    setIsGenerating(true);
    generateScaffold.mutate({ protocolId, trialId, demoMode: currentDataMode });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-2xl">
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-blue-50 rounded-xl flex items-center justify-center">
              <Wand2 className="w-8 h-8 text-blue-600" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-semibold text-gray-900 mb-3">
            Study Setup Agent
          </h1>

          {/* Subtitle */}
          <p className="text-gray-600 mb-8 max-w-xl mx-auto leading-relaxed">
            Transform your protocol into an operational execution plan. Themison will
            analyze your protocol and generate a task scaffold you can review and
            customize.
          </p>

          {/* CTA Button */}
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            size="lg"
            className="mb-6"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Generate Execution Plan
              </>
            )}
          </Button>

          {/* Context Line */}
          <p className="text-sm text-gray-500">
            Based on: {protocolFilename}
          </p>
        </div>
      </div>
    </div>
  );
}
