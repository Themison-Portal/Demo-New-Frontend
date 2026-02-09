/**
 * TrialCard Component
 * Design: Clinical Modernism - Clean card with status, progress, and team info
 */

import { Users } from "lucide-react";
import { useLocation } from "wouter";

interface TrialCardProps {
  trial: {
    id: string;
    title: string;
    investigationalProduct?: string | null;
    sponsor: string | null;
    status: string;
    enrolledPatients: number | null;
    targetPatients: number | null;
    teamCount?: number;
  };
}

export function TrialCard({ trial }: TrialCardProps) {
  const [, setLocation] = useLocation();

  // Calculate enrollment progress
  const enrolledNum = trial.enrolledPatients || 0;
  const targetNum = trial.targetPatients || 0;
  const progress = targetNum > 0 ? Math.round((enrolledNum / targetNum) * 100) : 0;

  // Status badge styling
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return {
          label: "Enrollment",
          className: "bg-blue-500 text-white",
        };
      case "recruiting":
        return {
          label: "Treatment",
          className: "bg-blue-600 text-white",
        };
      case "on-hold":
        return {
          label: "Paused",
          className: "bg-gray-400 text-white",
        };
      case "not-started":
        return {
          label: "Not started",
          className: "bg-gray-200 text-gray-700",
        };
      default:
        return {
          label: "Follow-up",
          className: "bg-purple-500 text-white",
        };
    }
  };

  const statusBadge = getStatusBadge(trial.status);

  const handleClick = () => {
    setLocation(`/trial/${trial.id}`);
  };

  // Get a soft gray/white abstract gradient based on trial ID
  const getHeaderGradient = (id: string) => {
    const gradients = [
      "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)", // Soft blue-gray
      "linear-gradient(135deg, #e0e0e0 0%, #f5f5f5 100%)", // Light gray
      "linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)", // Very light gray
      "linear-gradient(135deg, #e6e9f0 0%, #eef1f5 100%)", // Pale blue-gray
      "linear-gradient(135deg, #f0f0f0 0%, #e8e8e8 100%)", // Neutral gray
      "linear-gradient(135deg, #fafafa 0%, #e0e0e0 100%)", // Off-white to gray
      "linear-gradient(135deg, #ececec 0%, #f9f9f9 100%)", // Light neutral
      "linear-gradient(135deg, #e9ecef 0%, #f8f9fa 100%)", // Subtle gray
    ];
    const index = parseInt(id.split("-")[1] || "0", 36) % gradients.length;
    return gradients[index];
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleClick();
        }
      }}
      className="group relative bg-card border border-border rounded-xl overflow-hidden hover:shadow-md transition-all duration-200 text-left w-full cursor-pointer"
    >
      {/* Header Image Section */}
      <div 
        className="relative h-32 w-full"
        style={{ 
          background: getHeaderGradient(trial.id)
        }}
      >
        {/* Status Badge */}
        <div className="absolute top-3 left-3">
          <span
            className={`inline-block px-2.5 py-1 rounded text-xs font-medium ${statusBadge.className}`}
          >
            {statusBadge.label}
          </span>
        </div>

        {/* Paused Trial Badge (if applicable) */}
        {trial.status === "on-hold" && (
          <div className="absolute top-3 right-3">
            <span className="inline-block px-2.5 py-1 rounded bg-white/90 text-gray-700 text-xs font-medium">
              Paused Trial
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Trial Name */}
        <h3 className="text-base font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
          {trial.investigationalProduct || trial.title}
        </h3>

        {/* Sponsor */}
        {trial.sponsor && (
          <p className="text-xs text-muted-foreground mb-4">{trial.sponsor}</p>
        )}

        {/* Enrollment Progress */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Enrolled patients</span>
            <span className="text-2xl font-bold text-foreground">{enrolledNum}</span>
          </div>

          {/* Progress Bar */}
          <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, backgroundColor: '#d9d9d9' }}
            />
          </div>

          <div className="text-xs text-muted-foreground">{progress}% Complete</div>
        </div>

        {/* Team Info */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="w-3.5 h-3.5" />
            <span>{trial.teamCount ?? 0} Team Members</span>
          </div>
        </div>
      </div>
    </div>
  );
}
