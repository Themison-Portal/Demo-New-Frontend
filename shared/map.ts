export type MapStatus = "draft" | "active" | "revised" | "archived";

export type PhaseType =
  | "screening"
  | "baseline"
  | "treatment_visit"
  | "follow_up"
  | "end_of_study"
  | "unscheduled"
  | "screen_fail"
  | "early_termination"
  | "custom";

export type TaskStatus =
  | "suggested"
  | "confirmed"
  | "todo"
  | "in_progress"
  | "blocked"
  | "waiting"
  | "done"
  | "skipped"
  | "cancelled";

export type TaskCategory =
  | "consent"
  | "eligibility"
  | "lab_sample"
  | "vital_signs"
  | "imaging"
  | "drug_administration"
  | "assessment"
  | "questionnaire"
  | "data_entry"
  | "coordination"
  | "documentation"
  | "follow_up"
  | "safety_reporting"
  | "regulatory"
  | "custom";

export type TaskPriority = "critical" | "high" | "medium" | "low";

export type Role =
  | "pi"
  | "sub_i"
  | "crc"
  | "nurse"
  | "pharmacist"
  | "lab_tech"
  | "data_manager"
  | "regulatory_coordinator"
  | "study_coordinator"
  | "custom";

export type DependencyType =
  | "finish_to_start"
  | "start_to_start"
  | "finish_to_finish"
  | "concurrent"
  | "blocked_by";

export type TelemetryEventType =
  | "map.generated"
  | "task.accepted"
  | "task.rejected"
  | "task.modified"
  | "task.added_manual"
  | "dependency.added"
  | "dependency.removed"
  | "map.launched"
  | "view.switched"
  | "task.started"
  | "task.completed"
  | "task.blocked"
  | "task.unblocked"
  | "task.reassigned"
  | "kanban.card_moved"
  | "phase.completed"
  | "visit.window_warning"
  | "amendment.reviewed";

export interface ProtocolRef {
  documentId: number;
  section: string;
  page?: number;
  paragraph?: string;
  extractedText?: string;
  chunkId?: string;
}

export interface MapMetadata {
  protocolTitle: string;
  sponsor: string;
  indication: string;
  totalTasks: number;
  totalPhases: number;
  estimatedDurationDays: number;
  generatedBy: "ai" | "manual" | "hybrid";
  aiConfidenceScore?: number;
  lastAmendmentId?: string | null;
}

export interface ExecutionMap {
  id: string;
  trialId: string;
  protocolId: number;
  status: MapStatus;
  version: number;
  metadata: Partial<MapMetadata> | Record<string, unknown>;
  createdBy: number;
  createdAt: string;
  launchedAt?: string | null;
  updatedAt: string;
}

export interface Phase {
  id: string;
  mapId: string;
  name: string;
  phaseType: PhaseType;
  displayOrder: number;
  color: string;
  estimatedDate?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  protocolRef?: Record<string, unknown> | null;
  canvasX?: number | null;
  canvasY?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhaseTransition {
  id: string;
  fromPhaseId: string;
  toPhaseId: string;
  conditionLabel?: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface Task {
  id: string;
  phaseId: string;
  mapId: string;
  name: string;
  description?: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  blockedReason?: string | null;
  blockedSince?: string | null;
  assignedRole?: Role | null;
  assignedUserId?: number | null;
  suggestedAssignee?: string | null;
  suggestedDate?: string | null;
  dueDate?: string | null;
  estimatedDuration?: number | null;
  startDate?: string | null;
  completedDate?: string | null;
  orderInPhase: number;
  canvasX?: number | null;
  canvasY?: number | null;
  createdBy: "ai" | "user";
  aiConfidence?: number | null;
  conditionalNote?: string | null;
  isCustom: boolean;
  tags: string[];
  protocolRefs: ProtocolRef[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskDependency {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  dependencyType: DependencyType;
  conditionLabel?: string | null;
  isCrossPhase: boolean;
  createdAt: string;
}

export interface ProtocolMapSection {
  id: string;
  protocolId: number;
  mapId: string;
  name: string;
  sectionType: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  dateReference?: string | null;
  parentSectionId?: string | null;
  linkedPhaseIds: string[];
  linkedTaskIds: string[];
  displayOrder: number;
  isChecked: boolean;
  children?: ProtocolMapSection[];
}

export interface TelemetryEvent {
  id: string;
  mapId: string;
  trialId: string;
  eventType: TelemetryEventType;
  userId?: number | null;
  targetId?: string | null;
  targetType?: "task" | "phase" | "dependency" | "map" | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export const VALID_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  suggested: ["confirmed", "cancelled"],
  confirmed: ["todo"],
  todo: ["in_progress", "blocked", "waiting", "skipped", "cancelled"],
  in_progress: ["done", "blocked", "waiting", "cancelled"],
  blocked: ["in_progress", "todo", "cancelled"],
  waiting: ["in_progress", "todo", "cancelled"],
  done: [],
  skipped: [],
  cancelled: [],
};

export type MapViewType = "scaffold" | "timeline" | "canvas" | "kanban";

export const KANBAN_COLUMNS_WIZARD: TaskStatus[] = ["suggested", "confirmed", "cancelled"];
export const KANBAN_COLUMNS_ACTIVE: TaskStatus[] = ["todo", "in_progress", "blocked", "waiting", "done"];
