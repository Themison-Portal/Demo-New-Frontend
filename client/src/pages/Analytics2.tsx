import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { useDemoState } from "@/contexts/DemoStateContext";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnalyticsIcon } from "@/components/icons/AnalyticsIcon";
import { TrialElements } from "@/components/icons/TrialElements";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Home,
  Info,
  LayoutGrid,
  MoreHorizontal,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { logEvent } from "@/lib/telemetry";

type WorkspaceTask = {
  id?: string;
  phaseId?: string | null;
  orderInPhase?: number | null;
  trialId?: string | null;
  status?: string | null;
  blockedReason?: string | null;
  assignedRole?: string | null;
  assignedUserId?: string | number | null;
  suggestedAssignee?: string | null;
  dueDate?: string | Date | null;
  suggestedDate?: string | Date | null;
  blockedSince?: string | Date | null;
  completedDate?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

type WorkspacePhase = {
  id?: string;
  displayOrder?: number | null;
  phaseType?: string | null;
  estimatedDate?: string | Date | null;
  windowStart?: string | Date | null;
  windowEnd?: string | Date | null;
};

type WorkspaceRow = {
  map?: { id: string; trialId: string };
  tasks?: WorkspaceTask[];
  phases?: WorkspacePhase[];
};

type TaskTimelineRow = {
  trialId: string;
  task: WorkspaceTask;
};

type PhaseTimelineRow = {
  trialId: string;
  phase: WorkspacePhase;
};

type AnalyticsTrialOption = {
  id: string;
  rawId?: string | null;
  title: string;
  sponsor?: string | null;
  status?: string | null;
  enrolledPatients?: number | null;
  targetPatients?: number | null;
};

type WorkloadPoint = {
  label: string;
  tasks: number;
  visits: number;
};

type EnrollmentBarPoint = {
  label: string;
  weekLabel: string;
  value: number;
  color: string;
};

type BacklogPoint = {
  label: string;
  opened: number;
  completed: number;
  net: number;
};

type BlockedReasonCategory = "External" | "Internal" | "Patient" | "System/Data" | "Scheduled/Timing";
type BlockedReasonSeriesKey = "external" | "internal" | "patient" | "systemData" | "scheduledTiming";

type BlockedReasonTrialPoint = {
  trialId: string;
  trialLabel: string;
  trialTitle: string;
  total: number;
  external: number;
  internal: number;
  patient: number;
  systemData: number;
  scheduledTiming: number;
};

type BlockerEntityValue =
  | "sponsor"
  | "cro"
  | "vendor"
  | "pi"
  | "lab"
  | "imaging"
  | "pathology"
  | "pharmacy"
  | "radiology"
  | "finance_legal"
  | "patient"
  | "internal_team"
  | "other";

type WaitingOnEntityValue = BlockerEntityValue | "not_specified";

type StatusDonutSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
  percent: number;
};

type MonthlyAreaPoint = {
  month: string;
  mobileApps: number;
  websites: number;
};

const MONTHLY_CHANNEL_AREA_DATA: MonthlyAreaPoint[] = [
  { month: "Jan", mobileApps: 500, websites: 200 },
  { month: "Feb", mobileApps: 250, websites: 230 },
  { month: "Mar", mobileApps: 300, websites: 300 },
  { month: "Apr", mobileApps: 220, websites: 350 },
  { month: "May", mobileApps: 500, websites: 370 },
  { month: "Jun", mobileApps: 250, websites: 420 },
  { month: "Jul", mobileApps: 300, websites: 550 },
  { month: "Aug", mobileApps: 230, websites: 350 },
  { month: "Sep", mobileApps: 300, websites: 400 },
  { month: "Oct", mobileApps: 350, websites: 500 },
  { month: "Nov", mobileApps: 250, websites: 330 },
  { month: "Dec", mobileApps: 400, websites: 550 },
];

type WorkloadBarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  barKey: "tasks" | "visits";
  animate?: boolean;
};

function WorkloadBarShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fill = "#1F5FEA",
  barKey,
  animate = false,
}: WorkloadBarShapeProps) {
  if (width <= 0 || height <= 0) return null;
  const pairTighten = 3;
  const shiftedX = x + (barKey === "tasks" ? pairTighten : -pairTighten);
  const topRadius = Math.max(0, Math.min(4, width / 2, height));
  const right = shiftedX + width;
  const bottom = y + height;
  const path = [
    `M ${shiftedX} ${bottom}`,
    `L ${shiftedX} ${y + topRadius}`,
    `Q ${shiftedX} ${y} ${shiftedX + topRadius} ${y}`,
    `L ${right - topRadius} ${y}`,
    `Q ${right} ${y} ${right} ${y + topRadius}`,
    `L ${right} ${bottom}`,
    "Z",
  ].join(" ");

  const animationStyle = animate
    ? ({
        transformBox: "fill-box",
        transformOrigin: "center bottom",
        animation: "workloadBarWipeUp 750ms cubic-bezier(0.22,1,0.36,1) both",
      } as CSSProperties)
    : undefined;

  return <path d={path} fill={fill} style={animationStyle} />;
}

type EnrollmentBarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  animate?: boolean;
};

function EnrollmentBarShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fill = "#0047FF",
  animate = false,
}: EnrollmentBarShapeProps) {
  if (width <= 0 || height <= 0) return null;
  const topRadius = Math.max(0, Math.min(4, width / 2, height));
  const right = x + width;
  const bottom = y + height;
  const path = [
    `M ${x} ${bottom}`,
    `L ${x} ${y + topRadius}`,
    `Q ${x} ${y} ${x + topRadius} ${y}`,
    `L ${right - topRadius} ${y}`,
    `Q ${right} ${y} ${right} ${y + topRadius}`,
    `L ${right} ${bottom}`,
    "Z",
  ].join(" ");

  const animationStyle = animate
    ? ({
        transformBox: "fill-box",
        transformOrigin: "center bottom",
        animation: "workloadBarWipeUp 750ms cubic-bezier(0.22,1,0.36,1) both",
      } as CSSProperties)
    : undefined;

  return <path d={path} fill={fill} style={animationStyle} />;
}

function normalizeTrialId(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split(":");
  return parts.length > 1 ? parts.slice(1).join(":") : raw;
}

function normalizeStatus(status?: string | null): string {
  return String(status || "").toLowerCase();
}

function parseDateValue(value?: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfWeekDate(source: Date): Date {
  const date = new Date(source.getFullYear(), source.getMonth(), source.getDate());
  const day = date.getDay();
  const daysFromMonday = (day + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(source: Date, days: number): Date {
  const date = new Date(source.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

function weeksBetweenWeekStarts(fromWeekStart: Date, toWeekStart: Date): number {
  const fromUtc = Date.UTC(
    fromWeekStart.getFullYear(),
    fromWeekStart.getMonth(),
    fromWeekStart.getDate()
  );
  const toUtc = Date.UTC(
    toWeekStart.getFullYear(),
    toWeekStart.getMonth(),
    toWeekStart.getDate()
  );
  return Math.floor((toUtc - fromUtc) / (7 * 24 * 60 * 60 * 1000));
}

function isDoneStatus(status?: string | null): boolean {
  const token = normalizeStatus(status);
  return token === "done" || token === "completed" || token === "skipped" || token === "cancelled";
}

function isResolvedThreadStatus(status?: string | null): boolean {
  const token = normalizeStatus(status);
  return token === "resolved" || token === "closed";
}

function computePercentDelta(current: number, previous: number): number {
  const currentSafe = Number.isFinite(current) ? current : 0;
  const previousSafe = Number.isFinite(previous) ? previous : 0;
  if (previousSafe <= 0) return 0;
  const raw = ((currentSafe - previousSafe) / previousSafe) * 100;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(-999, Math.min(999, raw));
}

function buildDeltaMetric(current: number, previous: number, baselinePrevious = 0) {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const rawPrevious = Number.isFinite(previous) ? previous : 0;
  const safePrevious = rawPrevious > 0 ? rawPrevious : Math.max(0, baselinePrevious);
  const hasBaseline = safePrevious > 0;
  return {
    current: safeCurrent,
    previous: safePrevious,
    hasBaseline,
    percent: computePercentDelta(safeCurrent, safePrevious),
  };
}

function buildStrictDeltaMetric(current: number, previous: number) {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safePrevious = Number.isFinite(previous) && previous > 0 ? previous : 0;
  return {
    current: safeCurrent,
    previous: safePrevious,
    hasBaseline: safePrevious > 0,
    percent: computePercentDelta(safeCurrent, safePrevious),
  };
}

function firstName(value: string) {
  const token = String(value || "").trim().split(/\s+/)[0];
  return token || "Member";
}

function initialsFromName(value?: string | null): string {
  const tokens = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return "UN";
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return `${tokens[0][0] || ""}${tokens[1][0] || ""}`.toUpperCase();
}

function normalizePersonName(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "");
}

function normalizeRoleToken(value?: string | null): string {
  const token = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!token) return "";
  if (token === "pi" || token.includes("principalinvestigator")) return "pi";
  if (token === "subi" || token === "subinvestigator" || token.includes("subinvestigator")) return "sub_i";
  if (token === "crc" || token.includes("clinicalresearchcoordinator")) return "crc";
  if (token.includes("nurse")) return "nurse";
  if (token.includes("pharmac")) return "pharmacist";
  if (token.includes("lab")) return "lab_tech";
  if (token.includes("datamanager")) return "data_manager";
  if (token.includes("regulatory")) return "regulatory_coordinator";
  if (token.includes("studycoordinator")) return "study_coordinator";
  return token;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function parseSampleSizeToTarget(sampleSize: unknown): number {
  const normalized = String(sampleSize ?? "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!normalized) return 0;
  const match = normalized.match(/\d{1,3}(?:,\d{3})+|\d+/);
  if (!match) return 0;
  const parsed = Number.parseInt(match[0].replace(/,/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeTargetPatientsValue(rawTarget: unknown, sampleSize: unknown): number {
  const explicit = Number(rawTarget || 0);
  const fallback = parseSampleSizeToTarget(sampleSize);
  if (!Number.isFinite(explicit) || explicit <= 0) return fallback;

  const allDigits = Number.parseInt(String(sampleSize ?? "").replace(/[^0-9]/g, ""), 10);
  if (fallback > 0 && Number.isFinite(allDigits) && allDigits === explicit && fallback !== explicit) {
    return fallback;
  }

  if (explicit >= 500000) {
    const leading = Number.parseInt(String(explicit).slice(0, 3), 10);
    if (Number.isFinite(leading) && leading > 0 && leading <= 5000) {
      return leading;
    }
  }

  return explicit;
}

function formatChartAxis(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

function formatChartValue(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactCount(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return Math.round(value).toLocaleString("en-US");
}

function formatCountAxis(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}K`;
  return `${Math.round(value)}`;
}

function computeWorkloadYAxis(points: WorkloadPoint[]): { yAxisMax: number; yAxisTicks: number[] } {
  // Keep workload chart on fixed 16-unit bands up to 80.
  void points;
  return { yAxisMax: 80, yAxisTicks: [0, 16, 32, 48, 64, 80] };
}

function computeBacklogYAxis(maxValue: number): { yAxisMax: number; yAxisTicks: number[] } {
  const clampedMax = Math.max(1, maxValue);
  let chartCeiling = 5;
  if (clampedMax > 5 && clampedMax <= 10) chartCeiling = 10;
  else if (clampedMax > 10 && clampedMax <= 20) chartCeiling = 20;
  else if (clampedMax > 20 && clampedMax <= 50) chartCeiling = 50;
  else if (clampedMax > 50 && clampedMax <= 100) chartCeiling = 100;
  else if (clampedMax > 100) chartCeiling = Math.ceil(clampedMax / 50) * 50;

  const step = chartCeiling / 5;
  const yAxisTicks = Array.from({ length: 6 }, (_, index) => Math.round(step * index));
  return { yAxisMax: chartCeiling, yAxisTicks };
}

function resolveBacklogOpenedAnchor(
  task: WorkspaceTask,
  currentWeekStart: Date,
  historyWeeks: number
): Date | null {
  void currentWeekStart;
  void historyWeeks;
  const createdAt = parseDateValue(task.createdAt) ?? parseDateValue(task.updatedAt);
  if (!createdAt) return null;
  return createdAt;
}

function toCompactTrialLabel(value: string, max = 16): string {
  const raw = String(value || "").trim();
  if (!raw) return "Trial";
  const short = raw.includes("·") ? raw.split("·")[0].trim() : raw;
  if (short.length <= max) return short;
  return `${short.slice(0, Math.max(1, max - 1)).trim()}…`;
}

function inferBlockedCategoryFromText(reason: string): BlockedReasonCategory | null {
  const token = reason.toLowerCase();
  if (!token) return null;
  if (
    /sponsor|cro|vendor|irb|regulatory|approval|delivery|central lab|imaging result|lab result/.test(token)
  ) {
    return "External";
  }
  if (/patient|consent|adherence|scheduling|no-show|withdrawn/.test(token)) {
    return "Patient";
  }
  if (/system|access|source data|edc|login|credential/.test(token)) {
    return "System/Data";
  }
  if (/waiting period|not yet due|processing|ethics review|amendment/.test(token)) {
    return "Scheduled/Timing";
  }
  return "Internal";
}

function resolveBlockedReasonCategory(reason: unknown): BlockedReasonCategory | null {
  if (typeof reason !== "string") return null;
  const raw = reason.trim();
  if (!raw) return null;

  if (raw.startsWith(BLOCKER_META_PREFIX)) {
    try {
      const decoded = JSON.parse(raw.slice(BLOCKER_META_PREFIX.length)) as Record<string, unknown>;
      const reasonCode = typeof decoded.reasonCode === "string" ? decoded.reasonCode.trim() : "";
      const mapped = reasonCode ? BLOCKED_REASON_CATEGORY_BY_CODE[reasonCode] : undefined;
      if (mapped) return mapped;
      const fallbackReason = typeof decoded.fallbackReason === "string" ? decoded.fallbackReason.trim() : "";
      if (fallbackReason) return inferBlockedCategoryFromText(fallbackReason);
      return null;
    } catch {
      return inferBlockedCategoryFromText(raw);
    }
  }

  return inferBlockedCategoryFromText(raw);
}

const EXECUTION_CHART_GRADIENT_STOPS = [
  { offset: "0%", color: "#DBB7FF" },
  { offset: "50.5208%", color: "#0047FF" },
  { offset: "100%", color: "#52D5FF" },
] as const;

const EXECUTION_CHART_COLOR_STOPS = [
  { t: 0, color: "#DBB7FF" },
  { t: 0.505208, color: "#0047FF" },
  { t: 1, color: "#52D5FF" },
] as const;

const STUDENT_BAR_GRADIENT_STOPS = [
  { t: 0, color: "#0047FF" },
  { t: 0.505208, color: "#52D5FF" },
  { t: 1, color: "#DBB7FF" },
] as const;

const STUDENT_ENROLLMENT_BARS = [
  { amount: "$5.000", height: 178, highlighted: false, final: false },
  { amount: "$4.500", height: 148, highlighted: false, final: false },
  { amount: "$3.600", height: 118, highlighted: false, final: false },
  { amount: "$3.000", height: 88, highlighted: true, final: false },
  { amount: "$2.100", height: 58, highlighted: false, final: false },
  { amount: "$1.800", height: 28, highlighted: false, final: false },
  { amount: "$1.000", height: 10, highlighted: false, final: true },
] as const;

const STUDENT_ENROLLMENT_AXIS = ["6K", "5K", "4K", "3K", "2K", "1K"] as const;
const COLLAB_CARD_BOTTOM_GAP_STORAGE_KEY = "ui:collab_card_bottom_gap_px";

const TRAFFIC_SOURCES = [
  { label: "Organic Search", value: 1600, color: "#6842E7" },
  { label: "Referrals", value: 700, color: "#8A7AE9" },
  { label: "Social Media", value: 400, color: "#A79FEA" },
  { label: "Others", value: 300, color: "#C6C2EE" },
] as const;
const SESSION_SERIES = [4, 9, 6, 12, 8, 7, 6, 9, 19, 5, 5, 5, 12, 6, 4] as const;
const MINI_TIMES = ["12 AM", "8 AM", "4 PM", "11 PM"] as const;
const DELTA_BASELINE_BY_MODE: Record<
  "sample" | "full" | "building",
  { activeTrials: number; patientsEnrolled: number; openTasks: number; blockedTasks: number }
> = {
  sample: { activeTrials: 2, patientsEnrolled: 104, openTasks: 42, blockedTasks: 16 },
  full: { activeTrials: 23, patientsEnrolled: 500, openTasks: 165, blockedTasks: 48 },
  building: { activeTrials: 0, patientsEnrolled: 0, openTasks: 0, blockedTasks: 0 },
};

const BLOCKER_META_PREFIX = "__blocker_meta_v1__:";

const BLOCKED_REASON_SERIES: Array<{
  key: BlockedReasonSeriesKey;
  label: BlockedReasonCategory;
  color: string;
}> = [
  { key: "external", label: "External", color: "#2F37D6" },
  { key: "internal", label: "Internal", color: "#51D4FF" },
  { key: "patient", label: "Patient", color: "#6D8BF4" },
  { key: "systemData", label: "System/Data", color: "#97B4F8" },
  { key: "scheduledTiming", label: "Scheduled/Timing", color: "#CAC5FF" },
];

const BLOCKED_REASON_CATEGORY_BY_CODE: Record<string, BlockedReasonCategory> = {
  awaiting_sponsor_cro_response: "External",
  awaiting_sponsor_cro_approval: "External",
  awaiting_vendor_delivery: "External",
  awaiting_central_lab_imaging_result: "External",
  awaiting_regulatory_irb_feedback: "External",
  awaiting_pi_sign_off: "Internal",
  awaiting_internal_department_handoff: "Internal",
  awaiting_internal_admin_contracting: "Internal",
  resource_constraint: "Internal",
  awaiting_training_certification: "Internal",
  patient_scheduling_issue: "Patient",
  patient_adherence_issue: "Patient",
  consent_pending: "Patient",
  system_access_issue: "System/Data",
  source_data_not_available: "System/Data",
  protocol_mandated_waiting_period: "Scheduled/Timing",
  scheduled_visit_not_yet_due: "Scheduled/Timing",
  sample_result_processing_in_progress: "Scheduled/Timing",
  regulatory_ethics_review_in_progress: "Scheduled/Timing",
  amendment_under_review: "Scheduled/Timing",
};

const BLOCKER_ENTITY_OPTIONS: Array<{ value: BlockerEntityValue; label: string }> = [
  { value: "sponsor", label: "Sponsor" },
  { value: "cro", label: "CRO" },
  { value: "vendor", label: "Vendor" },
  { value: "pi", label: "PI" },
  { value: "lab", label: "Lab" },
  { value: "imaging", label: "Imaging" },
  { value: "pathology", label: "Pathology" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "radiology", label: "Radiology" },
  { value: "finance_legal", label: "Finance/Legal" },
  { value: "patient", label: "Patient" },
  { value: "internal_team", label: "Internal Team" },
  { value: "other", label: "Other" },
];

const BLOCKER_ENTITY_SET = new Set(BLOCKER_ENTITY_OPTIONS.map((option) => option.value));
const WAITING_ON_OPTIONS: Array<{ value: WaitingOnEntityValue; label: string }> = [
  { value: "not_specified", label: "Not specified" },
  ...BLOCKER_ENTITY_OPTIONS,
];
const WAITING_ON_COLORS: Record<WaitingOnEntityValue, string> = {
  not_specified: "#D3D8E2",
  sponsor: "#F2A3A5",
  cro: "#6CB3E6",
  vendor: "#8ED8AF",
  pi: "#B8A6EE",
  lab: "#EBD86A",
  imaging: "#53C5E8",
  pathology: "#E7A76A",
  pharmacy: "#AFA3EA",
  radiology: "#6FD0C2",
  finance_legal: "#E4A7CC",
  patient: "#0047FF",
  internal_team: "#9C8BE6",
  other: "#CCC8DE",
};
const ENROLLMENT_STATUS_TOKENS = new Set(["recruiting", "enrolling", "enrollment"]);
const ENROLLMENT_TRIAL_OVERRIDES_BY_ID: Record<
  string,
  { enrolledPatients: number; targetPatients: number }
> = {
  "def-456": { enrolledPatients: 120, targetPatients: 150 },
};
const ENROLLMENT_TRIAL_OVERRIDES_BY_TITLE: Record<
  string,
  { enrolledPatients: number; targetPatients: number }
> = {
  "roche r-137 (tki)": { enrolledPatients: 120, targetPatients: 150 },
};

function toBlockerEntityValue(value: unknown): BlockerEntityValue | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase().replace(/\s+/g, "_") as BlockerEntityValue;
  return BLOCKER_ENTITY_SET.has(token) ? token : null;
}

function inferWaitingOnFromText(reason: string): BlockerEntityValue | null {
  const token = reason.toLowerCase();
  if (!token) return null;
  if (/sponsor/.test(token)) return "sponsor";
  if (/\bcro\b/.test(token)) return "cro";
  if (/vendor/.test(token)) return "vendor";
  if (/\bpi\b|principal investigator/.test(token)) return "pi";
  if (/pathology/.test(token)) return "pathology";
  if (/imaging/.test(token)) return "imaging";
  if (/\blab\b|central lab/.test(token)) return "lab";
  if (/pharmacy/.test(token)) return "pharmacy";
  if (/radiology/.test(token)) return "radiology";
  if (/finance|legal|contract/.test(token)) return "finance_legal";
  if (/patient|consent|adherence|scheduling|no-show/.test(token)) return "patient";
  if (/internal|resource|training|handoff|admin/.test(token)) return "internal_team";
  return null;
}

function resolveBlockedWaitingOn(reason: unknown): WaitingOnEntityValue {
  if (typeof reason !== "string") return "not_specified";
  const raw = reason.trim();
  if (!raw) return "not_specified";

  if (raw.startsWith(BLOCKER_META_PREFIX)) {
    try {
      const decoded = JSON.parse(raw.slice(BLOCKER_META_PREFIX.length)) as Record<string, unknown>;
      const waitingOn = toBlockerEntityValue(decoded.waitingOn);
      if (waitingOn) return waitingOn;
      const fallbackReason = typeof decoded.fallbackReason === "string" ? decoded.fallbackReason.trim() : "";
      if (fallbackReason) {
        return inferWaitingOnFromText(fallbackReason) ?? "not_specified";
      }
      return "not_specified";
    } catch {
      return inferWaitingOnFromText(raw) ?? "not_specified";
    }
  }

  return inferWaitingOnFromText(raw) ?? "not_specified";
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function mixHex(fromHex: string, toHex: string, t: number) {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  return rgbToHex(
    Math.round(from.r + (to.r - from.r) * t),
    Math.round(from.g + (to.g - from.g) * t),
    Math.round(from.b + (to.b - from.b) * t)
  );
}

function studentBarColorAt(position: number) {
  const t = Math.max(0, Math.min(1, position));
  for (let i = 0; i < STUDENT_BAR_GRADIENT_STOPS.length - 1; i += 1) {
    const left = STUDENT_BAR_GRADIENT_STOPS[i];
    const right = STUDENT_BAR_GRADIENT_STOPS[i + 1];
    if (t >= left.t && t <= right.t) {
      const localT = (t - left.t) / Math.max(0.0001, right.t - left.t);
      return mixHex(left.color, right.color, localT);
    }
  }
  return STUDENT_BAR_GRADIENT_STOPS[STUDENT_BAR_GRADIENT_STOPS.length - 1].color;
}

function executionChartColorAt(position: number) {
  const t = Math.max(0, Math.min(1, position));
  for (let i = 0; i < EXECUTION_CHART_COLOR_STOPS.length - 1; i += 1) {
    const left = EXECUTION_CHART_COLOR_STOPS[i];
    const right = EXECUTION_CHART_COLOR_STOPS[i + 1];
    if (t >= left.t && t <= right.t) {
      const localT = (t - left.t) / Math.max(0.0001, right.t - left.t);
      return mixHex(left.color, right.color, localT);
    }
  }
  return EXECUTION_CHART_COLOR_STOPS[EXECUTION_CHART_COLOR_STOPS.length - 1].color;
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
}) {
  if (!active || !payload?.length || typeof payload[0]?.value !== "number") {
    return null;
  }

  return (
    <div className="rounded-lg bg-[#17181b] px-3 py-2 text-white shadow-lg">
      <div className="mb-0.5 text-[11px] leading-4 text-white/75">Execution</div>
      <div className="text-sm font-medium">{formatChartValue(payload[0].value)}</div>
    </div>
  );
}

function WorkloadTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | string | null }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  const resolveSeriesValue = (seriesKey: "tasks" | "visits") => {
    const row = payload.find((entry) => String(entry?.dataKey || "") === seriesKey);
    const raw = row?.value;
    const numeric = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const tasksValue = resolveSeriesValue("tasks");
  const visitsValue = resolveSeriesValue("visits");

  return (
    <div className="rounded-[10px] border border-[#E2E5EB] bg-white px-3 py-2">
      <div className="mb-1 text-[12px] font-medium text-[#75778B]">{`Week of ${String(label || "")}`}</div>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0E0017]">
        <span className="h-[7px] w-[7px] rounded-full bg-[#1F5FEA]" />
        <span>{`Tasks : ${formatCompactCount(tasksValue)}`}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#0E0017]">
        <span className="h-[7px] w-[7px] rounded-full bg-[#B4C2FF]" />
        <span>{`Visits : ${formatCompactCount(visitsValue)}`}</span>
      </div>
    </div>
  );
}

function EnrollmentBarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: EnrollmentBarPoint; value?: number | string | null }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const raw = payload[0]?.value;
  const numeric = typeof raw === "number" ? raw : Number(raw);
  const value = Number.isFinite(numeric) ? numeric : point.value;

  return (
    <div className="rounded-[10px] border border-[#E2E5EB] bg-white px-3 py-2">
      <div className="mb-1 text-[12px] font-medium text-[#75778B]">{`Week of ${point.weekLabel}`}</div>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0E0017]">
        <span className="h-[7px] w-[7px] rounded-full bg-[#0047FF]" />
        <span>{`Enrolled patients: ${formatCompactCount(value)}`}</span>
      </div>
    </div>
  );
}

function EnrollmentWorkloadBarPanel({
  trials,
  taskRows: _taskRows,
  phaseRows: _phaseRows,
}: {
  trials: AnalyticsTrialOption[];
  taskRows?: TaskTimelineRow[];
  phaseRows?: PhaseTimelineRow[];
}) {
  const [selectedTrialId, setSelectedTrialId] = useState("all");
  const chartAreaRef = useRef<HTMLDivElement | null>(null);
  const [enrollmentAnimationNonce, setEnrollmentAnimationNonce] = useState(0);
  const [animateEnrollmentBars, setAnimateEnrollmentBars] = useState(true);

  const enrollmentTrialOptions = useMemo(
    () =>
      trials.filter((trial) =>
        ENROLLMENT_STATUS_TOKENS.has(String(trial.status || "").trim().toLowerCase())
      ),
    [trials]
  );

  useEffect(() => {
    if (enrollmentTrialOptions.length === 1) {
      const onlyTrialId = normalizeTrialId(enrollmentTrialOptions[0]?.id || "");
      if (onlyTrialId && normalizeTrialId(selectedTrialId) !== onlyTrialId) {
        setSelectedTrialId(onlyTrialId);
      }
      return;
    }
    if (selectedTrialId === "all") return;
    const selectedKey = normalizeTrialId(selectedTrialId);
    const stillValid = enrollmentTrialOptions.some(
      (trial) => normalizeTrialId(trial.id) === selectedKey
    );
    if (!stillValid) {
      setSelectedTrialId("all");
    }
  }, [enrollmentTrialOptions, selectedTrialId]);

  useEffect(() => {
    if (!animateEnrollmentBars || typeof window === "undefined") return;
    const timeoutId = window.setTimeout(() => setAnimateEnrollmentBars(false), 780);
    return () => window.clearTimeout(timeoutId);
  }, [animateEnrollmentBars, enrollmentAnimationNonce]);

  useEffect(() => {
    const node = chartAreaRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    let initialized = false;
    let wasVisible = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          if (!initialized) {
            initialized = true;
            wasVisible = true;
            return;
          }
          if (!wasVisible) {
            setAnimateEnrollmentBars(true);
            setEnrollmentAnimationNonce((value) => value + 1);
          }
          wasVisible = true;
        } else {
          initialized = true;
          wasVisible = false;
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const resolveEnrollmentSnapshot = (trial: AnalyticsTrialOption) => {
    const trialId = normalizeTrialId(trial.id);
    const titleKey = String(trial.title || "").trim().toLowerCase();
    const override =
      ENROLLMENT_TRIAL_OVERRIDES_BY_ID[trialId] ??
      ENROLLMENT_TRIAL_OVERRIDES_BY_TITLE[titleKey] ??
      (titleKey.includes("roche r-137")
        ? { enrolledPatients: 120, targetPatients: 150 }
        : undefined);
    const enrolledRaw = override?.enrolledPatients ?? Number(trial.enrolledPatients || 0);
    const targetRaw = override?.targetPatients ?? Number(trial.targetPatients || 0);
    const enrolled = Math.max(0, Math.round(enrolledRaw));
    const target = Math.max(enrolled, Math.max(0, Math.round(targetRaw)));
    return { enrolled, target };
  };

  const chartData = useMemo(() => {
    const weekCount = 12;
    const currentWeekStart = startOfWeekDate(new Date());
    const firstWeekStart = addDays(currentWeekStart, -(weekCount - 1) * 7);
    const weekStarts = Array.from({ length: weekCount }, (_, index) =>
      addDays(firstWeekStart, index * 7)
    );
    const buckets = Array.from({ length: weekCount }, () => 0);
    const selectedKeyRaw =
      enrollmentTrialOptions.length === 1
        ? normalizeTrialId(enrollmentTrialOptions[0]?.id || "")
        : normalizeTrialId(selectedTrialId);
    const selectedKey =
      selectedKeyRaw && selectedKeyRaw !== "all" ? selectedKeyRaw : "all";

    const selectedTrials =
      selectedKey === "all"
        ? enrollmentTrialOptions
        : enrollmentTrialOptions.filter(
            (trial) => normalizeTrialId(trial.id) === selectedKey
          );

    const buildWeeklyEnrollments = (total: number, seedKey: string) => {
      if (total <= 0) return Array.from({ length: weekCount }, () => 0);
      const seed = Array.from(seedKey).reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const basePattern = [0.72, 0.88, 1.05, 0.84, 1.18, 0.94, 1.12, 0.86, 1.26, 0.98, 1.1, 1.36];
      const weights = Array.from({ length: weekCount }, (_, index) => {
        const pattern = basePattern[index % basePattern.length];
        const jitter = 0.9 + ((seed + index * 19) % 24) / 100; // 0.90-1.13
        return pattern * jitter;
      });
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const rawValues = weights.map((weight) => (total * weight) / Math.max(1, totalWeight));
      const values = rawValues.map((value) => Math.floor(value));
      let diff = total - values.reduce((sum, value) => sum + value, 0);
      if (diff > 0) {
        const order = rawValues
          .map((value, index) => ({ index, frac: value - Math.floor(value) }))
          .sort((a, b) => b.frac - a.frac);
        for (let i = 0; i < order.length && diff > 0; i += 1) {
          values[order[i]!.index] += 1;
          diff -= 1;
        }
      } else if (diff < 0) {
        const order = rawValues
          .map((value, index) => ({ index, frac: value - Math.floor(value) }))
          .sort((a, b) => a.frac - b.frac);
        for (let i = 0; i < order.length && diff < 0; i += 1) {
          const idx = order[i]!.index;
          if (values[idx] <= 0) continue;
          values[idx] -= 1;
          diff += 1;
        }
      }
      return values;
    };

    for (const trial of selectedTrials) {
      const trialId = normalizeTrialId(trial.id);
      const snapshot = resolveEnrollmentSnapshot(trial);
      const weekly = buildWeeklyEnrollments(snapshot.enrolled, trialId);
      weekly.forEach((value, index) => {
        buckets[index] += value;
      });
    }

    const weekFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
    const points: EnrollmentBarPoint[] = weekStarts.map((weekStart, index) => {
      const showTick = index === 0 || index === weekCount - 1 || index % 3 === 0;
      return {
        label: showTick ? weekFormatter.format(weekStart) : "",
        weekLabel: weekFormatter.format(weekStart),
        value: buckets[index] || 0,
        color: executionChartColorAt(index / Math.max(1, weekCount - 1)),
      };
    });

    const maxValue = points.reduce((max, point) => Math.max(max, point.value), 0);
    const { yAxisMax, yAxisTicks } = computeBacklogYAxis(maxValue);
    const totalEnrolled = selectedTrials.reduce(
      (sum, trial) => sum + resolveEnrollmentSnapshot(trial).enrolled,
      0
    );
    const totalTarget = selectedTrials.reduce(
      (sum, trial) => sum + resolveEnrollmentSnapshot(trial).target,
      0
    );
    const hasSignal = totalEnrolled > 0;
    const activeEnrollmentTrials = selectedTrials.length;

    return {
      points,
      yAxisMax,
      yAxisTicks,
      totalEnrolled,
      totalTarget,
      activeEnrollmentTrials,
      hasSignal,
    };
  }, [enrollmentTrialOptions, selectedTrialId]);

  return (
    <article className="relative min-h-[320px] overflow-hidden rounded-lg border border-gray-200 bg-white px-6 pb-6 pt-5">
      <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
        <Users className="h-4 w-4 text-primary" />
      </span>

      <div className="mb-5 pr-14">
        <div>
          <h3 className="text-[20px] font-semibold leading-[28px] text-[#0E0017]">Enrollment workload</h3>
          <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
            Last 12 weeks · enrolled patients by week
          </p>
        </div>
      </div>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="inline-flex items-center gap-10">
          <div>
            <p className="text-[12px] font-medium leading-[16px] text-[#75778B]">Patients enrolled</p>
            <p className="mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
              {formatCompactCount(chartData.totalEnrolled)}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium leading-[16px] text-[#75778B]">Target patients</p>
            <p className="mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
              {formatCompactCount(chartData.totalTarget)}
            </p>
          </div>
        </div>

        {enrollmentTrialOptions.length > 1 ? (
          <select
            value={selectedTrialId}
            onChange={(event) => {
              setAnimateEnrollmentBars(false);
              setSelectedTrialId(event.target.value);
            }}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]"
          >
            <option value="all">All trials</option>
            {enrollmentTrialOptions.map((trial) => (
              <option key={`enrollment-bar-filter-${trial.id}`} value={trial.id}>
                {trial.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]">
            {enrollmentTrialOptions[0]?.title || "Enrollment trial"}
          </span>
        )}
      </div>

      {!chartData.hasSignal && (
        <p className="-mt-1 mb-3 text-[12px] font-medium text-[#75778B]">
          No enrollment activity found in the last 12 weeks for this filter.
        </p>
      )}

      <style>{`
        @keyframes workloadBarWipeUp {
          from {
            transform: scaleY(0);
          }
          to {
            transform: scaleY(1);
          }
        }
      `}</style>

      <div ref={chartAreaRef} className="h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            key={`enrollment-workload-chart-${enrollmentAnimationNonce}`}
            data={chartData.points}
            margin={{ top: 8, right: 6, left: 0, bottom: 0 }}
            barCategoryGap="22%"
          >
            <CartesianGrid stroke="rgba(185,193,217,0.26)" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#75778B" }}
              interval={0}
              dy={8}
              height={34}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#75778B" }}
              width={30}
              allowDecimals={false}
              ticks={chartData.yAxisTicks}
              domain={[0, chartData.yAxisMax]}
            />
            <Tooltip cursor={{ fill: "rgba(147,160,197,0.12)" }} content={<EnrollmentBarTooltip />} />
            <Bar
              dataKey="value"
              name="Enrolled patients"
              radius={[4, 4, 0, 0]}
              maxBarSize={16}
              isAnimationActive={false}
              shape={(props: { x?: number; y?: number; width?: number; height?: number; fill?: string }) => (
                <EnrollmentBarShape {...props} animate={animateEnrollmentBars} />
              )}
            >
              {chartData.points.map((point, index) => (
                <Cell key={`enrollment-bar-cell-${index}`} fill={point.color} fillOpacity={0.95} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

type CollaborationThreadRecord = {
  id?: string;
  trialId?: string | null;
  status?: string | null;
  createdAt?: string | Date | null;
  resolvedAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

function ThreadResolutionGaugePanel({
  trials,
}: {
  trials: AnalyticsTrialOption[];
}) {
  const trpcUtils = trpc.useUtils();
  const [selectedTrialId, setSelectedTrialId] = useState("all");
  const [aggregatedThreads, setAggregatedThreads] = useState<CollaborationThreadRecord[]>([]);
  const [aggregatingThreads, setAggregatingThreads] = useState(false);
  const threadGaugeCardRef = useRef<HTMLElement | null>(null);
  const canReplayThreadGaugeRef = useRef(true);
  const [threadGaugeAnimationNonce, setThreadGaugeAnimationNonce] = useState(0);
  const [animateThreadGauge, setAnimateThreadGauge] = useState(false);
  const [animatedResolutionRate, setAnimatedResolutionRate] = useState(0);
  const trialOptions = useMemo(() => trials.filter((trial) => Boolean(trial.rawId || trial.id)), [trials]);
  const trialOptionRawIdsKey = useMemo(
    () =>
      trialOptions
        .map((trial) => String(trial.rawId || trial.id || "").trim())
        .filter(Boolean)
        .sort()
        .join("|"),
    [trialOptions]
  );

  useEffect(() => {
    if (!trialOptions.length) return;
    if (trialOptions.length === 1) {
      const onlyId = String(trialOptions[0]?.rawId || trialOptions[0]?.id || "").trim();
      if (onlyId && selectedTrialId !== onlyId) {
        setSelectedTrialId(onlyId);
      }
      return;
    }
    if (selectedTrialId === "all") return;
    const stillValid = trialOptions.some(
      (trial) => String(trial.rawId || trial.id || "").trim() === selectedTrialId
    );
    if (!stillValid) setSelectedTrialId("all");
  }, [trialOptions, selectedTrialId]);

  const isAllSelection = trialOptions.length > 1 && selectedTrialId === "all";
  const resolvedSelectedTrialId =
    trialOptions.length === 1
      ? String(trialOptions[0]?.rawId || trialOptions[0]?.id || "").trim()
      : selectedTrialId;

  const selectedTrial = isAllSelection
    ? null
    : trialOptions.find(
        (trial) => String(trial.rawId || trial.id || "").trim() === resolvedSelectedTrialId
      ) || trialOptions[0] || null;
  const selectedTrialRawId = isAllSelection ? "" : String(selectedTrial?.rawId || selectedTrial?.id || "").trim();

  const threadsQuery = trpc.collaboration.threads.list.useQuery(
    { trialId: selectedTrialRawId },
    {
      enabled: Boolean(selectedTrialRawId) && !isAllSelection,
      refetchInterval: 15000,
    }
  );

  useEffect(() => {
    if (!isAllSelection) {
      setAggregatedThreads([]);
      setAggregatingThreads(false);
      return;
    }

    const trialIds = trialOptionRawIdsKey ? trialOptionRawIdsKey.split("|").filter(Boolean) : [];

    if (!trialIds.length) {
      setAggregatedThreads([]);
      setAggregatingThreads(false);
      return;
    }

    let cancelled = false;
    setAggregatingThreads(true);

    Promise.all(
      trialIds.map((trialId) =>
        trpcUtils.collaboration.threads.list.fetch({ trialId }).catch(() => [] as CollaborationThreadRecord[])
      )
    )
      .then((resultSets) => {
        if (cancelled) return;
        const merged = resultSets
          .flatMap((rows) => (Array.isArray(rows) ? rows : []))
          .filter(Boolean) as CollaborationThreadRecord[];
        const uniqueById = new Map<string, CollaborationThreadRecord>();
        merged.forEach((row, index) => {
          const rowId = String(row?.id || `thread-${index}`);
          if (!uniqueById.has(rowId)) uniqueById.set(rowId, row);
        });
        setAggregatedThreads(Array.from(uniqueById.values()));
      })
      .finally(() => {
        if (!cancelled) setAggregatingThreads(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAllSelection, trialOptionRawIdsKey, trpcUtils]);

  const sourceRows = useMemo(
    () =>
      isAllSelection
        ? aggregatedThreads
        : (((threadsQuery.data as CollaborationThreadRecord[] | undefined) ?? []).filter(
            Boolean
          ) as CollaborationThreadRecord[]),
    [aggregatedThreads, isAllSelection, threadsQuery.data]
  );

  const stats = useMemo(() => {
    const rows = sourceRows;
    const now = new Date();
    const weekAgo = addDays(now, -7);

    const total = rows.length;
    const resolved = rows.filter((row) => isResolvedThreadStatus(row.status)).length;
    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

    const previousTotal = rows.filter((row) => {
      const createdAt = parseDateValue(row.createdAt);
      return createdAt ? createdAt.getTime() <= weekAgo.getTime() : false;
    }).length;

    const previousResolved = rows.filter((row) => {
      if (!isResolvedThreadStatus(row.status)) return false;
      const resolvedAt = parseDateValue(row.resolvedAt);
      if (resolvedAt) return resolvedAt.getTime() <= weekAgo.getTime();
      const updatedAt = parseDateValue(row.updatedAt);
      return updatedAt ? updatedAt.getTime() <= weekAgo.getTime() : false;
    }).length;

    const previousRate =
      previousTotal > 0 ? Math.round((previousResolved / previousTotal) * 100) : resolutionRate;

    const deltaMetric = buildStrictDeltaMetric(resolutionRate, previousRate);
    const deltaPercent = Math.abs(Math.round(deltaMetric.percent));

    return {
      total,
      resolved,
      unresolved: Math.max(0, total - resolved),
      resolutionRate,
      deltaPercent,
      direction: deltaMetric.percent >= 0 ? "up" : "down",
      tone: deltaMetric.percent >= 0 ? "positive" : "negative",
    };
  }, [sourceRows]);

  const isLoadingThreads = isAllSelection ? aggregatingThreads : threadsQuery.isLoading;

  useEffect(() => {
    if (!animateThreadGauge || isLoadingThreads || typeof window === "undefined") return;
    const timeoutId = window.setTimeout(() => setAnimateThreadGauge(false), 460);
    return () => window.clearTimeout(timeoutId);
  }, [animateThreadGauge, isLoadingThreads, threadGaugeAnimationNonce]);

  useEffect(() => {
    const node = threadGaugeCardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const ratio = Number(entry.intersectionRatio || 0);
        const isClearlyVisible = entry.isIntersecting && ratio >= 0.12;
        const isClearlyOut = !entry.isIntersecting || ratio <= 0.01;

        if (isClearlyVisible && canReplayThreadGaugeRef.current) {
          canReplayThreadGaugeRef.current = false;
          setAnimateThreadGauge(true);
          setThreadGaugeAnimationNonce((value) => value + 1);
        }

        if (isClearlyOut) {
          canReplayThreadGaugeRef.current = true;
        }
      },
      { threshold: [0, 0.05, 0.12] }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isLoadingThreads) return;
    const target = Math.max(0, Math.min(100, stats.resolutionRate));
    if (!animateThreadGauge) {
      setAnimatedResolutionRate(target);
      return;
    }
    const durationMs = 320;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const elapsed = Math.max(0, now - start);
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedResolutionRate(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    setAnimatedResolutionRate(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animateThreadGauge, isLoadingThreads, stats.resolutionRate, threadGaugeAnimationNonce]);

  const badgePositive = stats.tone === "positive";
  const directionUp = stats.direction === "up";

  return (
    <article
      ref={threadGaugeCardRef}
      className="relative min-h-[320px] overflow-hidden rounded-lg border border-gray-200 bg-white px-6 pb-6 pt-5"
    >
      <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
        <CheckCircle2 className="h-4 w-4 text-primary" />
      </span>

      <div className="mb-5 pr-14">
        <h3 className="text-[20px] font-semibold leading-[28px] text-[#0E0017]">Thread resolution</h3>
        <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
          Collab Hub · resolved vs open threads
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="inline-flex items-center">
          <div className="inline-flex items-center gap-2">
            <span
              className={`flex flex-col items-start gap-[10px] rounded-[2px] border-[0.6px] px-[6px] py-[3px] ${
                badgePositive
                  ? "border-[rgba(5,193,104,0.20)] bg-[rgba(5,193,104,0.20)]"
                  : "border-[rgba(255,90,101,0.20)] bg-[rgba(255,90,101,0.20)]"
              }`}
            >
              <span
                className={`inline-flex items-center gap-[6px] text-[12px] font-medium leading-[14px] ${
                  badgePositive ? "text-[#14CA74]" : "text-[#FF5A65]"
                }`}
              >
                {`${stats.deltaPercent}%`}
                {directionUp ? (
                  <ArrowUpRight className="h-[18px] w-[18px]" />
                ) : (
                  <ArrowDownRight className="h-[18px] w-[18px]" />
                )}
              </span>
            </span>
            <span className="text-[11px] font-medium leading-[13px] text-[#75778B]">from last week</span>
          </div>
        </div>

        {trialOptions.length > 1 ? (
          <select
            value={selectedTrialId}
            onChange={(event) => {
              setAnimateThreadGauge(true);
              setThreadGaugeAnimationNonce((value) => value + 1);
              setSelectedTrialId(event.target.value);
            }}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]"
          >
            <option value="all">All trials</option>
            {trialOptions.map((trial) => (
              <option
                key={`thread-resolution-trial-${trial.id}`}
                value={String(trial.rawId || trial.id || "").trim()}
              >
                {trial.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]">
            {selectedTrial?.title || "Selected trial"}
          </span>
        )}
      </div>

      {isLoadingThreads ? (
        <div className="flex min-h-[252px] items-center justify-center text-[12px] font-medium text-[#75778B]">
          Loading thread metrics…
        </div>
      ) : (
        <>
          <div className="mt-7 flex w-full justify-center">
            <GradientCompletionGauge value={animatedResolutionRate} size={236} strokeWidth={18} />
          </div>
        </>
      )}
    </article>
  );
}

function NetBacklogTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | string | null }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  const resolveSeriesValue = (seriesKey: "opened" | "completed") => {
    const row = payload.find((entry) => String(entry?.dataKey || "") === seriesKey);
    const raw = row?.value;
    const numeric = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const opened = resolveSeriesValue("opened");
  const completed = resolveSeriesValue("completed");
  const net = opened - completed;

  return (
    <div className="rounded-[10px] border border-[#E2E5EB] bg-white px-3 py-2">
      <div className="mb-1 text-[12px] font-medium text-[#75778B]">{`Week of ${String(label || "")}`}</div>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0E0017]">
        <span className="h-[7px] w-[7px] rounded-full bg-[#0075FF]" />
        <span>{`Opened tasks : ${formatCompactCount(opened)}`}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#0E0017]">
        <span className="h-[7px] w-[7px] rounded-full bg-[#2CD9FF]" />
        <span>{`Completed tasks : ${formatCompactCount(completed)}`}</span>
      </div>
      <div className="mt-0.5 text-[12px] font-semibold text-[#0E0017]">{`Net tasks : ${net > 0 ? "+" : ""}${formatCompactCount(net)}`}</div>
    </div>
  );
}

type BlockedReasonStackShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  fillOpacity?: number;
  payload?: BlockedReasonTrialPoint;
  seriesKey: BlockedReasonSeriesKey;
  animate?: boolean;
};

function BlockedReasonStackShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fill = "#2F37D6",
  fillOpacity = 0.95,
  payload,
  seriesKey,
  animate = false,
}: BlockedReasonStackShapeProps) {
  if (!payload || width <= 0 || height <= 0) return null;

  const value = Number(payload[seriesKey] || 0);
  if (!Number.isFinite(value) || value <= 0) return null;

  const stackOrder = BLOCKED_REASON_SERIES.map((series) => series.key);
  const seriesIndex = stackOrder.indexOf(seriesKey);
  const valuesBelow = stackOrder
    .slice(0, Math.max(0, seriesIndex))
    .reduce((sum, key) => sum + Number(payload[key] || 0), 0);
  const pixelsPerUnit = height / value;
  const stackBaseY = y + height + valuesBelow * pixelsPerUnit;

  const topSeriesKey = [...BLOCKED_REASON_SERIES]
    .reverse()
    .find((series) => Number(payload[series.key] || 0) > 0)?.key;
  const topRadius = topSeriesKey === seriesKey ? Math.max(0, Math.min(4, width / 2, height)) : 0;
  const right = x + width;
  const bottom = y + height;
  const path = [
    `M ${x} ${bottom}`,
    `L ${x} ${y + topRadius}`,
    `Q ${x} ${y} ${x + topRadius} ${y}`,
    `L ${right - topRadius} ${y}`,
    `Q ${right} ${y} ${right} ${y + topRadius}`,
    `L ${right} ${bottom}`,
    "Z",
  ].join(" ");

  const animationStyle = animate
    ? ({
        transformBox: "view-box",
        transformOrigin: `${x + width / 2}px ${stackBaseY}px`,
        animation: "blockedStackBarWipeUp 750ms cubic-bezier(0.22,1,0.36,1) both",
      } as CSSProperties)
    : undefined;

  return (
    <path
      d={path}
      fill={fill}
      fillOpacity={fillOpacity}
      style={{ transition: "fill-opacity 180ms ease", ...animationStyle }}
    />
  );
}

function BlockedReasonsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    value?: number | string | null;
    payload?: BlockedReasonTrialPoint;
  }>;
}) {
  if (!active || !payload?.length) return null;

  const source = payload[0]?.payload;
  if (!source) return null;

  const rows = BLOCKED_REASON_SERIES.map((series) => {
    const row = payload.find((entry) => String(entry?.dataKey || "") === series.key);
    const raw = row?.value;
    const value = typeof raw === "number" ? raw : Number(raw);
    return {
      ...series,
      value: Number.isFinite(value) ? value : 0,
    };
  }).filter((row) => row.value > 0);
  const totalBlocked = source.total > 0 ? source.total : rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="rounded-[10px] border border-[#E2E5EB] bg-white px-3 py-2">
      <div className="mb-1 text-[12px] font-medium text-[#75778B]">{source.trialTitle}</div>
      {rows.map((row) => (
        <div key={row.key} className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#0E0017]">
          <span className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: row.color }} />
          <span>{`${row.label}: ${formatCompactCount(row.value)} (${totalBlocked > 0 ? Math.round((row.value / totalBlocked) * 100) : 0}%)`}</span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-[#EAECEF] pt-1 text-[12px] font-semibold text-[#0E0017]">
        Total blocked: {formatCompactCount(totalBlocked)}
      </div>
    </div>
  );
}

function StatusDonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: StatusDonutSlice }>;
}) {
  const slice = payload?.[0]?.payload;
  if (!active || !slice) return null;

  return (
    <div className="rounded-[10px] border border-[#E2E5EB] bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0E0017]">
        <span className="h-[8px] w-[8px] rounded-full" style={{ backgroundColor: slice.color }} />
        <span>{slice.label}</span>
      </div>
      <div className="mt-0.5 text-[12px] font-medium text-[#4f5570]">
        {formatCompactCount(slice.value)} tasks ({slice.percent}%)
      </div>
    </div>
  );
}

function MonthlyChannelTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | string | null }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  const resolveValue = (keys: string[]) => {
    const row = payload.find((entry) => keys.includes(String(entry?.dataKey || "")));
    const numeric = Number(row?.value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const openedTasks = resolveValue(["opened", "mobileApps"]);
  const completedTasks = resolveValue(["completed", "websites"]);

  return (
    <div className="rounded-[10px] border border-[#E2E5EB] bg-white px-3 py-2 text-[#0E0017] shadow-lg">
      <div className="mb-1 text-[12px] font-medium text-[#75778B]">{`Week of ${String(label || "")}`}</div>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0E0017]">
        <span className="h-[7px] w-[7px] rounded-full bg-[#0075FF]" />
        <span>{`Opened tasks: ${formatCompactCount(openedTasks)}`}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#0E0017]">
        <span className="h-[7px] w-[7px] rounded-full bg-[#2CD9FF]" />
        <span>{`Completed tasks: ${formatCompactCount(completedTasks)}`}</span>
      </div>
    </div>
  );
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDegrees: number) {
  const angle = (angleDegrees * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function buildArcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function buildSeriesPath(
  values: readonly number[],
  width: number,
  height: number,
  inset: number,
  domain?: { min: number; max: number }
) {
  if (!values.length) return "";
  const min = domain?.min ?? Math.min(...values);
  const max = domain?.max ?? Math.max(...values);
  const range = Math.max(1, max - min);
  const usableWidth = Math.max(1, width - inset * 2);
  const usableHeight = Math.max(1, height - inset * 2);
  const step = usableWidth / Math.max(1, values.length - 1);
  return values
    .map((value, index) => {
      const x = inset + index * step;
      const y = height - inset - ((value - min) / range) * usableHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function GradientCompletionGauge({
  value,
  size = 230,
  strokeWidth = 18,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
}) {
  const id = useId().replace(/:/g, "");
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const startAngle = 135;
  const endAngle = 405;
  const sweep = endAngle - startAngle;
  const arcPath = buildArcPath(center, center, radius, startAngle, endAngle);
  const arcLength = ((Math.PI * 2 * radius) * sweep) / 360;
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const progressLength = (arcLength * clamped) / 100;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={`gauge-stroke-${id}`} x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#DBB7FF" />
            <stop offset="50.5208%" stopColor="#0047FF" />
            <stop offset="100%" stopColor="#52D5FF" />
          </linearGradient>
          <filter id={`gauge-shadow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="4.5" floodColor="#F2EEE7" floodOpacity="1" />
            <feDropShadow dx="0" dy="-2" stdDeviation="8" floodColor="#F2EEE7" floodOpacity="1" />
          </filter>
        </defs>

        <path
          d={arcPath}
          fill="none"
          stroke="#BFE3F8"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d={arcPath}
          fill="none"
          stroke={`url(#gauge-stroke-${id})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${progressLength} ${arcLength}`}
          filter={`url(#gauge-shadow-${id})`}
        />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="text-5xl font-semibold leading-none tracking-tight text-[#0d0f12] max-sm:text-4xl">
          {clamped}%
        </span>
      </div>
    </div>
  );
}

function StudentBarConnector({
  height,
  index,
  fillColor,
}: {
  height: number;
  index: number;
  fillColor: string;
}) {
  const slope = Math.min(30, Math.max(8, Math.round(height * 0.35)));
  const filterId = `student-bar-connector-${index}`;
  const filterHeight = height + 14;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="19"
      height={height}
      viewBox={`0 0 19 ${height}`}
      fill="none"
      className="block h-full w-full"
      aria-hidden="true"
    >
      <g filter={`url(#${filterId})`}>
        <path d={`M0 0L19 ${slope}V${height}H0V0Z`} fill={fillColor} />
      </g>
      <defs>
        <filter
          id={filterId}
          x="0"
          y="0"
          width="19"
          height={filterHeight}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="14" />
          <feGaussianBlur stdDeviation="7" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0"
          />
          <feBlend mode="normal" in2="shape" result="effect1_innerShadow" />
        </filter>
      </defs>
    </svg>
  );
}

function StudentEnrollmentCard() {
  return (
    <div className="mt-4 rounded-[24px] border border-[#f5f5f5] bg-white p-[19px]">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-xl font-semibold leading-tight text-[#111111] max-sm:text-lg">Student Enrolment</p>
          <p className="mt-1 text-sm text-[#525252]">In last 30 days enrolment of students</p>
        </div>
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f2f2f2] text-[#525252]"
          aria-label="More options"
        >
          <MoreHorizontal className="h-6 w-6" />
        </button>
      </div>

      <div className="mb-4 flex items-center gap-8 max-sm:gap-5">
        <div>
          <p className="text-3xl font-semibold leading-[1] text-[#0a0a0a] max-sm:text-2xl">5489</p>
          <p className="mt-2 text-sm text-[#525252]">
            <span className="text-[#dc2626]">-16,97%</span> This month
          </p>
        </div>
        <div>
          <p className="text-3xl font-semibold leading-[1] text-[#0a0a0a] max-sm:text-2xl">1480</p>
          <p className="mt-2 text-sm text-[#525252]">
            <span className="text-[#099250]">+4.25%</span> This Week
          </p>
        </div>
      </div>

      <div className="flex h-[230px] w-full">
        <div className="flex h-full w-[30px] flex-col justify-between pr-2 text-[11px] text-[#525252]">
          {STUDENT_ENROLLMENT_AXIS.map((axis) => (
            <span key={axis}>{axis}</span>
          ))}
        </div>

        <div className="relative flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0">
            {[0, 20, 40, 60, 80, 100].map((row) => (
              <div
                key={`row-${row}`}
                className="absolute left-0 right-0 border-t border-[#1D170F]/10"
                style={{ top: `${row}%` }}
              />
            ))}
          </div>

          <div className="relative grid h-full grid-cols-7">
            {STUDENT_ENROLLMENT_BARS.map((item, index, allBars) => {
              const maxIndex = Math.max(1, allBars.length - 1);
              const bodyColor = studentBarColorAt(index / maxIndex);
              const connectorColor = studentBarColorAt(Math.min(1, (index + 0.45) / maxIndex));

              return (
                <div
                  key={`${item.amount}-${index}`}
                  className={`relative border-r border-[#f5f5f5] ${item.highlighted ? "bg-[#eff8ff]" : ""} ${item.final ? "border-r-0" : ""}`}
                >
                <p
                  className={`absolute left-3 top-2 text-[8px] leading-[10px] text-[#525252]`}
                >
                  This month
                </p>
                <p
                  className={`absolute left-3 top-5 text-sm leading-5 tracking-[-0.12px] ${
                    item.highlighted ? "font-semibold text-[#0a0a0a]" : "font-normal text-[#525252]"
                  }`}
                >
                  {item.amount}
                </p>

                <div className="absolute bottom-0 left-0 right-0">
                  <div
                    className="relative"
                    style={{ height: item.height }}
                  >
                    <div
                      className="absolute bottom-0 left-0"
                      style={{
                        width: item.final ? "100%" : "calc(100% - 19px)",
                        height: "100%",
                        backgroundColor: bodyColor,
                      }}
                    />
                    {!item.final && (
                      <div className="absolute bottom-0 right-0 w-[19px]" style={{ height: item.height }}>
                        <StudentBarConnector height={item.height} index={index} fillColor={connectorColor} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrafficSourcesCard() {
  const totalTraffic = TRAFFIC_SOURCES.reduce((sum, source) => sum + source.value, 0);
  const chartWidth = 424;
  const chartHeight = 212;
  const centerX = chartWidth / 2;
  const centerY = chartHeight;
  const radius = 188;
  const trackThickness = 44;
  const segmentThickness = 34;
  const endInsetDegrees = 0.9;
  const sweep = 180;
  const startAngle = 180;
  let cursor = startAngle;
  const splitAngles: number[] = [];

  const segments = TRAFFIC_SOURCES.map((source, index) => {
    const segmentSweep = (source.value / Math.max(totalTraffic, 1)) * sweep;
    const segmentStart = cursor;
    const segmentEnd = segmentStart + segmentSweep;
    cursor = segmentEnd;
    if (index < TRAFFIC_SOURCES.length - 1) splitAngles.push(segmentEnd);
    return { ...source, segmentStart, segmentEnd };
  });

  return (
    <div className="mt-4 rounded-[24px] border border-[#f5f5f5] bg-white p-[19px]">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xl font-semibold leading-tight text-[#111111]">Traffic Sources</p>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-sm font-medium text-[#0a0a0a]"
        >
          30 Days
          <ChevronDown className="h-4 w-4 text-[#0a0a0a]" />
        </button>
      </div>

      <div className="relative mx-auto h-[212px] w-full max-w-[424px] overflow-hidden">
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="relative z-10 h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <path
            d={buildArcPath(centerX, centerY, radius, startAngle, startAngle + sweep)}
            fill="none"
            stroke="#F5F5F5"
            strokeWidth={trackThickness}
            strokeLinecap="butt"
          />

          {segments.map((segment, segmentIndex) => {
            const drawStart =
              segmentIndex === 0 ? segment.segmentStart + endInsetDegrees : segment.segmentStart;
            const drawEnd =
              segmentIndex === segments.length - 1
                ? segment.segmentEnd - endInsetDegrees
                : segment.segmentEnd;
            return (
              <path
                key={segment.label}
                d={buildArcPath(centerX, centerY, radius, drawStart, drawEnd)}
                fill="none"
                stroke={segment.color}
                strokeWidth={segmentThickness}
                strokeLinecap="butt"
              />
            );
          })}

          {splitAngles.map((angle) => {
            const inner = polarToCartesian(centerX, centerY, radius - segmentThickness / 2, angle);
            const outer = polarToCartesian(centerX, centerY, radius + segmentThickness / 2, angle);
            return (
              <line
                key={`split-${angle}`}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke="#F5F5F5"
                strokeWidth="2"
              />
            );
          })}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end pb-[56px]">
          <p className="text-base text-[#0a0a0a]">Total</p>
          <p className="mt-1 text-[36px] font-semibold leading-[1] tracking-[-0.3px] text-[#0a0a0a]">
            {totalTraffic.toLocaleString("de-DE")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-[#0a0a0a] sm:grid-cols-4">
        {TRAFFIC_SOURCES.map((source) => (
          <div key={source.label} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: source.color }} />
            <span>{source.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#f5f5f5] px-3 py-2.5 text-sm text-[#0a0a0a]">
        <Info className="h-4 w-4 shrink-0 text-[#0a0a0a]" />
        <p>Traffic channels have beed generating the most traffics over past days.</p>
      </div>
    </div>
  );
}

function UpcomingWorkloadPanel({
  trials,
  taskRows,
  phaseRows,
}: {
  trials: AnalyticsTrialOption[];
  taskRows: TaskTimelineRow[];
  phaseRows: PhaseTimelineRow[];
}) {
  const [selectedTrialId, setSelectedTrialId] = useState("all");
  const [chartHeight, setChartHeight] = useState(296);
  const sectionRef = useRef<HTMLElement | null>(null);
  const chartAreaRef = useRef<HTMLDivElement | null>(null);
  const canReplayWorkloadBarsRef = useRef(true);
  const [workloadAnimationNonce, setWorkloadAnimationNonce] = useState(0);
  const [animateWorkloadBars, setAnimateWorkloadBars] = useState(true);

  useEffect(() => {
    if (selectedTrialId === "all") return;
    if (!trials.some((trial) => trial.id === selectedTrialId)) {
      setSelectedTrialId("all");
    }
  }, [selectedTrialId, trials]);

  useEffect(() => {
    if (!animateWorkloadBars || typeof window === "undefined") return;
    const timeoutId = window.setTimeout(() => setAnimateWorkloadBars(false), 780);
    return () => window.clearTimeout(timeoutId);
  }, [animateWorkloadBars, workloadAnimationNonce]);

  useEffect(() => {
    const node = chartAreaRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const ratio = Number(entry.intersectionRatio || 0);
        const isClearlyVisible = entry.isIntersecting && ratio >= 0.12;
        const isClearlyOut = !entry.isIntersecting || ratio <= 0.01;

        if (isClearlyVisible && canReplayWorkloadBarsRef.current) {
          canReplayWorkloadBarsRef.current = false;
          setAnimateWorkloadBars(true);
          setWorkloadAnimationNonce((value) => value + 1);
        }

        if (isClearlyOut) {
          canReplayWorkloadBarsRef.current = true;
        }
      },
      { threshold: [0, 0.05, 0.12] }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const workloadData = useMemo(() => {
    const scopedRows =
      selectedTrialId === "all"
        ? taskRows
        : taskRows.filter((row) => normalizeTrialId(row.trialId) === normalizeTrialId(selectedTrialId));
    const scopedPhaseRows =
      selectedTrialId === "all"
        ? phaseRows
        : phaseRows.filter((row) => normalizeTrialId(row.trialId) === normalizeTrialId(selectedTrialId));

    const weekCount = 12;
    const firstWeekStart = startOfWeekDate(new Date());
    const weekStarts = Array.from({ length: weekCount }, (_, index) => {
      const date = new Date(firstWeekStart);
      date.setDate(firstWeekStart.getDate() + index * 7);
      return date;
    });
    const windowEnd = new Date(weekStarts[weekStarts.length - 1]);
    windowEnd.setDate(windowEnd.getDate() + 7);

    const buckets = weekStarts.map(() => ({
      tasks: 0,
      visits: 0,
    }));

    const phaseAnchorById = new Map<string, Date>();
    for (const row of scopedPhaseRows) {
      const phaseId = String(row.phase.id || "");
      if (!phaseId) continue;
      const anchor =
        parseDateValue(row.phase.estimatedDate) ??
        parseDateValue(row.phase.windowStart) ??
        parseDateValue(row.phase.windowEnd);
      if (anchor) phaseAnchorById.set(phaseId, anchor);
    }

    const clampWeekIndex = (value: number) => Math.max(0, Math.min(buckets.length - 1, value));

    for (const row of scopedRows) {
      if (isDoneStatus(row.task.status)) continue;

      let anchorDate = parseDateValue(row.task.dueDate) ?? parseDateValue(row.task.suggestedDate);
      const phaseAnchor = row.task.phaseId ? phaseAnchorById.get(String(row.task.phaseId)) ?? null : null;
      const taskOrder = Number(row.task.orderInPhase ?? 0);

      if (!anchorDate && phaseAnchor) {
        anchorDate = addDays(phaseAnchor, Number.isFinite(taskOrder) ? taskOrder * 3 : 0);
      }

      if (!anchorDate) continue;

      const anchorWeekStart = startOfWeekDate(anchorDate);
      if (anchorWeekStart.getTime() < firstWeekStart.getTime()) continue;
      if (anchorWeekStart.getTime() >= windowEnd.getTime()) continue;
      const weekIndex = weeksBetweenWeekStarts(firstWeekStart, anchorWeekStart);
      const bucket = buckets[clampWeekIndex(weekIndex)];
      if (!bucket) continue;
      bucket.tasks += 1;
    }

    for (const row of scopedPhaseRows) {
      const phaseType = String(row.phase.phaseType || "").toLowerCase();
      if (!phaseType || phaseType === "screen_fail" || phaseType === "early_termination") continue;

      const anchorDate =
        parseDateValue(row.phase.estimatedDate) ??
        parseDateValue(row.phase.windowStart) ??
        parseDateValue(row.phase.windowEnd);
      if (!anchorDate) continue;

      const anchorWeekStart = startOfWeekDate(anchorDate);
      if (anchorWeekStart.getTime() < firstWeekStart.getTime()) continue;
      if (anchorWeekStart.getTime() >= windowEnd.getTime()) continue;
      const weekIndex = weeksBetweenWeekStarts(firstWeekStart, anchorWeekStart);

      const bucket = buckets[clampWeekIndex(weekIndex)];
      if (!bucket) continue;
      bucket.visits += phaseType === "treatment_visit" ? 2 : 1;
    }

    const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
    const points: WorkloadPoint[] = weekStarts.map((weekStart, index) => {
      const bucket = buckets[index];
      return {
        label: formatter.format(weekStart),
        tasks: bucket.tasks,
        visits: bucket.visits,
      };
    });

    const { yAxisMax, yAxisTicks } = computeWorkloadYAxis(points);
    const totalTasks = points.reduce((sum, point) => sum + point.tasks, 0);
    const totalVisits = points.reduce((sum, point) => sum + point.visits, 0);
    const hasSignal = points.some((point) => point.tasks > 0 || point.visits > 0);

    return {
      points,
      yAxisMax,
      yAxisTicks,
      totalTasks,
      totalVisits,
      hasSignal,
    };
  }, [phaseRows, selectedTrialId, taskRows]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId: number | null = null;

    const syncChartHeightToViewport = () => {
      const sectionElement = sectionRef.current;
      const chartElement = chartAreaRef.current;
      if (!sectionElement || !chartElement) return;

      const sectionRect = sectionElement.getBoundingClientRect();
      const chartRect = chartElement.getBoundingClientRect();
      if (sectionRect.top >= window.innerHeight) return;

      const storedGap = Number(window.localStorage.getItem(COLLAB_CARD_BOTTOM_GAP_STORAGE_KEY) || "");
      const targetBottomGap = Number.isFinite(storedGap) && storedGap >= 0 ? storedGap : 4;
      const nonChartHeight = sectionRect.height - chartRect.height;
      const desiredChartHeight = Math.round(
        window.innerHeight - targetBottomGap - sectionRect.top - nonChartHeight
      );
      const clampedHeight = Math.max(240, Math.min(520, desiredChartHeight));

      setChartHeight((previous) => (Math.abs(previous - clampedHeight) > 1 ? clampedHeight : previous));
    };

    const scheduleSync = () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(syncChartHeightToViewport);
    };

    scheduleSync();
    const timeoutId = window.setTimeout(scheduleSync, 120);
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("scroll", scheduleSync, { passive: true });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("scroll", scheduleSync);
    };
  }, [selectedTrialId, workloadData.totalTasks, workloadData.totalVisits]);

  return (
    <section
      ref={sectionRef}
      className="relative mb-2 overflow-hidden rounded-lg border border-gray-200 bg-white px-6 pb-7 pt-5"
    >
      <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
        <LayoutGrid className="h-4 w-4 text-primary" />
      </span>

      <div className="mb-5 pr-14">
        <h2 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Upcoming workload</h2>
        <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
          Next 12 weeks · projected open tasks and visits
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div className="inline-flex items-center gap-10">
          <div>
            <p className="text-[12px] font-medium leading-[16px] text-[#75778B]">Tasks due</p>
            <p className="mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
              {formatCompactCount(workloadData.totalTasks)}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium leading-[16px] text-[#75778B]">Visits planned</p>
            <p className="mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
              {formatCompactCount(workloadData.totalVisits)}
            </p>
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-end gap-4">
          <div className="inline-flex items-center gap-5 text-[13px] font-medium text-[#75778B]">
            <span className="inline-flex items-center gap-2">
              <span className="h-[10px] w-[10px] rounded-[3px] bg-[#1F5FEA]" />
              Tasks
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-[10px] w-[10px] rounded-[3px] bg-[#B4C2FF]" />
              Visits
            </span>
          </div>

          <select
            value={selectedTrialId}
            onChange={(event) => {
              setAnimateWorkloadBars(false);
              setSelectedTrialId(event.target.value);
            }}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]"
          >
            <option value="all">All trials</option>
            {trials.map((trial) => (
              <option key={trial.id} value={trial.id}>
                {trial.title}
              </option>
            ))}
          </select>

          <span className="inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]">
            Next 12 weeks
          </span>
        </div>
      </div>

      {!workloadData.hasSignal && (
        <p className="-mt-2 mb-4 text-[12px] font-medium text-[#75778B]">
          No scheduled open tasks or visit dates found in the next 12 weeks for this trial.
        </p>
      )}

      <style>{`
        @keyframes workloadBarWipeUp {
          from {
            transform: scaleY(0);
          }
          to {
            transform: scaleY(1);
          }
        }
      `}</style>

      <div ref={chartAreaRef} style={{ height: `${chartHeight}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            key={`upcoming-workload-chart-${workloadAnimationNonce}`}
            data={workloadData.points}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            barCategoryGap="8%"
            barGap={-12}
          >
            <CartesianGrid stroke="rgba(185,193,217,0.26)" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#75778B" }}
              interval={0}
              tickFormatter={(value) => String(value)}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#75778B" }}
              width={30}
              allowDecimals={false}
              ticks={workloadData.yAxisTicks}
              domain={[0, workloadData.yAxisMax]}
            />
            <Tooltip
              cursor={{ fill: "rgba(147,160,197,0.12)" }}
              content={<WorkloadTooltip />}
            />
            <Bar
              dataKey="tasks"
              name="tasks"
              fill="#1F5FEA"
              maxBarSize={24}
              fillOpacity={0.95}
              isAnimationActive={false}
              shape={(props: { x?: number; y?: number; width?: number; height?: number; fill?: string }) => (
                <WorkloadBarShape {...props} barKey="tasks" animate={animateWorkloadBars} />
              )}
            />
            <Bar
              dataKey="visits"
              name="visits"
              fill="#B4C2FF"
              maxBarSize={24}
              fillOpacity={0.9}
              isAnimationActive={false}
              shape={(props: { x?: number; y?: number; width?: number; height?: number; fill?: string }) => (
                <WorkloadBarShape {...props} barKey="visits" animate={animateWorkloadBars} />
              )}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function NetBacklogWorkloadPanel({
  trials,
  taskRows,
}: {
  trials: AnalyticsTrialOption[];
  taskRows: TaskTimelineRow[];
}) {
  const gradientSeed = useId().replace(/:/g, "");
  const openedAreaGradientId = `net-backlog-opened-area-${gradientSeed}`;
  const completedAreaGradientId = `net-backlog-completed-area-${gradientSeed}`;
  const horizontalGridGradientId = `net-backlog-grid-h-${gradientSeed}`;
  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const [selectedTrialId, setSelectedTrialId] = useState("all");
  const [windowWeeks, setWindowWeeks] = useState<4 | 8 | 12>(12);
  const [chartAnimationNonce, setChartAnimationNonce] = useState(0);

  useEffect(() => {
    if (selectedTrialId === "all") return;
    if (!trials.some((trial) => trial.id === selectedTrialId)) {
      setSelectedTrialId("all");
    }
  }, [selectedTrialId, trials]);

  useEffect(() => {
    const node = chartViewportRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    let initialized = false;
    let wasVisible = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          if (!initialized) {
            initialized = true;
            wasVisible = true;
            return;
          }
          if (!wasVisible) {
            setChartAnimationNonce((value) => value + 1);
          }
          wasVisible = true;
        } else {
          initialized = true;
          wasVisible = false;
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const backlogData = useMemo(() => {
    const scopedRows =
      selectedTrialId === "all"
        ? taskRows
        : taskRows.filter((row) => normalizeTrialId(row.trialId) === normalizeTrialId(selectedTrialId));

    const rollingWindow = 2;
    const historyWeeks = Math.max(24, windowWeeks * 2);
    const currentWeekStart = startOfWeekDate(new Date());
    const weekStarts = Array.from({ length: historyWeeks }, (_, index) =>
      addDays(currentWeekStart, -(historyWeeks - 1 - index) * 7)
    );
    const keyForDate = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const indexByWeek = new Map<string, number>(weekStarts.map((date, index) => [keyForDate(date), index]));
    const resolveWeekIndex = (date: Date | null) => {
      if (!date) return undefined;
      return indexByWeek.get(keyForDate(startOfWeekDate(date)));
    };
    const openedRaw = Array.from({ length: historyWeeks }, () => 0);
    const completedRaw = Array.from({ length: historyWeeks }, () => 0);

    for (const row of scopedRows) {
      const task = row.task;
      const openedAt = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
      if (openedAt) {
        const openedIndex = resolveWeekIndex(openedAt);
        if (openedIndex !== undefined) openedRaw[openedIndex] += 1;
      }

      const done = isDoneStatus(task.status);
      if (!done) {
        continue;
      }
      let completedAt = parseDateValue(task.completedDate);
      const updatedAt = parseDateValue(task.updatedAt);
      let completedIndex = resolveWeekIndex(completedAt);
      if (completedAt === null && completedIndex === undefined) {
        completedAt = updatedAt ?? openedAt;
        completedIndex = resolveWeekIndex(completedAt);
      }
      if (completedIndex !== undefined) {
        completedRaw[completedIndex] += 1;
      }
    }

    const displayStart = Math.max(0, weekStarts.length - windowWeeks);
    const displayWeekStarts = weekStarts.slice(displayStart);
    const displayOpenedRaw = openedRaw.slice(displayStart);
    const displayCompletedRaw = completedRaw.slice(displayStart);
    const toRolling = (values: number[]) =>
      values.map((_, index) => {
        const start = Math.max(0, index - rollingWindow + 1);
        return values.slice(start, index + 1).reduce((sum, value) => sum + value, 0);
      });

    const opened = toRolling(displayOpenedRaw);
    const completed = toRolling(displayCompletedRaw);
    const weekFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
    const points: BacklogPoint[] = displayWeekStarts.map((weekStart, index) => {
      const openedValue = opened[index] ?? 0;
      const completedValue = completed[index] ?? 0;
      return {
        label: weekFormatter.format(weekStart),
        opened: openedValue,
        completed: completedValue,
        net: openedValue - completedValue,
      };
    });

    const currentWindowNet = displayOpenedRaw.reduce((sum, openedValue, index) => {
      return sum + (openedValue - (displayCompletedRaw[index] ?? 0));
    }, 0);
    const previousStart = Math.max(0, displayStart - windowWeeks);
    const previousOpenedRaw = openedRaw.slice(previousStart, displayStart);
    const previousCompletedRaw = completedRaw.slice(previousStart, displayStart);
    const previousWindowNet = previousOpenedRaw.reduce((sum, openedValue, index) => {
      return sum + (openedValue - (previousCompletedRaw[index] ?? 0));
    }, 0);
    const changeFromPrevious = currentWindowNet - previousWindowNet;
    const improving = changeFromPrevious <= 0;
    const { yAxisMax, yAxisTicks } = computeBacklogYAxis(
      points.reduce((max, point) => Math.max(max, point.opened, point.completed), 0)
    );
    const hasSignal = points.some((point) => point.opened > 0 || point.completed > 0);

    return {
      points,
      rollingWindow,
      currentWindowNet,
      changeFromPrevious,
      improving,
      yAxisMax,
      yAxisTicks,
      hasSignal,
    };
  }, [selectedTrialId, taskRows, windowWeeks]);

  const deltaDisplay = `${backlogData.currentWindowNet > 0 ? "+" : ""}${formatCompactCount(backlogData.currentWindowNet)}`;
  const changeDisplay = `${backlogData.changeFromPrevious > 0 ? "+" : ""}${formatCompactCount(backlogData.changeFromPrevious)}`;
  const chartMargin = { top: 14, right: 14, left: 8, bottom: 0 } as const;
  const chartYAxisWidth = 44;
  const chartXAxisHeight = 50;
  const gridColumns = Math.max(1, backlogData.points.length - 1);
  const primaryVerticalGridColumnSize = `${100 / gridColumns}% 100%`;
  const secondaryVerticalGridColumnSize = `${100 / (gridColumns * 2)}% 100%`;

  return (
    <section className="relative mb-2 overflow-hidden rounded-lg border border-gray-200 bg-white px-6 pb-7 pt-5">
      <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
        <LayoutGrid className="h-4 w-4 text-primary" />
      </span>

      <div className="mb-5 pr-14">
        <h2 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Net backlog delta</h2>
        <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
          Last {windowWeeks} weeks · opened vs completed tasks
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div className="inline-flex items-center gap-[14px]">
          <p className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">{deltaDisplay}</p>
          <span
            className={`inline-flex items-center gap-[6px] rounded-[2px] border-[0.6px] px-[6px] py-[3px] text-[12px] font-medium leading-[14px] ${
              backlogData.improving
                ? "border-[rgba(5,193,104,0.20)] bg-[rgba(5,193,104,0.20)] text-[#14CA74]"
                : "border-[rgba(255,90,101,0.20)] bg-[rgba(255,90,101,0.20)] text-[#FF5A65]"
            }`}
          >
            {changeDisplay}
            {backlogData.improving ? (
              <ArrowDownRight className="h-[18px] w-[18px]" />
            ) : (
              <ArrowUpRight className="h-[18px] w-[18px]" />
            )}
          </span>
          <span className="text-[11px] font-medium leading-[13px] text-[#75778B]">
            vs prior {windowWeeks} weeks
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-end gap-4">
          <div className="inline-flex items-center gap-5 text-[13px] font-medium text-[#75778B]">
            <span className="inline-flex items-center gap-2">
              <span className="h-[2px] w-5 rounded-full bg-[#0075FF]" />
              Opened tasks
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-[2px] w-5 rounded-full bg-[#2CD9FF]" />
              Completed tasks
            </span>
            <span className="text-[11px] text-[#75778B]/80">{backlogData.rollingWindow}-week rolling</span>
          </div>

          <select
            value={selectedTrialId}
            onChange={(event) => setSelectedTrialId(event.target.value)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]"
          >
            <option value="all">All trials</option>
            {trials.map((trial) => (
              <option key={trial.id} value={trial.id}>
                {trial.title}
              </option>
            ))}
          </select>

          <select
            value={String(windowWeeks)}
            onChange={(event) => setWindowWeeks(Number(event.target.value) as 4 | 8 | 12)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]"
          >
            <option value="4">Last 4 weeks</option>
            <option value="8">Last 8 weeks</option>
            <option value="12">Last 12 weeks</option>
          </select>
        </div>
      </div>

      {!backlogData.hasSignal && (
        <p className="-mt-2 mb-4 text-[12px] font-medium text-[#75778B]">
          No opened/completed task activity found for the selected time window.
        </p>
      )}

      <div ref={chartViewportRef} className="relative h-[360px]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-0"
          style={{
            left: `${chartMargin.left + chartYAxisWidth}px`,
            right: `${chartMargin.right}px`,
            top: `${chartMargin.top}px`,
            bottom: `${chartXAxisHeight}px`,
            backgroundImage: [
              "linear-gradient(to right, rgba(185,193,217,0.26) 1px, transparent 1px)",
              "linear-gradient(to right, rgba(185,193,217,0.26) 1px, transparent 1px)",
            ].join(", "),
            backgroundSize: `${primaryVerticalGridColumnSize}, ${secondaryVerticalGridColumnSize}`,
            WebkitMaskImage:
              "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 58%, rgba(0,0,0,0.18) 100%)",
            maskImage:
              "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 58%, rgba(0,0,0,0.18) 100%)",
          }}
        />
        <ResponsiveContainer width="100%" height="100%" className="relative z-10">
          <AreaChart key={`net-backlog-chart-${chartAnimationNonce}`} data={backlogData.points} margin={chartMargin}>
            <defs>
              <linearGradient id={openedAreaGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0075FF" stopOpacity={0.8} />
                <stop offset="100%" stopColor="#0075FF" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={completedAreaGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2CD9FF" stopOpacity={0.8} />
                <stop offset="100%" stopColor="#2CD9FF" stopOpacity={0} />
              </linearGradient>
              <linearGradient
                id={horizontalGridGradientId}
                x1="0"
                y1="310"
                x2="0"
                y2="14"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="rgba(185,193,217,0.26)" />
                <stop offset="58%" stopColor="rgba(185,193,217,0.16)" />
                <stop offset="100%" stopColor="rgba(185,193,217,0.08)" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={`url(#${horizontalGridGradientId})`} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#8b8d93" }}
              interval={0}
              tickFormatter={(value) => String(value)}
              dy={14}
              height={chartXAxisHeight}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#8b8d93" }}
              width={44}
              allowDecimals={false}
              ticks={backlogData.yAxisTicks}
              domain={[0, backlogData.yAxisMax]}
            />
            <Tooltip
              cursor={{ fill: "rgba(147,160,197,0.12)" }}
              content={<NetBacklogTooltip />}
            />
            <Area
              type="linear"
              dataKey="opened"
              stroke="#0075FF"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={`url(#${openedAreaGradientId})`}
              fillOpacity={1}
              dot={false}
              isAnimationActive
              animationDuration={750}
              animationEasing="ease-out"
              activeDot={{ r: 5, fill: "#FFFFFF", stroke: "#0075FF", strokeWidth: 3 }}
            />
            <Area
              type="linear"
              dataKey="completed"
              stroke="#2CD9FF"
              strokeWidth={2.3}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={`url(#${completedAreaGradientId})`}
              fillOpacity={1}
              dot={false}
              isAnimationActive
              animationDuration={750}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function BlockedReasonsByTrialPanel({
  trials,
  taskRows,
  blockedDeltaPercent,
}: {
  trials: AnalyticsTrialOption[];
  taskRows: TaskTimelineRow[];
  blockedDeltaPercent: number;
}) {
  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const [blockedReasonsAnimationNonce, setBlockedReasonsAnimationNonce] = useState(0);
  const [animateBlockedReasonBars, setAnimateBlockedReasonBars] = useState(true);
  const [hoveredSeriesKey, setHoveredSeriesKey] = useState<BlockedReasonSeriesKey | null>(null);

  useEffect(() => {
    if (!animateBlockedReasonBars || typeof window === "undefined") return;
    const timeoutId = window.setTimeout(() => setAnimateBlockedReasonBars(false), 780);
    return () => window.clearTimeout(timeoutId);
  }, [animateBlockedReasonBars, blockedReasonsAnimationNonce]);

  useEffect(() => {
    const node = chartViewportRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    let initialized = false;
    let wasVisible = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          if (!initialized) {
            initialized = true;
            wasVisible = true;
            return;
          }
          if (!wasVisible) {
            setAnimateBlockedReasonBars(true);
            setBlockedReasonsAnimationNonce((value) => value + 1);
          }
          wasVisible = true;
        } else {
          initialized = true;
          wasVisible = false;
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const trialTitleById = useMemo(
    () => new Map(trials.map((trial) => [normalizeTrialId(trial.id), trial.title])),
    [trials]
  );

  const data = useMemo(() => {
    const rowsByTrial = new Map<string, BlockedReasonTrialPoint>();

    for (const row of taskRows) {
      const statusToken = normalizeStatus(row.task.status);
      if (statusToken !== "blocked" && statusToken !== "waiting") continue;

      const trialId = normalizeTrialId(row.trialId);
      if (!trialId) continue;

      const trialTitle = trialTitleById.get(trialId) || trialId;
      const trialLabel = toCompactTrialLabel(trialTitle);
      const bucket =
        rowsByTrial.get(trialId) ??
        {
          trialId,
          trialLabel,
          trialTitle,
          total: 0,
          external: 0,
          internal: 0,
          patient: 0,
          systemData: 0,
          scheduledTiming: 0,
        };

      const category = resolveBlockedReasonCategory(row.task.blockedReason);
      if (category === "External") bucket.external += 1;
      else if (category === "Patient") bucket.patient += 1;
      else if (category === "System/Data") bucket.systemData += 1;
      else if (category === "Scheduled/Timing") bucket.scheduledTiming += 1;
      else bucket.internal += 1;

      bucket.total += 1;
      rowsByTrial.set(trialId, bucket);
    }

    return Array.from(rowsByTrial.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.trialLabel.localeCompare(b.trialLabel);
    });
  }, [taskRows, trialTitleById]);

  const totalBlocked = useMemo(() => data.reduce((sum, row) => sum + row.total, 0), [data]);
  const trialsWithBlockers = data.length;
  const maxStack = useMemo(() => data.reduce((max, row) => Math.max(max, row.total), 0), [data]);
  const { yAxisMax, yAxisTicks } = useMemo(
    () => computeBacklogYAxis(Math.max(1, maxStack)),
    [maxStack]
  );
  const hasSignal = totalBlocked > 0;
  const normalizedBlockedDeltaPercent = Number.isFinite(blockedDeltaPercent) ? blockedDeltaPercent : 0;
  const blockedBadgeTonePositive = normalizedBlockedDeltaPercent <= 0;
  const blockedBadgeDirectionUp = normalizedBlockedDeltaPercent >= 0;
  const blockedBadgeText = `${Math.abs(normalizedBlockedDeltaPercent).toFixed(0)}%`;
  const resolveSeriesOpacity = (seriesKey: BlockedReasonSeriesKey) => {
    if (!hoveredSeriesKey) return 0.95;
    return hoveredSeriesKey === seriesKey ? 1 : 0.45;
  };

  return (
    <section className="relative mb-2 overflow-hidden rounded-lg border border-gray-200 bg-white px-6 pb-7 pt-5">
      <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
        <AlertTriangle className="h-4 w-4 text-primary" />
      </span>

      <div className="mb-5 pr-14">
        <h2 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Blocked reasons by trial</h2>
        <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
          Current blocked tasks · category mix across trials
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div className="inline-flex items-center gap-10">
          <div>
            <p className="text-[12px] font-medium leading-[16px] text-[#75778B]">Blocked tasks</p>
            <div className="mt-2 inline-flex items-center gap-[14px]">
              <p className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
                {formatCompactCount(totalBlocked)}
              </p>
              <div className="inline-flex items-center gap-2">
                <span
                  className={`flex flex-col items-start gap-[10px] rounded-[2px] border-[0.6px] px-[6px] py-[3px] ${
                    blockedBadgeTonePositive
                      ? "border-[rgba(5,193,104,0.20)] bg-[rgba(5,193,104,0.20)]"
                      : "border-[rgba(255,90,101,0.20)] bg-[rgba(255,90,101,0.20)]"
                  }`}
                >
                  <span
                    className={`inline-flex items-center gap-[6px] text-[12px] font-medium leading-[14px] ${
                      blockedBadgeTonePositive ? "text-[#14CA74]" : "text-[#FF5A65]"
                    }`}
                  >
                    {blockedBadgeText}
                    {blockedBadgeDirectionUp ? (
                      <ArrowUpRight className="h-[18px] w-[18px]" />
                    ) : (
                      <ArrowDownRight className="h-[18px] w-[18px]" />
                    )}
                  </span>
                </span>
                <span className="text-[11px] font-medium leading-[13px] text-[#75778B]">from last week</span>
              </div>
            </div>
          </div>
          <div>
            <p className="text-[12px] font-medium leading-[16px] text-[#75778B]">Trials with blockers</p>
            <p className="mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
              {formatCompactCount(trialsWithBlockers)}
            </p>
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-end gap-4">
          <div className="inline-flex flex-wrap items-center gap-4 text-[13px] font-medium text-[#75778B]">
            {BLOCKED_REASON_SERIES.map((series) => (
              <button
                key={series.key}
                type="button"
                className="inline-flex items-center gap-2 transition-opacity duration-200"
                style={{ opacity: resolveSeriesOpacity(series.key) }}
                onMouseEnter={() => setHoveredSeriesKey(series.key)}
                onMouseLeave={() => setHoveredSeriesKey(null)}
                onFocus={() => setHoveredSeriesKey(series.key)}
                onBlur={() => setHoveredSeriesKey(null)}
              >
                <span className="h-[10px] w-[10px] rounded-[3px]" style={{ backgroundColor: series.color }} />
                {series.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!hasSignal && (
        <p className="-mt-2 mb-4 text-[12px] font-medium text-[#75778B]">
          No blocked tasks found for the selected workspace.
        </p>
      )}

      <style>{`
        @keyframes blockedStackBarWipeUp {
          from {
            transform: scaleY(0);
          }
          to {
            transform: scaleY(1);
          }
        }
      `}</style>

      <div ref={chartViewportRef} className="h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            key={`blocked-reasons-chart-${blockedReasonsAnimationNonce}`}
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 16 }}
            barCategoryGap="16%"
          >
            <CartesianGrid stroke="rgba(185,193,217,0.26)" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="trialLabel"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#75778B" }}
              interval={0}
              dy={12}
              height={48}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#75778B" }}
              width={32}
              allowDecimals={false}
              ticks={yAxisTicks}
              domain={[0, yAxisMax]}
            />
            <Tooltip cursor={{ fill: "rgba(147,160,197,0.12)" }} content={<BlockedReasonsTooltip />} />
            {BLOCKED_REASON_SERIES.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                stackId="blockedReasons"
                name={series.label}
                fill={series.color}
                fillOpacity={resolveSeriesOpacity(series.key)}
                maxBarSize={40}
                isAnimationActive={false}
                shape={(shapeProps: any) => (
                  <BlockedReasonStackShape
                    {...shapeProps}
                    seriesKey={series.key}
                    animate={animateBlockedReasonBars}
                  />
                )}
                onMouseEnter={() => setHoveredSeriesKey(series.key)}
                onMouseLeave={() => setHoveredSeriesKey(null)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function DarkRevenuePerformancePanel({
  trials,
  taskRows,
}: {
  trials: AnalyticsTrialOption[];
  taskRows: TaskTimelineRow[];
}) {
  const gradientId = useId().replace(/:/g, "");
  const [selectedTrialId, setSelectedTrialId] = useState("all");
  const [windowWeeks, setWindowWeeks] = useState<4 | 8 | 12>(12);

  useEffect(() => {
    if (selectedTrialId === "all") return;
    if (!trials.some((trial) => trial.id === selectedTrialId)) {
      setSelectedTrialId("all");
    }
  }, [selectedTrialId, trials]);

  const filteredTaskRows = useMemo(
    () =>
      selectedTrialId === "all"
        ? taskRows
        : taskRows.filter(
            (row) => normalizeTrialId(row.trialId) === normalizeTrialId(selectedTrialId)
          ),
    [selectedTrialId, taskRows]
  );

  const trendSeries = useMemo(() => {
    const startOfWeek = (source: Date) => {
      const date = new Date(source.getFullYear(), source.getMonth(), source.getDate());
      const day = date.getDay();
      const daysFromMonday = (day + 6) % 7;
      date.setDate(date.getDate() - daysFromMonday);
      date.setHours(0, 0, 0, 0);
      return date;
    };
    const keyForDate = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

    const historyWeeks = Math.max(24, windowWeeks * 2);
    const currentWeekStart = startOfWeek(new Date());
    const weeks = Array.from({ length: historyWeeks }, (_, index) => {
      const date = new Date(currentWeekStart);
      date.setDate(currentWeekStart.getDate() - (historyWeeks - 1 - index) * 7);
      return date;
    });
    const indexByWeek = new Map<string, number>(
      weeks.map((date, index) => [keyForDate(date), index])
    );
    const resolveWeekIndex = (date: Date | null) => {
      if (!date) return undefined;
      return indexByWeek.get(keyForDate(startOfWeek(date)));
    };
    const opened = Array.from({ length: historyWeeks }, () => 0);
    const completed = Array.from({ length: historyWeeks }, () => 0);

    const resolveOpenedAnchor = (task: WorkspaceTask) => {
      const createdAt = parseDateValue(task.createdAt) ?? parseDateValue(task.updatedAt);
      if (!createdAt) return null;
      return createdAt;
    };

    for (const row of filteredTaskRows) {
      const task = row.task;
      const createdAt = resolveOpenedAnchor(task);
      if (createdAt) {
        const createdIndex = resolveWeekIndex(createdAt);
        if (createdIndex !== undefined) opened[createdIndex] += 1;
      }

      const done = isDoneStatus(task.status);
      if (!done) {
        continue;
      }
      let completedAt = parseDateValue(task.completedDate);
      const updatedAt = parseDateValue(task.updatedAt);
      let completedIndex = resolveWeekIndex(completedAt);
      if (completedAt === null && completedIndex === undefined) {
        completedAt = updatedAt ?? createdAt;
        completedIndex = resolveWeekIndex(completedAt);
      }
      if (completedIndex !== undefined) {
        completed[completedIndex] += 1;
      }
    }

    const weekFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
    return {
      historyWeeks,
      labels: weeks.map((date) => weekFormatter.format(date)),
      opened,
      completed,
    };
  }, [filteredTaskRows, windowWeeks]);
  const displaySeries = useMemo(() => {
    const start = Math.max(0, trendSeries.labels.length - windowWeeks);
    return {
      labels: trendSeries.labels.slice(start),
      opened: trendSeries.opened.slice(start),
      completed: trendSeries.completed.slice(start),
      startIndex: start,
      historyWeeks: trendSeries.historyWeeks,
    };
  }, [trendSeries, windowWeeks]);
  const smoothingWindow = 2;
  const smoothedSeries = useMemo(() => {
    const toRolling = (values: number[]) =>
      values.map((_, index) => {
        const start = Math.max(0, index - smoothingWindow + 1);
        return values.slice(start, index + 1).reduce((sum, value) => sum + value, 0);
      });
    return {
      opened: toRolling(displaySeries.opened),
      completed: toRolling(displaySeries.completed),
    };
  }, [displaySeries.completed, displaySeries.opened, smoothingWindow]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const leftChartWidth = 540;
  const leftChartHeight = 270;
  const leftInset = 20;
  const chartCeiling = useMemo(() => {
    const maxCount = Math.max(1, ...smoothedSeries.opened, ...smoothedSeries.completed);
    if (maxCount <= 5) return 5;
    if (maxCount <= 10) return 10;
    if (maxCount <= 20) return 20;
    if (maxCount <= 50) return 50;
    if (maxCount <= 100) return 100;
    return Math.ceil(maxCount / 50) * 50;
  }, [smoothedSeries.completed, smoothedSeries.opened]);

  const openedPath = buildSeriesPath(smoothedSeries.opened, leftChartWidth, leftChartHeight, leftInset, {
    min: 0,
    max: chartCeiling,
  });
  const completedPath = buildSeriesPath(smoothedSeries.completed, leftChartWidth, leftChartHeight, leftInset, {
    min: 0,
    max: chartCeiling,
  });
  const leftAreaPath = `${openedPath} L ${leftChartWidth - leftInset} ${leftChartHeight - leftInset} L ${leftInset} ${leftChartHeight - leftInset} Z`;
  const yTicks = useMemo(() => {
    const step = chartCeiling / 5;
    return [5, 4, 3, 2, 1, 0].map((multiplier) => Math.round(step * multiplier));
  }, [chartCeiling]);
  const chartUsableHeight = leftChartHeight - leftInset * 2;
  const chartUsableWidth = leftChartWidth - leftInset * 2;
  const gridInsetXPercent = (leftInset / leftChartWidth) * 100;
  const gridInsetYPercent = (leftInset / leftChartHeight) * 100;
  const axisRowStepPercent = (100 - gridInsetYPercent * 2) / 5;
  const axisLabelOpticalOffsetPx = -2;
  const pointCount = Math.max(1, smoothedSeries.opened.length);
  const xStep = pointCount > 1 ? chartUsableWidth / (pointCount - 1) : 0;
  const gridColumnPercent = pointCount > 1 ? 100 / (pointCount - 1) : 100;
  const gridRowPercent = 100 / 5;
  const openedPoints = useMemo(
    () =>
      smoothedSeries.opened.map((value, index) => ({
        x: leftInset + xStep * index,
        y:
          leftChartHeight -
          leftInset -
          (value / Math.max(1, chartCeiling)) * chartUsableHeight,
      })),
    [chartCeiling, chartUsableHeight, leftChartHeight, leftInset, smoothedSeries.opened, xStep]
  );
  const completedPoints = useMemo(
    () =>
      smoothedSeries.completed.map((value, index) => ({
        x: leftInset + xStep * index,
        y:
          leftChartHeight -
          leftInset -
          (value / Math.max(1, chartCeiling)) * chartUsableHeight,
      })),
    [chartCeiling, chartUsableHeight, leftChartHeight, leftInset, smoothedSeries.completed, xStep]
  );
  const clampedHoverIndex = hoverIndex === null ? null : Math.max(0, Math.min(pointCount - 1, hoverIndex));
  const activeHoverPoint = clampedHoverIndex === null ? null : openedPoints[clampedHoverIndex] ?? null;
  const activeHoverCompletedPoint =
    clampedHoverIndex === null ? null : completedPoints[clampedHoverIndex] ?? null;
  const activeHoverLabel = clampedHoverIndex === null ? "" : displaySeries.labels[clampedHoverIndex] ?? "";
  const activeHoverOpened = clampedHoverIndex === null ? 0 : smoothedSeries.opened[clampedHoverIndex] ?? 0;
  const activeHoverCompleted = clampedHoverIndex === null ? 0 : smoothedSeries.completed[clampedHoverIndex] ?? 0;
  const activeHoverNet = activeHoverOpened - activeHoverCompleted;
  const revealSuffix = `${selectedTrialId}-${windowWeeks}`.replace(/[^a-zA-Z0-9_-]/g, "");
  const revealClipId = `dark-panel-reveal-${gradientId}-${revealSuffix}`;
  const [revealProgress, setRevealProgress] = useState(0);
  const revealWidth = chartUsableWidth * revealProgress;
  const revealSeriesKey = useMemo(
    () =>
      `${selectedTrialId}-${windowWeeks}-${smoothedSeries.opened.join(",")}|${smoothedSeries.completed.join(",")}`,
    [selectedTrialId, smoothedSeries.completed, smoothedSeries.opened, windowWeeks]
  );
  useEffect(() => {
    let animationFrame = 0;
    let startTime: number | null = null;
    const durationMs = 950;
    setHoverIndex(null);
    setRevealProgress(0);

    const step = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const raw = Math.max(0, Math.min(1, elapsed / durationMs));
      const eased = 1 - Math.pow(1 - raw, 3);
      setRevealProgress(eased);
      if (raw < 1) {
        animationFrame = window.requestAnimationFrame(step);
      }
    };

    animationFrame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [revealSeriesKey]);
  const tooltipWidth = 142;
  const tooltipHeight = 62;
  const tooltipX = activeHoverPoint
    ? Math.max(6, Math.min(leftChartWidth - tooltipWidth - 6, activeHoverPoint.x + 8))
    : 0;
  const tooltipY = activeHoverPoint
    ? Math.max(
        6,
        activeHoverPoint.y - tooltipHeight - 10 < 6
          ? activeHoverPoint.y + 12
          : activeHoverPoint.y - tooltipHeight - 10
      )
    : 0;
  const handleChartMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (pointCount <= 1) {
      setHoverIndex(0);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const xView = ((event.clientX - rect.left) / rect.width) * leftChartWidth;
    const clampedX = Math.max(leftInset, Math.min(leftChartWidth - leftInset, xView));
    const nextIndex = Math.round((clampedX - leftInset) / Math.max(1, xStep));
    setHoverIndex(Math.max(0, Math.min(pointCount - 1, nextIndex)));
  };

  const currentWindowNet = useMemo(
    () =>
      displaySeries.opened.reduce((sum, opened, index) => {
        const completed = displaySeries.completed[index] ?? 0;
        return sum + (opened - completed);
      }, 0),
    [displaySeries.completed, displaySeries.opened]
  );
  const previousWindowNet = useMemo(() => {
    const previousStart = Math.max(0, displaySeries.startIndex - windowWeeks);
    const previousEnd = displaySeries.startIndex;
    const previousOpened = trendSeries.opened.slice(previousStart, previousEnd);
    const previousCompleted = trendSeries.completed.slice(previousStart, previousEnd);
    if (previousOpened.length === 0) return 0;
    return previousOpened.reduce((sum, opened, index) => {
      const completed = previousCompleted[index] ?? 0;
      return sum + (opened - completed);
    }, 0);
  }, [displaySeries.startIndex, trendSeries.completed, trendSeries.opened, windowWeeks]);
  const changeFromPrevious = currentWindowNet - previousWindowNet;
  const improving = changeFromPrevious <= 0;
  const deltaDisplay = `${currentWindowNet > 0 ? "+" : ""}${currentWindowNet}`;
  const changeDisplay = `${changeFromPrevious > 0 ? "+" : ""}${changeFromPrevious}`;

  const visitReadiness = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfDay = (source: Date) => {
      const date = new Date(source);
      date.setHours(0, 0, 0, 0);
      return date;
    };
    const dayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
    const now = new Date();
    const currentWindowStart = startOfDay(now);

    const summarizeDays = (
      days: Array<{ label: string; scheduled: number; ready: number; atRisk: number; critical: number }>
    ) => {
      const totals = days.reduce(
        (acc, day) => {
          acc.total += day.scheduled;
          acc.ready += day.ready;
          acc.atRisk += day.atRisk;
          acc.critical += day.critical;
          return acc;
        },
        { total: 0, ready: 0, atRisk: 0, critical: 0 }
      );
      return { days, ...totals };
    };

    const buildWindow = (windowStart: Date) => {
      const buckets = Array.from({ length: 7 }, (_, dayIndex) => {
        const date = new Date(windowStart);
        date.setDate(windowStart.getDate() + dayIndex);
        return {
          label: dayFormatter.format(date),
          signals: 0,
          completedSignals: 0,
          pendingSignals: 0,
          blockedSignals: 0,
          overdueSignals: 0,
        };
      });
      const windowEnd = new Date(windowStart);
      windowEnd.setDate(windowStart.getDate() + 7);

      for (const row of filteredTaskRows) {
        const dueDate = parseDateValue(row.task.dueDate);
        if (!dueDate) continue;
        if (dueDate.getTime() < windowStart.getTime() || dueDate.getTime() >= windowEnd.getTime()) continue;
        const bucketIndex = Math.floor((startOfDay(dueDate).getTime() - windowStart.getTime()) / dayMs);
        if (bucketIndex < 0 || bucketIndex > 6) continue;
        const bucket = buckets[bucketIndex];
        bucket.signals += 1;
        const done = isDoneStatus(row.task.status);
        const status = normalizeStatus(row.task.status);
        if (done) {
          bucket.completedSignals += 1;
          continue;
        }
        bucket.pendingSignals += 1;
        if (status === "blocked" || status === "waiting") bucket.blockedSignals += 1;
        if (dueDate.getTime() < now.getTime()) bucket.overdueSignals += 1;
      }

      const days = buckets.map((bucket) => {
        const scheduled = Math.max(0, Math.round((bucket.signals + bucket.completedSignals * 0.5) / 3));
        const critical = Math.min(
          scheduled,
          Math.max(0, Math.round((bucket.blockedSignals + bucket.overdueSignals) / 1.5))
        );
        const atRisk = Math.min(
          Math.max(0, scheduled - critical),
          Math.max(0, Math.round((bucket.pendingSignals - bucket.blockedSignals) / 3))
        );
        const ready = Math.max(0, scheduled - critical - atRisk);
        return { label: bucket.label, scheduled, ready, atRisk, critical };
      });

      return summarizeDays(days);
    };

    const currentFromTasks = buildWindow(currentWindowStart);
    const previousWindowStart = new Date(currentWindowStart);
    previousWindowStart.setDate(currentWindowStart.getDate() - 7);
    const previousFromTasks = buildWindow(previousWindowStart);
    const hasTaskSignal = currentFromTasks.total > 0 || previousFromTasks.total > 0;

    let current = currentFromTasks;
    let previous = previousFromTasks;
    if (!hasTaskSignal) {
      const openLoad = filteredTaskRows.filter((row) => !isDoneStatus(row.task.status)).length;
      const blockedLoad = filteredTaskRows.filter((row) => {
        const status = normalizeStatus(row.task.status);
        return status === "blocked" || status === "waiting";
      }).length;
      const baseLoad = Math.max(1, Math.min(6, Math.round(openLoad / 14) || 1));
      const blockerShare = Math.min(0.4, blockedLoad / Math.max(1, openLoad));
      const profile = [2, 3, 4, 4, 5, 4, 3];
      const currentDays = profile.map((weight, index) => {
        const scheduled = Math.max(1, Math.round(weight * baseLoad * (index >= 4 ? 0.92 : 1)));
        const critical = Math.max(
          0,
          Math.min(scheduled, Math.round(scheduled * (0.1 + blockerShare + (index >= 4 ? 0.06 : 0))))
        );
        const atRisk = Math.max(0, Math.min(scheduled - critical, Math.round(scheduled * 0.22)));
        const ready = Math.max(0, scheduled - critical - atRisk);
        const date = new Date(currentWindowStart);
        date.setDate(currentWindowStart.getDate() + index);
        return { label: dayFormatter.format(date), scheduled, ready, atRisk, critical };
      });
      const previousDays = currentDays.map((day, index) => {
        const scheduled = Math.max(1, Math.round(day.scheduled * (0.9 + (index % 2 === 0 ? 0.04 : -0.03))));
        const critical = Math.max(
          0,
          Math.min(scheduled, Math.round(day.critical * (0.85 + (index % 3 === 0 ? 0.08 : 0))))
        );
        const atRisk = Math.max(
          0,
          Math.min(scheduled - critical, Math.round(day.atRisk * (0.85 + (index % 2 === 0 ? 0.1 : -0.04))))
        );
        const ready = Math.max(0, scheduled - critical - atRisk);
        const date = new Date(previousWindowStart);
        date.setDate(previousWindowStart.getDate() + index);
        return { label: dayFormatter.format(date), scheduled, ready, atRisk, critical };
      });
      current = summarizeDays(currentDays);
      previous = summarizeDays(previousDays);
    }

    const currentReadinessRate =
      current.total > 0 ? Math.round((current.ready / Math.max(1, current.total)) * 100) : 100;
    const previousReadinessRate =
      previous.total > 0
        ? Math.round((previous.ready / Math.max(1, previous.total)) * 100)
        : currentReadinessRate;
    const readinessDelta = currentReadinessRate - previousReadinessRate;
    const improvingReadiness = readinessDelta >= 0;
    const maxDailyVisits = Math.max(1, ...current.days.map((day) => day.scheduled));
    const dotRows = 10;
    const dotColumns = current.days.map((day, columnIndex) => {
      const filledDots =
        day.scheduled > 0 ? Math.max(1, Math.round((day.scheduled / maxDailyVisits) * dotRows)) : 0;
      const criticalDots =
        filledDots > 0
          ? Math.min(filledDots, Math.round((day.critical / Math.max(1, day.scheduled)) * filledDots))
          : 0;
      const atRiskDots =
        filledDots > 0
          ? Math.min(
              Math.max(0, filledDots - criticalDots),
              Math.round((day.atRisk / Math.max(1, day.scheduled)) * filledDots)
            )
          : 0;
      const readyDots = Math.max(0, filledDots - criticalDots - atRiskDots);
      const readyColor = mixHex("#7E4BFF", "#12B8FF", columnIndex / Math.max(1, current.days.length - 1));
      const stack = [
        ...Array.from({ length: readyDots }, () => readyColor),
        ...Array.from({ length: atRiskDots }, () => "#F5B85A"),
        ...Array.from({ length: criticalDots }, () => "#FF5A65"),
      ];
      return { stack, filledDots };
    });

    return {
      totalVisits: current.total,
      readyVisits: current.ready,
      atRiskVisits: current.atRisk,
      criticalVisits: current.critical,
      readinessRate: currentReadinessRate,
      readinessDelta,
      improvingReadiness,
      dayLabels: current.days.map((day) => day.label),
      dotColumns,
      dotRows,
    };
  }, [filteredTaskRows]);

  const visitDotPlot = useMemo(() => {
    const rows = 13;
    const columnsPerDay = 5;
    const neutralDot = "#ECEFF4";
    const lowDot = "#A7E0FF";
    const mediumDot = "#55BFFF";
    const highDot = "#0A9CFF";
    const shapeProfile = [0.56, 0.84, 1, 0.76, 0.48];
    const jitterProfile = [0, 0.5, 0.9, 0.3, -0.15];
    const maxScheduled = Math.max(1, ...visitReadiness.dotColumns.map((column) => column.filledDots));
    const riskPerDay = visitReadiness.dotColumns.map((column) => {
      const critical = column.stack.filter((color) => color === "#FF5A65").length;
      const atRisk = column.stack.filter((color) => color === "#F5B85A").length;
      return critical * 2 + atRisk;
    });
    const highestRiskDay = Math.max(
      0,
      riskPerDay.reduce((bestIndex, value, index, arr) => (value > arr[bestIndex] ? index : bestIndex), 0)
    );
    const secondRiskDay = Math.max(
      0,
      riskPerDay
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.index !== highestRiskDay)
        .sort((a, b) => b.value - a.value)[0]?.index ?? 0
    );

    const columns = visitReadiness.dotColumns.flatMap((column, dayIndex) =>
      shapeProfile.map((shape, slotIndex) => {
        const normalized = column.filledDots / maxScheduled;
        const baseHeight = 2 + normalized * (rows - 4) * shape + jitterProfile[slotIndex];
        let filled = Math.max(2, Math.min(rows - 1, Math.round(baseHeight)));
        if (dayIndex === highestRiskDay && (slotIndex === 2 || slotIndex === 3)) {
          filled = Math.min(rows - 1, filled + 3);
        } else if (dayIndex === secondRiskDay && slotIndex === 2) {
          filled = Math.min(rows - 1, filled + 2);
        }

        const cells = Array.from({ length: rows }, (_, rowIndex) => {
          const fromBottom = rows - 1 - rowIndex;
          if (fromBottom >= filled) return neutralDot;
          if (dayIndex === highestRiskDay && slotIndex >= 2 && fromBottom <= filled - 2) return highDot;
          if (
            (dayIndex === highestRiskDay && slotIndex === 1 && fromBottom <= filled - 1) ||
            (dayIndex === secondRiskDay && slotIndex === 2 && fromBottom <= filled - 1)
          ) {
            return mediumDot;
          }
          return lowDot;
        });

        return {
          key: `visit-dot-column-${dayIndex}-${slotIndex}`,
          cells,
        };
      })
    );

    return {
      rows,
      columns,
      columnsPerDay,
    };
  }, [visitReadiness.dotColumns]);

  const rightSessionPath = buildSeriesPath(SESSION_SERIES, 332, 74, 8, { min: 0, max: 24 });
  const visitSummaryText = `${formatCompactCount(
    visitReadiness.readyVisits
  )} ready · ${formatCompactCount(visitReadiness.atRiskVisits + visitReadiness.criticalVisits)} at risk`;

  return (
    <section className="mb-1 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="grid grid-cols-1 xl:h-full xl:grid-cols-[minmax(0,calc(62.5%+0.0625rem))_minmax(0,calc(37.5%-0.0625rem))]">
        <article className="border-b border-gray-200 px-9 pb-7 pt-7 xl:min-h-[432px] xl:border-b-0 xl:border-r">
          <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] font-medium leading-[20px] text-[#75778B]">Net backlog delta</p>

            <div className="flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-2 text-[14px] font-medium text-[#75778B]">
                <span className="h-[2px] w-5 rounded-full bg-[#7E4BFF]" />
                Opened tasks
              </div>
              <div className="flex items-center gap-2 text-[14px] font-medium text-[#75778B]">
                <span className="h-[2px] w-5 rounded-full bg-[#12B8FF]" />
                Completed tasks
              </div>
              <span className="text-[11px] font-medium text-[#75778B]/80">
                {smoothingWindow}-week rolling
              </span>
              <select
                value={selectedTrialId}
                onChange={(event) => setSelectedTrialId(event.target.value)}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]"
              >
                <option value="all">All trials</option>
                {trials.map((trial) => (
                  <option key={trial.id} value={trial.id}>
                    {trial.title}
                  </option>
                ))}
              </select>
              <select
                value={String(windowWeeks)}
                onChange={(event) => setWindowWeeks(Number(event.target.value) as 4 | 8 | 12)}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]"
              >
                <option value="4">Last 4 weeks</option>
                <option value="8">Last 8 weeks</option>
                <option value="12">Last 12 weeks</option>
              </select>
            </div>
          </div>

          <div className="mb-4 inline-flex items-center gap-[14px]">
            <p className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
              {deltaDisplay}
            </p>
            <span
              className={`inline-flex items-center gap-[6px] rounded-[2px] border-[0.6px] px-[6px] py-[3px] text-[12px] font-medium leading-[14px] ${
                improving
                  ? "border-[rgba(5,193,104,0.20)] bg-[rgba(5,193,104,0.20)] text-[#14CA74]"
                  : "border-[rgba(255,90,101,0.20)] bg-[rgba(255,90,101,0.20)] text-[#FF5A65]"
              }`}
            >
              {changeDisplay}
              {improving ? (
                <ArrowDownRight className="h-[18px] w-[18px]" />
              ) : (
                <ArrowUpRight className="h-[18px] w-[18px]" />
              )}
            </span>
            <span className="text-[11px] font-medium leading-[13px] text-[#75778B]">
              vs prior {windowWeeks} weeks
            </span>
          </div>

          <div className="relative px-5 py-4">
            <div className="ml-14 mr-4">
              <div className="relative h-[276px]">
                <div className="pointer-events-none absolute -left-[46px] top-0 z-20 h-full w-9 text-right text-[11px] font-medium text-[#75778B]">
                  {yTicks.map((tick, index) => (
                    <span
                      key={`dark-y-tick-${tick}-${index}`}
                      className="absolute right-0 -translate-y-1/2 leading-none"
                      style={{
                        top: `calc(${gridInsetYPercent}% + ${axisRowStepPercent * index}% + ${axisLabelOpticalOffsetPx}px)`,
                      }}
                    >
                      {formatCountAxis(tick)}
                    </span>
                  ))}
                </div>

                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute z-0"
                  style={{
                    left: `${gridInsetXPercent}%`,
                    right: `${gridInsetXPercent}%`,
                    top: `${gridInsetYPercent}%`,
                    bottom: `${gridInsetYPercent}%`,
                    backgroundImage: [
                      "linear-gradient(to right, rgba(185,193,217,0.26) 1px, transparent 1px)",
                      "linear-gradient(to top, rgba(185,193,217,0.26) 1px, transparent 1px)",
                    ].join(", "),
                    backgroundSize: `${gridColumnPercent}% ${gridRowPercent}%, ${gridColumnPercent}% ${gridRowPercent}%`,
                    WebkitMaskImage:
                      "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 58%, rgba(0,0,0,0.18) 100%)",
                    maskImage:
                      "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 58%, rgba(0,0,0,0.18) 100%)",
                  }}
                />

                <svg
                  aria-hidden="true"
                  viewBox={`0 0 ${leftChartWidth} ${leftChartHeight}`}
                  preserveAspectRatio="none"
                  className="relative z-10 h-full w-full cursor-crosshair"
                  onMouseMove={handleChartMouseMove}
                  onMouseLeave={() => setHoverIndex(null)}
                >
                  <defs>
                    <linearGradient id={`dark-panel-area-${gradientId}`} x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#7E4BFF" stopOpacity="0.20" />
                      <stop offset="100%" stopColor="#7E4BFF" stopOpacity="0.04" />
                    </linearGradient>
                    <clipPath id={revealClipId}>
                      <rect x={leftInset} y={0} width={revealWidth} height={leftChartHeight} />
                    </clipPath>
                  </defs>

                  <line
                    x1={leftInset}
                    y1={leftInset}
                    x2={leftInset}
                    y2={leftChartHeight - leftInset}
                    stroke="#D1D7E1"
                    strokeWidth="1.15"
                  />
                  <line
                    x1={leftInset}
                    y1={leftChartHeight - leftInset}
                    x2={leftChartWidth - leftInset}
                    y2={leftChartHeight - leftInset}
                    stroke="#D1D7E1"
                    strokeWidth="1.15"
                  />

                  <g clipPath={`url(#${revealClipId})`}>
                    <path
                      d={leftAreaPath}
                      fill={`url(#dark-panel-area-${gradientId})`}
                      fillOpacity={0.45 + revealProgress * 0.55}
                    />
                    <path
                      d={completedPath}
                      fill="none"
                      stroke="#12B8FF"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                    <path
                      d={openedPath}
                      fill="none"
                      stroke="#7E4BFF"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  </g>
                  {activeHoverPoint ? (
                    <>
                      <line
                        x1={activeHoverPoint.x}
                        y1={leftInset}
                        x2={activeHoverPoint.x}
                        y2={leftChartHeight - leftInset}
                        stroke="#CCD3DF"
                        strokeWidth="1.5"
                      />
                      <circle
                        cx={activeHoverPoint.x}
                        cy={activeHoverPoint.y}
                        r="5.2"
                        fill="#FFFFFF"
                        stroke="#1F5FEA"
                        strokeWidth="3"
                      />
                      {activeHoverCompletedPoint ? (
                        <circle
                          cx={activeHoverCompletedPoint.x}
                          cy={activeHoverCompletedPoint.y}
                          r="3.2"
                          fill="#12B8FF"
                        />
                      ) : null}
                      <g transform={`translate(${tooltipX}, ${tooltipY})`}>
                        <rect width={tooltipWidth} height={tooltipHeight} rx="12" fill="#141821" />
                        <text x="12" y="18" fill="#C8CDD7" fontSize="10" fontWeight="500">
                          {activeHoverLabel}
                        </text>
                        <text x="12" y="44" fill="#FFFFFF" fontSize="18" fontWeight="600">
                          {`${activeHoverNet > 0 ? "+" : ""}${activeHoverNet}`}
                        </text>
                        <text x="60" y="44" fill="#C8CDD7" fontSize="10" fontWeight="500">
                          net tasks
                        </text>
                      </g>
                    </>
                  ) : null}
                </svg>
              </div>

              <div
                className="mt-2 grid text-[11px] font-medium text-[#75778B]"
                style={{ gridTemplateColumns: `repeat(${displaySeries.labels.length}, minmax(0, 1fr))` }}
              >
                {displaySeries.labels.map((month) => (
                  <span key={`dark-month-${month}`} className="text-center">
                    {month}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </article>

        <div className="relative grid xl:h-full xl:grid-rows-2">
          <div className="pointer-events-none absolute left-0 right-0 top-1/2 hidden border-t border-gray-200 xl:block" />
          <article className="flex h-full flex-col overflow-hidden px-7 pb-5 pt-6">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[14px] font-medium leading-[20px] text-[#75778B]">Visits this week</p>
            </div>

            <div className="mb-4 inline-flex items-center gap-[14px]">
              <p className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
                {formatCompactCount(visitReadiness.totalVisits)}
              </p>
              <span
                className={`inline-flex items-center gap-[6px] rounded-[2px] border-[0.6px] px-[6px] py-[3px] text-[12px] font-medium leading-[14px] ${
                  visitReadiness.improvingReadiness
                    ? "border-[rgba(5,193,104,0.20)] bg-[rgba(5,193,104,0.20)] text-[#14CA74]"
                    : "border-[rgba(255,90,101,0.20)] bg-[rgba(255,90,101,0.20)] text-[#FF5A65]"
                }`}
              >
                {Math.abs(visitReadiness.readinessDelta)}%
                {visitReadiness.improvingReadiness ? (
                  <ArrowUpRight className="h-[18px] w-[18px]" />
                ) : (
                  <ArrowDownRight className="h-[18px] w-[18px]" />
                )}
              </span>
            </div>

            <div className="h-[78px] rounded-md bg-[#FAFAFA] px-2.5 py-2">
              <div
                className="grid h-full gap-x-[2px]"
                style={{ gridTemplateColumns: `repeat(${visitDotPlot.columns.length}, minmax(0, 1fr))` }}
              >
                {visitDotPlot.columns.map((column) => (
                  <div
                    key={column.key}
                    className="grid h-full justify-items-center gap-y-[2px]"
                    style={{ gridTemplateRows: `repeat(${visitDotPlot.rows}, minmax(0, 1fr))` }}
                  >
                    {column.cells.map((cellColor, rowIndex) => (
                      <span
                        key={`${column.key}-${rowIndex}`}
                        className="h-[4px] w-[4px] rounded-full"
                        style={{ backgroundColor: cellColor }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between text-[11px] font-medium leading-[13px] text-[#75778B]">
              {[0, 2, 4, 6].map((index) => (
                <span key={`dark-visit-time-${index}`}>
                  {visitReadiness.dayLabels[index] || ""}
                </span>
              ))}
            </div>

            <div className="mt-auto flex h-8 items-center justify-between pt-4">
              <span className="text-[14px] font-medium leading-[20px] text-[#75778B]">{visitSummaryText}</span>
              <button type="button" className="text-[14px] font-medium leading-[20px] text-primary">
                View visits
              </button>
            </div>
          </article>

          <article className="flex h-full flex-col overflow-hidden px-7 pb-5 pt-6">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[14px] font-medium leading-[20px] text-[#75778B]">Total sessions</p>
            </div>

            <div className="mb-4 inline-flex items-center gap-[14px]">
              <p className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">400</p>
              <span className="inline-flex items-center gap-[6px] rounded-[2px] border-[0.6px] border-[rgba(5,193,104,0.20)] bg-[rgba(5,193,104,0.20)] px-[6px] py-[3px] text-[12px] font-medium leading-[14px] text-[#14CA74]">
                16.8%
                <ArrowUpRight className="h-[18px] w-[18px]" />
              </span>
            </div>

            <div className="h-[64px] rounded-md bg-[#FAFAFA] px-2.5">
              <svg
                aria-hidden="true"
                viewBox="0 0 332 74"
                preserveAspectRatio="none"
                className="h-full w-full"
              >
                {[14, 28, 42, 56].map((row) => (
                  <line
                    key={`dark-session-grid-${row}`}
                    x1="0"
                    y1={row}
                    x2="332"
                    y2={row}
                    stroke="#ECEEF3"
                    strokeWidth="1"
                  />
                ))}
                <path d={rightSessionPath} fill="none" stroke="#CB3CFF" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </div>

            <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium leading-[13px] text-[#75778B]">
              {MINI_TIMES.map((label) => (
                <span key={`dark-profit-time-${label}`}>{label}</span>
              ))}
            </div>

            <div className="mt-auto flex h-8 items-center justify-between pt-4">
              <div className="inline-flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-[2px] border-[0.6px] border-[rgba(5,193,104,0.2)] bg-[rgba(5,193,104,0.2)] px-[6px] py-[2px] text-[10px] font-medium leading-[14px] text-[#14CA74]">
                  <span className="h-[3px] w-[3px] rounded-full bg-[#14CA74]" />
                  Live
                </span>
                <span className="text-[14px] font-medium leading-[20px] text-[#75778B]">10k visitors</span>
              </div>
              <button type="button" className="text-[14px] font-medium leading-[20px] text-primary">
                View report
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function BlockedReasonsSplitWorkloadPanel({
  trials,
  taskRows,
  blockedDeltaPercent,
}: {
  trials: AnalyticsTrialOption[];
  taskRows: TaskTimelineRow[];
  blockedDeltaPercent: number;
}) {
  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const [blockedReasonsAnimationNonce, setBlockedReasonsAnimationNonce] = useState(0);
  const [animateBlockedReasonBars, setAnimateBlockedReasonBars] = useState(true);
  const [hoveredSeriesKey, setHoveredSeriesKey] = useState<BlockedReasonSeriesKey | null>(null);
  const [hoveredWaitingOnValue, setHoveredWaitingOnValue] = useState<WaitingOnEntityValue | null>(null);
  const [selectedSplitTrialId, setSelectedSplitTrialId] = useState("all");

  useEffect(() => {
    if (!animateBlockedReasonBars || typeof window === "undefined") return;
    const timeoutId = window.setTimeout(() => setAnimateBlockedReasonBars(false), 780);
    return () => window.clearTimeout(timeoutId);
  }, [animateBlockedReasonBars, blockedReasonsAnimationNonce]);

  useEffect(() => {
    const node = chartViewportRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    let initialized = false;
    let wasVisible = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          if (!initialized) {
            initialized = true;
            wasVisible = true;
            return;
          }
          if (!wasVisible) {
            setAnimateBlockedReasonBars(true);
            setBlockedReasonsAnimationNonce((value) => value + 1);
          }
          wasVisible = true;
        } else {
          initialized = true;
          wasVisible = false;
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const trialTitleById = useMemo(
    () => new Map(trials.map((trial) => [normalizeTrialId(trial.id), trial.title])),
    [trials]
  );

  useEffect(() => {
    if (selectedSplitTrialId === "all") return;
    if (!trials.some((trial) => normalizeTrialId(trial.id) === normalizeTrialId(selectedSplitTrialId))) {
      setSelectedSplitTrialId("all");
    }
  }, [selectedSplitTrialId, trials]);

  const data = useMemo(() => {
    const rowsByTrial = new Map<string, BlockedReasonTrialPoint>();

    for (const row of taskRows) {
      const statusToken = normalizeStatus(row.task.status);
      if (statusToken !== "blocked" && statusToken !== "waiting") continue;

      const trialId = normalizeTrialId(row.trialId);
      if (!trialId) continue;
      if (selectedSplitTrialId !== "all" && normalizeTrialId(selectedSplitTrialId) !== trialId) continue;

      const trialTitle = trialTitleById.get(trialId) || trialId;
      const trialLabel = toCompactTrialLabel(trialTitle);
      const bucket =
        rowsByTrial.get(trialId) ??
        {
          trialId,
          trialLabel,
          trialTitle,
          total: 0,
          external: 0,
          internal: 0,
          patient: 0,
          systemData: 0,
          scheduledTiming: 0,
        };

      const category = resolveBlockedReasonCategory(row.task.blockedReason);
      if (category === "External") bucket.external += 1;
      else if (category === "Patient") bucket.patient += 1;
      else if (category === "System/Data") bucket.systemData += 1;
      else if (category === "Scheduled/Timing") bucket.scheduledTiming += 1;
      else bucket.internal += 1;

      bucket.total += 1;
      rowsByTrial.set(trialId, bucket);
    }

    return Array.from(rowsByTrial.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.trialLabel.localeCompare(b.trialLabel);
    });
  }, [selectedSplitTrialId, taskRows, trialTitleById]);

  const totalBlocked = useMemo(() => data.reduce((sum, row) => sum + row.total, 0), [data]);
  const trialsWithBlockers = data.length;
  const maxStack = useMemo(() => data.reduce((max, row) => Math.max(max, row.total), 0), [data]);
  const { yAxisMax, yAxisTicks } = useMemo(
    () => computeBacklogYAxis(Math.max(1, maxStack)),
    [maxStack]
  );
  const hasSignal = totalBlocked > 0;
  const normalizedBlockedDeltaPercent = Number.isFinite(blockedDeltaPercent) ? blockedDeltaPercent : 0;
  const blockedBadgeTonePositive = normalizedBlockedDeltaPercent <= 0;
  const blockedBadgeDirectionUp = normalizedBlockedDeltaPercent >= 0;
  const blockedBadgeText = `${Math.abs(normalizedBlockedDeltaPercent).toFixed(0)}%`;
  const resolveSeriesOpacity = (seriesKey: BlockedReasonSeriesKey) => {
    if (!hoveredSeriesKey) return 0.95;
    return hoveredSeriesKey === seriesKey ? 1 : 0.45;
  };
  const resolveWaitingOnOpacity = (value: WaitingOnEntityValue) => {
    if (!hoveredWaitingOnValue) return 1;
    return hoveredWaitingOnValue === value ? 1 : 0.38;
  };
  const waitingOnDistribution = useMemo(() => {
    const counts = new Map<WaitingOnEntityValue, number>();
    for (const option of WAITING_ON_OPTIONS) counts.set(option.value, 0);
    let total = 0;

    for (const row of taskRows) {
      const statusToken = normalizeStatus(row.task.status);
      if (statusToken !== "blocked" && statusToken !== "waiting") continue;

      const trialId = normalizeTrialId(row.trialId);
      if (!trialId) continue;
      if (selectedSplitTrialId !== "all" && normalizeTrialId(selectedSplitTrialId) !== trialId) {
        continue;
      }

      total += 1;
      const waitingOn = resolveBlockedWaitingOn(row.task.blockedReason);
      counts.set(waitingOn, (counts.get(waitingOn) || 0) + 1);
    }

    const rows = WAITING_ON_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
      count: counts.get(option.value) || 0,
      color: WAITING_ON_COLORS[option.value],
    }))
      .filter((row) => row.count > 0)
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });

    return { total, rows };
  }, [selectedSplitTrialId, taskRows]);
  const selectedWaitingOnTrialLabel = useMemo(() => {
    if (selectedSplitTrialId === "all") return "All trials";
    const matched = trials.find((trial) => normalizeTrialId(trial.id) === normalizeTrialId(selectedSplitTrialId));
    return matched?.title || "Selected trial";
  }, [selectedSplitTrialId, trials]);
  const waitingOnActiveGroups = waitingOnDistribution.rows.length;

  return (
    <section className="mb-1 overflow-hidden rounded-lg border border-gray-200 bg-white xl:min-h-[520px]">
      <div className="grid grid-cols-1 xl:h-full xl:grid-cols-[minmax(0,calc(62.5%+0.0625rem))_minmax(0,calc(37.5%-0.0625rem))]">
        <article className="flex flex-col border-b border-gray-200 px-9 pb-2 pt-7 xl:h-full xl:min-h-[432px] xl:border-b-0">
          <div className="mb-2">
            <h3 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Blocked reasons by trial</h3>
            <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
              Current blocked tasks · category mix across trials
            </p>
          </div>

          <div className="mt-4 mb-3 inline-flex items-center gap-10">
            <div>
              <p className="text-[12px] font-medium leading-[16px] text-[#75778B]">Blocked tasks</p>
              <div className="mt-2 inline-flex items-center gap-[14px]">
                <p className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
                  {formatCompactCount(totalBlocked)}
                </p>
                <div className="inline-flex items-center gap-2">
                  <span
                    className={`flex flex-col items-start gap-[10px] rounded-[2px] border-[0.6px] px-[6px] py-[3px] ${
                      blockedBadgeTonePositive
                        ? "border-[rgba(5,193,104,0.20)] bg-[rgba(5,193,104,0.20)]"
                        : "border-[rgba(255,90,101,0.20)] bg-[rgba(255,90,101,0.20)]"
                    }`}
                  >
                    <span
                      className={`inline-flex items-center gap-[6px] text-[12px] font-medium leading-[14px] ${
                        blockedBadgeTonePositive ? "text-[#14CA74]" : "text-[#FF5A65]"
                      }`}
                    >
                      {blockedBadgeText}
                      {blockedBadgeDirectionUp ? (
                        <ArrowUpRight className="h-[18px] w-[18px]" />
                      ) : (
                        <ArrowDownRight className="h-[18px] w-[18px]" />
                      )}
                    </span>
                  </span>
                  <span className="text-[11px] font-medium leading-[13px] text-[#75778B]">from last week</span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-[12px] font-medium leading-[16px] text-[#75778B]">Trials with blockers</p>
              <p className="mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
                {formatCompactCount(trialsWithBlockers)}
              </p>
            </div>
          </div>

          <div className="mt-auto mb-4 flex flex-wrap items-center gap-4 pt-4 text-[13px] font-medium text-[#75778B]">
            {BLOCKED_REASON_SERIES.map((series) => (
              <button
                key={`${series.key}-split`}
                type="button"
                className="inline-flex items-center gap-2 transition-opacity duration-200"
                style={{ opacity: resolveSeriesOpacity(series.key) }}
                onMouseEnter={() => setHoveredSeriesKey(series.key)}
                onMouseLeave={() => setHoveredSeriesKey(null)}
                onFocus={() => setHoveredSeriesKey(series.key)}
                onBlur={() => setHoveredSeriesKey(null)}
              >
                <span className="h-[10px] w-[10px] rounded-[3px]" style={{ backgroundColor: series.color }} />
                {series.label}
              </button>
            ))}
          </div>

          {!hasSignal ? (
            <p className="mb-4 text-[12px] font-medium text-[#75778B]">
              No blocked tasks found for the selected workspace.
            </p>
          ) : null}

          <style>{`
            @keyframes blockedStackBarWipeUp {
              from {
                transform: scaleY(0);
              }
              to {
                transform: scaleY(1);
              }
            }
          `}</style>

          <div ref={chartViewportRef} className="mt-8 h-[276px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                key={`blocked-reasons-split-chart-${blockedReasonsAnimationNonce}`}
                data={data}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                barCategoryGap="16%"
              >
                <CartesianGrid stroke="rgba(185,193,217,0.26)" strokeDasharray="0" vertical={false} />
                <XAxis
                  dataKey="trialLabel"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#75778B" }}
                  interval={0}
                  dy={12}
                  height={48}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#75778B" }}
                  width={32}
                  allowDecimals={false}
                  ticks={yAxisTicks}
                  domain={[0, yAxisMax]}
                />
                <Tooltip cursor={{ fill: "rgba(147,160,197,0.12)" }} content={<BlockedReasonsTooltip />} />
                {BLOCKED_REASON_SERIES.map((series) => (
                  <Bar
                    key={`${series.key}-split`}
                    dataKey={series.key}
                    stackId="blockedReasons"
                    name={series.label}
                    fill={series.color}
                    fillOpacity={resolveSeriesOpacity(series.key)}
                    maxBarSize={40}
                    isAnimationActive={false}
                    shape={(shapeProps: any) => (
                      <BlockedReasonStackShape
                        {...shapeProps}
                        seriesKey={series.key}
                        animate={animateBlockedReasonBars}
                      />
                    )}
                    onMouseEnter={() => setHoveredSeriesKey(series.key)}
                    onMouseLeave={() => setHoveredSeriesKey(null)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 top-[96px] hidden w-px bg-gray-200 xl:block"
          />
          <article className="flex h-full flex-col overflow-hidden pb-2 pl-7 pr-4 pt-6">
            <div className="mb-4 flex items-center justify-end gap-3">
              <select
                value={selectedSplitTrialId}
                onChange={(event) => setSelectedSplitTrialId(event.target.value)}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]"
              >
                <option value="all">All trials</option>
                {trials.map((trial) => (
                  <option key={`blocked-reasons-split-filter-${trial.id}`} value={trial.id}>
                    {trial.title}
                  </option>
                ))}
              </select>
              <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
                <AlertTriangle className="h-4 w-4 text-primary" />
              </span>
            </div>

            <div className="mt-6 mb-4">
              <div>
                <p className="text-[14px] font-medium leading-[20px] text-[#75778B]">Waiting on (Primary blocker)</p>
                <p className="mt-1 text-[12px] font-medium leading-[16px] text-[#9AA1B2]">
                  {selectedWaitingOnTrialLabel}
                </p>
              </div>
            </div>

            <div className="mt-2 pt-2">
              <p className="-mt-2 mb-4 text-[14px] font-medium leading-[20px] text-[#75778B]">
                {formatCompactCount(waitingOnActiveGroups)} parties currently blocking tasks
              </p>
              {waitingOnDistribution.rows.length > 0 ? (
                <div className="mt-2 h-[14px] overflow-hidden rounded-full bg-[#E9EDF6]">
                  <div className="flex h-full w-full">
                    {waitingOnDistribution.rows.map((row, index) => (
                      <span
                        key={`waiting-on-segment-${row.value}-${index}`}
                        className={index < waitingOnDistribution.rows.length - 1 ? "border-r border-white/80" : ""}
                        style={{
                          flex: Math.max(1, row.count),
                          backgroundColor: row.color,
                          opacity: resolveWaitingOnOpacity(row.value),
                          transition: "opacity 180ms ease",
                        }}
                        onMouseEnter={() => setHoveredWaitingOnValue(row.value)}
                        onMouseLeave={() => setHoveredWaitingOnValue(null)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {waitingOnDistribution.rows.length === 0 ? (
              <p className="mt-4 text-[13px] font-medium leading-[18px] text-[#75778B]">
                No blocked tasks found for this trial filter.
              </p>
            ) : (
              <div className="mt-5 space-y-3">
                {waitingOnDistribution.rows.map((row) => {
                  const percent = waitingOnDistribution.total
                    ? Math.round((row.count / waitingOnDistribution.total) * 100)
                    : 0;
                  return (
                    <div
                      key={`waiting-on-row-${row.value}`}
                      className="cursor-pointer"
                      style={{ opacity: resolveWaitingOnOpacity(row.value), transition: "opacity 180ms ease" }}
                      onMouseEnter={() => setHoveredWaitingOnValue(row.value)}
                      onMouseLeave={() => setHoveredWaitingOnValue(null)}
                      onFocus={() => setHoveredWaitingOnValue(row.value)}
                      onBlur={() => setHoveredWaitingOnValue(null)}
                      tabIndex={0}
                    >
                      <div className="flex items-center gap-2 text-[12px] font-medium text-[#6F7690]">
                        <span className="h-[8px] w-[8px] rounded-[2px]" style={{ backgroundColor: row.color }} />
                        <span>{row.label}</span>
                        <span className="h-px flex-1 bg-[#E3E8F1]" />
                        <span>{`${percent}%`}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}

function TaskStatusDonutPanel({ tasks }: { tasks: WorkspaceTask[] }) {
  const [activeSliceKey, setActiveSliceKey] = useState<string | null>(null);
  const statusBreakdown = useMemo(() => {
    const buckets: Array<{ key: string; label: string; color: string; count: number }> = [
      { key: "todo", label: "To do", color: "#4F6EF7", count: 0 },
      { key: "in_progress", label: "In progress", color: "#2EAAFF", count: 0 },
      { key: "blocked", label: "Blocked / Waiting", color: "#FF6B6B", count: 0 },
      { key: "done", label: "Done", color: "#22C55E", count: 0 },
      { key: "closed", label: "Skipped / Cancelled", color: "#94A3B8", count: 0 },
      { key: "other", label: "Other", color: "#A855F7", count: 0 },
    ];
    const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let overdue = 0;

    for (const task of tasks) {
      const status = normalizeStatus(task.status);
      let key = "other";
      if (status === "todo" || status === "suggested" || status === "confirmed") key = "todo";
      else if (status === "in_progress") key = "in_progress";
      else if (status === "blocked" || status === "waiting") key = "blocked";
      else if (status === "done") key = "done";
      else if (status === "skipped" || status === "cancelled") key = "closed";

      const bucket = bucketByKey.get(key);
      if (bucket) bucket.count += 1;

      if (!isDoneStatus(task.status)) {
        const dueLike = parseDateValue(task.dueDate) ?? parseDateValue(task.suggestedDate);
        if (dueLike) {
          const dueDay = new Date(dueLike.getFullYear(), dueLike.getMonth(), dueLike.getDate());
          if (dueDay.getTime() < todayStart.getTime()) overdue += 1;
        }
      }
    }

    const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    const slices: StatusDonutSlice[] = buckets
      .filter((bucket) => bucket.count > 0)
      .map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        value: bucket.count,
        color: bucket.color,
        percent: total > 0 ? Math.round((bucket.count / total) * 100) : 0,
      }));

    return { total, overdue, slices };
  }, [tasks]);
  const activeSlice = useMemo(
    () => statusBreakdown.slices.find((slice) => slice.key === activeSliceKey) ?? null,
    [activeSliceKey, statusBreakdown.slices]
  );

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-[#131416]">Task status mix</h3>
          <p className="mt-1 text-sm text-[#6f7075]">Across all active trials</p>
        </div>
        <p className="text-sm font-medium text-[#6f7075]">
          Total tasks: <span className="font-semibold text-[#131416]">{formatCompactCount(statusBreakdown.total)}</span>
        </p>
      </div>

      {statusBreakdown.total === 0 ? (
        <p className="text-sm text-[#6f7075]">No task status data available yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-center">
          <div className="relative mx-auto h-[260px] w-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusBreakdown.slices}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={74}
                  outerRadius={112}
                  paddingAngle={2}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                  onMouseEnter={(_, index) => {
                    const target = statusBreakdown.slices[index];
                    setActiveSliceKey(target?.key ?? null);
                  }}
                  onMouseLeave={() => setActiveSliceKey(null)}
                >
                  {statusBreakdown.slices.map((slice) => (
                    <Cell
                      key={`status-slice-${slice.key}`}
                      fill={slice.color}
                      fillOpacity={
                        activeSliceKey && activeSliceKey !== slice.key ? 0.35 : 1
                      }
                    />
                  ))}
                </Pie>
                <Tooltip cursor={false} content={<StatusDonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>

            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-full border border-red-100 bg-white/95 px-4 py-2 text-center shadow-sm">
                <p className="text-[11px] font-medium leading-[14px] text-[#6f7075]">Overdue</p>
                <p className="text-[22px] font-semibold leading-[24px] text-[#C81E1E]">
                  {formatCompactCount(statusBreakdown.overdue)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-[#fafbfe] p-4">
            {activeSlice ? (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-[#75778B]">Hovered status</p>
                <div className="mt-2 flex items-center gap-2 text-[14px] font-semibold text-[#131416]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeSlice.color }} />
                  <span>{activeSlice.label}</span>
                </div>
                <p className="mt-1 text-[20px] font-semibold leading-[24px] text-[#0E0017]">
                  {formatCompactCount(activeSlice.value)} tasks
                </p>
                <p className="mt-1 text-[12px] font-medium text-[#75778B]">{activeSlice.percent}% of all tasks</p>
              </div>
            ) : (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-[#75778B]">Interaction</p>
                <p className="mt-2 text-[14px] font-medium text-[#4f5570]">
                  Hover a donut segment to see count and percentage.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function MonthlyChannelAreaPanel({
  trials,
  taskRows,
}: {
  trials: AnalyticsTrialOption[];
  taskRows: TaskTimelineRow[];
}) {
  const [selectedTrialId, setSelectedTrialId] = useState("all");
  const [windowWeeks, setWindowWeeks] = useState<4 | 8 | 12>(12);

  useEffect(() => {
    if (selectedTrialId === "all") return;
    if (!trials.some((trial) => trial.id === selectedTrialId)) {
      setSelectedTrialId("all");
    }
  }, [selectedTrialId, trials]);

  const backlogData = useMemo(() => {
    const startOfWeek = (source: Date) => {
      const date = new Date(source.getFullYear(), source.getMonth(), source.getDate());
      const day = date.getDay();
      const daysFromMonday = (day + 6) % 7;
      date.setDate(date.getDate() - daysFromMonday);
      date.setHours(0, 0, 0, 0);
      return date;
    };
    const addDays = (source: Date, days: number) => {
      const date = new Date(source.getTime());
      date.setDate(date.getDate() + days);
      return date;
    };
    const keyForDate = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const historyWeeks = Math.max(24, windowWeeks * 2);
    const currentWeekStart = startOfWeek(new Date());
    const weekStarts = Array.from({ length: historyWeeks }, (_, index) =>
      addDays(currentWeekStart, (index - (historyWeeks - 1)) * 7)
    );
    const indexByWeek = new Map<string, number>(weekStarts.map((date, index) => [keyForDate(date), index]));
    const resolveWeekIndex = (date: Date | null) => {
      if (!date) return undefined;
      return indexByWeek.get(keyForDate(startOfWeek(date)));
    };
    const scopedRows =
      selectedTrialId === "all"
        ? taskRows
        : taskRows.filter((row) => normalizeTrialId(row.trialId) === normalizeTrialId(selectedTrialId));
    const openedRaw = Array.from({ length: historyWeeks }, () => 0);
    const completedRaw = Array.from({ length: historyWeeks }, () => 0);

    for (const row of scopedRows) {
      const task = row.task;
      const openedAt = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
      if (openedAt) {
        const openedIndex = resolveWeekIndex(openedAt);
        if (openedIndex !== undefined) openedRaw[openedIndex] += 1;
      }

      const done = isDoneStatus(task.status);
      if (!done) {
        continue;
      }
      let completedAt = parseDateValue(task.completedDate);
      const updatedAt = parseDateValue(task.updatedAt);
      let completedIndex = resolveWeekIndex(completedAt);
      if (completedAt === null && completedIndex === undefined) {
        completedAt = updatedAt ?? openedAt;
        completedIndex = resolveWeekIndex(completedAt);
      }
      if (completedIndex !== undefined) {
        completedRaw[completedIndex] += 1;
      }
    }

    const displayStart = Math.max(0, weekStarts.length - windowWeeks);
    const displayWeekStarts = weekStarts.slice(displayStart);
    const displayOpenedRaw = openedRaw.slice(displayStart);
    const displayCompletedRaw = completedRaw.slice(displayStart);
    const rollingWindow = 2;
    const toRolling = (values: number[]) =>
      values.map((_, index) => {
        const start = Math.max(0, index - rollingWindow + 1);
        return values.slice(start, index + 1).reduce((sum, value) => sum + value, 0);
      });

    const opened = toRolling(displayOpenedRaw);
    const completed = toRolling(displayCompletedRaw);
    const weekFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
    const points: BacklogPoint[] = displayWeekStarts.map((weekStart, index) => {
      const openedValue = opened[index] ?? 0;
      const completedValue = completed[index] ?? 0;
      return {
        label: weekFormatter.format(weekStart),
        opened: openedValue,
        completed: completedValue,
        net: openedValue - completedValue,
      };
    });

    const currentWindowNet = displayOpenedRaw.reduce((sum, openedValue, index) => {
      return sum + (openedValue - (displayCompletedRaw[index] ?? 0));
    }, 0);
    const previousStart = Math.max(0, displayStart - windowWeeks);
    const previousOpenedRaw = openedRaw.slice(previousStart, displayStart);
    const previousCompletedRaw = completedRaw.slice(previousStart, displayStart);
    const previousWindowNet = previousOpenedRaw.reduce((sum, openedValue, index) => {
      return sum + (openedValue - (previousCompletedRaw[index] ?? 0));
    }, 0);
    const changeFromPrevious = currentWindowNet - previousWindowNet;
    const improving = changeFromPrevious <= 0;
    const { yAxisMax, yAxisTicks } = computeBacklogYAxis(
      points.reduce((max, point) => Math.max(max, point.opened, point.completed), 0)
    );
    const hasSignal = points.some((point) => point.opened > 0 || point.completed > 0);

    return {
      points,
      rollingWindow,
      currentWindowNet,
      changeFromPrevious,
      improving,
      yAxisMax,
      yAxisTicks,
      hasSignal,
    };
  }, [selectedTrialId, taskRows, windowWeeks]);

  const deltaDisplay = `${backlogData.currentWindowNet > 0 ? "+" : ""}${formatCompactCount(backlogData.currentWindowNet)}`;
  const changeDisplay = `${backlogData.changeFromPrevious > 0 ? "+" : ""}${formatCompactCount(backlogData.changeFromPrevious)}`;
  const gradientId = useId().replace(/:/g, "");

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white px-4 pb-4 pt-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h3 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Net backlog delta</h3>
          <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
            {`Last ${windowWeeks} weeks · opened vs completed tasks`}
          </p>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-end gap-3">
          <div className="inline-flex items-center gap-5 text-[13px] font-medium text-[#75778B]">
            <span className="inline-flex items-center gap-2">
              <span className="h-[2px] w-5 rounded-full bg-[#0075FF]" />
              Opened tasks
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-[2px] w-5 rounded-full bg-[#2CD9FF]" />
              Completed tasks
            </span>
            <span className="text-[11px] text-[#75778B]/80">{backlogData.rollingWindow}-week rolling</span>
          </div>

          <select
            value={selectedTrialId}
            onChange={(event) => setSelectedTrialId(event.target.value)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]"
          >
            <option value="all">All trials</option>
            {trials.map((trial) => (
              <option key={trial.id} value={trial.id}>
                {trial.title}
              </option>
            ))}
          </select>

          <select
            value={String(windowWeeks)}
            onChange={(event) => setWindowWeeks(Number(event.target.value) as 4 | 8 | 12)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-[#75778B]"
          >
            <option value="4">Last 4 weeks</option>
            <option value="8">Last 8 weeks</option>
            <option value="12">Last 12 weeks</option>
          </select>
        </div>
      </div>

      <div className="mb-4 inline-flex items-center gap-[14px]">
        <p className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">{deltaDisplay}</p>
        <span
          className={`inline-flex items-center gap-[6px] rounded-[2px] border-[0.6px] px-[6px] py-[3px] text-[12px] font-medium leading-[14px] ${
            backlogData.improving
              ? "border-[rgba(5,193,104,0.20)] bg-[rgba(5,193,104,0.20)] text-[#14CA74]"
              : "border-[rgba(255,90,101,0.20)] bg-[rgba(255,90,101,0.20)] text-[#FF5A65]"
          }`}
        >
          {changeDisplay}
          {backlogData.improving ? (
            <ArrowDownRight className="h-[18px] w-[18px]" />
          ) : (
            <ArrowUpRight className="h-[18px] w-[18px]" />
          )}
        </span>
        <span className="text-[11px] font-medium leading-[13px] text-[#75778B]">{`vs prior ${windowWeeks} weeks`}</span>
      </div>

      {!backlogData.hasSignal && (
        <p className="-mt-1 mb-3 text-[12px] font-medium text-[#75778B]">
          No opened/completed task activity found for the selected time window.
        </p>
      )}

      <div className="h-[310px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={backlogData.points} margin={{ top: 4, right: 8, left: 4, bottom: 8 }}>
            <defs>
              <linearGradient id={`monthlyMobileFill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(0,117,255,0.8)" />
                <stop offset="100%" stopColor="rgba(0,117,255,0)" />
              </linearGradient>
              <linearGradient id={`monthlyWebFill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(44,217,255,0.8)" />
                <stop offset="100%" stopColor="rgba(44,217,255,0)" />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="#56577A" strokeDasharray="5" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#8B8D93" }}
              dy={8}
              height={34}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#8B8D93" }}
              width={36}
              allowDecimals={false}
              ticks={backlogData.yAxisTicks}
              domain={[0, backlogData.yAxisMax]}
            />
            <Tooltip
              cursor={{ stroke: "#B6B6B6", strokeDasharray: "3 3", strokeWidth: 1 }}
              content={<MonthlyChannelTooltip />}
            />
            <Area
              type="linear"
              dataKey="opened"
              stroke="#0075FF"
              strokeWidth={4}
              fill={`url(#monthlyMobileFill-${gradientId})`}
              dot={false}
              activeDot={{ r: 4, fill: "#0075FF", stroke: "#FFFFFF", strokeWidth: 2 }}
            />
            <Area
              type="linear"
              dataKey="completed"
              stroke="#2CD9FF"
              strokeWidth={4}
              fill={`url(#monthlyWebFill-${gradientId})`}
              dot={false}
              activeDot={{ r: 4, fill: "#2CD9FF", stroke: "#FFFFFF", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export default function Analytics2({ embedded = false }: { embedded?: boolean } = {}) {
  const { state, getCurrentDataMode } = useDemoState();
  const [location, setLocation] = useLocation();
  const isHomePage = location === "/";
  const currentDataMode = getCurrentDataMode();
  const hasLoggedViewRef = useRef(false);
  const memberWorkloadCardRef = useRef<HTMLElement | null>(null);
  const memberWorkloadViewportRef = useRef<HTMLDivElement | null>(null);
  const canReplayMemberWorkloadRef = useRef(true);
  const [memberWorkloadAnimationNonce, setMemberWorkloadAnimationNonce] = useState(0);
  const [animateMemberWorkloadGrid, setAnimateMemberWorkloadGrid] = useState(true);
  const [hoveredMemberWorkloadId, setHoveredMemberWorkloadId] = useState<string | null>(null);
  const [memberWorkloadViewportWidth, setMemberWorkloadViewportWidth] = useState(0);
  const [memberWorkloadTooltip, setMemberWorkloadTooltip] = useState<{
    memberId: string;
    label: string;
    tasks: number;
    x: number;
    y: number;
  } | null>(null);

  const { data: trials = [] } = trpc.trials.list.useQuery(
    { demoMode: currentDataMode },
    { refetchInterval: 15000 }
  );

  const workspaceMapQuery = trpc.map.loadWorkspace.useQuery(
    {
      trialIds: trials.map((trial) => trial.id),
      includeArchived: false,
      demoMode: currentDataMode,
    },
    {
      enabled: trials.length > 0,
      refetchInterval: 15000,
    }
  );

  const workspaceRows = useMemo(
    () => ((workspaceMapQuery.data as WorkspaceRow[] | undefined) ?? []).filter(Boolean),
    [workspaceMapQuery.data]
  );

  const workspaceTasks = useMemo(
    () => workspaceRows.flatMap((row) => (Array.isArray(row.tasks) ? row.tasks : [])),
    [workspaceRows]
  );
  const analyticsTrialOptions = useMemo(
    () =>
      trials.map((trial) => ({
        id: normalizeTrialId(trial.id),
        rawId: String(trial.id || ""),
        title: String(trial.investigationalProduct || trial.title || "Untitled trial"),
        sponsor: trial.sponsor ? String(trial.sponsor) : null,
        status: trial.status ? String(trial.status) : null,
        enrolledPatients: Number(trial.enrolledPatients || 0),
        targetPatients: normalizeTargetPatientsValue(
          trial.targetPatients,
          (trial as { sampleSize?: string | null }).sampleSize
        ),
      })),
    [trials]
  );
  const taskTimelineRows = useMemo(
    () =>
      workspaceRows.flatMap((row) => {
        const mapTrialId = normalizeTrialId(String(row.map?.trialId || ""));
        const tasks = Array.isArray(row.tasks) ? row.tasks : [];
        return tasks
          .map((task) => ({
            trialId: mapTrialId || normalizeTrialId(String(task.trialId || "")),
            task,
          }))
          .filter((entry) => entry.trialId);
      }),
    [workspaceRows]
  );
  const phaseTimelineRows = useMemo(
    () =>
      workspaceRows.flatMap((row) => {
        const mapTrialId = normalizeTrialId(String(row.map?.trialId || ""));
        const phases = Array.isArray(row.phases) ? row.phases : [];
        return phases
          .map((phase) => ({
            trialId: mapTrialId,
            phase,
          }))
          .filter((entry) => entry.trialId);
      }),
    [workspaceRows]
  );

  const taskStats = useMemo(() => {
    const tasks = workspaceTasks;
    const now = new Date();
    const nextSevenDays = new Date(now);
    nextSevenDays.setDate(now.getDate() + 7);
    nextSevenDays.setHours(23, 59, 59, 999);

    const total = tasks.length;
    const done = tasks.filter((task) => isDoneStatus(task.status)).length;
    const blocked = tasks.filter((task) => {
      const token = normalizeStatus(task.status);
      return token === "blocked" || token === "waiting";
    }).length;
    const inFlight = tasks.filter((task) => {
      const token = normalizeStatus(task.status);
      return token === "in_progress";
    }).length;
    const unassigned = tasks.filter((task) => !task.assignedUserId).length;
    const dueSoon = tasks.filter((task) => {
      if (isDoneStatus(task.status)) return false;
      const due = parseDateValue(task.dueDate);
      if (!due) return false;
      return due.getTime() >= now.getTime() && due.getTime() <= nextSevenDays.getTime();
    }).length;
    const blockedOver48h = tasks.filter((task) => {
      const token = normalizeStatus(task.status);
      if (token !== "blocked" && token !== "waiting") return false;
      const blockedSince = parseDateValue(task.blockedSince) ?? parseDateValue(task.updatedAt);
      if (!blockedSince) return false;
      return now.getTime() - blockedSince.getTime() >= 48 * 60 * 60 * 1000;
    }).length;

    return { total, done, blocked, inFlight, unassigned, dueSoon, blockedOver48h };
  }, [workspaceTasks]);

  const activeTrials = useMemo(
    () =>
      trials.filter((trial) =>
        ["active", "recruiting"].includes(String(trial.status || "").toLowerCase())
      ).length,
    [trials]
  );

  const donePct = taskStats.total > 0 ? Math.round((taskStats.done / taskStats.total) * 100) : 0;
  const followUpCount = taskStats.blocked + taskStats.unassigned;
  const openTasks = Math.max(0, taskStats.total - taskStats.done);
  const openTasksPreviousWeekEstimate = useMemo(() => {
    const now = new Date();
    const weekAgo = addDays(now, -7);
    const inLastWeek = (value: Date | null) =>
      Boolean(value && value.getTime() > weekAgo.getTime() && value.getTime() <= now.getTime());

    let openedLast7 = 0;
    let completedLast7 = 0;

    for (const task of workspaceTasks) {
      // Use actual created timestamp for week-over-week movement of the all-open queue.
      const openedAt =
        parseDateValue(task.createdAt) ??
        parseDateValue(task.suggestedDate) ??
        parseDateValue(task.dueDate);
      if (inLastWeek(openedAt)) openedLast7 += 1;

      if (!isDoneStatus(task.status)) continue;
      const completedAt = parseDateValue(task.completedDate) ?? parseDateValue(task.updatedAt);
      if (inLastWeek(completedAt)) completedLast7 += 1;
    }

    const netLast7 = openedLast7 - completedLast7;
    return Math.max(0, openTasks - netLast7);
  }, [openTasks, workspaceTasks]);
  const blockedTasksPreviousWeekEstimate = useMemo(() => {
    const now = new Date();
    const weekAgo = addDays(now, -7);

    // Lower-bound prior blocked load: tasks still blocked that were already blocked before last week.
    const blockedCarryover = workspaceTasks.filter((task) => {
      const token = normalizeStatus(task.status);
      if (token !== "blocked" && token !== "waiting") return false;
      const blockedSince = parseDateValue(task.blockedSince) ?? parseDateValue(task.updatedAt);
      if (!blockedSince) return true;
      return blockedSince.getTime() <= weekAgo.getTime();
    }).length;

    // Use a stable carryover proxy so one-off recategorizations do not overstate week-over-week spikes.
    return Math.max(blockedCarryover, taskStats.blockedOver48h);
  }, [taskStats.blockedOver48h, workspaceTasks]);
  const completionRatePreviousWeekEstimate = useMemo(() => {
    const now = new Date();
    const weekAgo = addDays(now, -7);
    const inLastWeek = (value: Date | null) =>
      Boolean(value && value.getTime() > weekAgo.getTime() && value.getTime() <= now.getTime());

    let openedLast7 = 0;
    let completedLast7 = 0;

    for (const task of workspaceTasks) {
      const openedAt =
        parseDateValue(task.createdAt) ??
        parseDateValue(task.suggestedDate) ??
        parseDateValue(task.dueDate);
      if (inLastWeek(openedAt)) openedLast7 += 1;

      if (!isDoneStatus(task.status)) continue;
      const completedAt = parseDateValue(task.completedDate) ?? parseDateValue(task.updatedAt);
      if (inLastWeek(completedAt)) completedLast7 += 1;
    }

    const previousTotal = Math.max(0, taskStats.total - openedLast7);
    const previousDone = Math.max(0, taskStats.done - completedLast7);
    if (previousTotal <= 0) return 0;
    return Math.round((previousDone / previousTotal) * 100);
  }, [taskStats.done, taskStats.total, workspaceTasks]);
  const completionDelta = useMemo(
    () => buildStrictDeltaMetric(donePct, completionRatePreviousWeekEstimate),
    [completionRatePreviousWeekEstimate, donePct]
  );
  const featuredMembers = useMemo(() => state.teamMembers.slice(0, 7), [state.teamMembers]);
  const totalEnrolledPatients = useMemo(
    () =>
      trials.reduce((sum, trial) => sum + Number((trial as { enrolledPatients?: number | null }).enrolledPatients || 0), 0),
    [trials]
  );
  const totalTargetPatients = useMemo(
    () =>
      trials.reduce((sum, trial) => sum + Number((trial as { targetPatients?: number | null }).targetPatients || 0), 0),
    [trials]
  );
  const recruitingTrials = useMemo(
    () => trials.filter((trial) => String(trial.status || "").toLowerCase() === "recruiting").length,
    [trials]
  );
  const patientsRemainingToTarget = useMemo(
    () =>
      trials.reduce((sum, trial) => {
        const enrolled = Number((trial as { enrolledPatients?: number | null }).enrolledPatients || 0);
        const target = Number((trial as { targetPatients?: number | null }).targetPatients || 0);
        if (!Number.isFinite(target) || target <= 0) return sum;
        return sum + Math.max(0, target - enrolled);
      }, 0),
    [trials]
  );
  const metricDeltas = useMemo(() => {
    const baseline = DELTA_BASELINE_BY_MODE[currentDataMode];

    return {
      activeTrialsDelta: buildDeltaMetric(activeTrials, baseline.activeTrials, baseline.activeTrials),
      patientsEnrolledDelta: buildDeltaMetric(totalEnrolledPatients, baseline.patientsEnrolled, baseline.patientsEnrolled),
      openTasksDelta: buildStrictDeltaMetric(openTasks, openTasksPreviousWeekEstimate),
      blockedTasksDelta: buildStrictDeltaMetric(taskStats.blocked, blockedTasksPreviousWeekEstimate),
    };
  }, [
    activeTrials,
    currentDataMode,
    blockedTasksPreviousWeekEstimate,
    openTasks,
    openTasksPreviousWeekEstimate,
    taskStats.blocked,
    totalEnrolledPatients,
  ]);
  const topOverviewCards = useMemo(() => {
    const activeDelta = metricDeltas.activeTrialsDelta;
    const enrolledDelta = metricDeltas.patientsEnrolledDelta;
    const openDelta = metricDeltas.openTasksDelta;

    return [
      {
        key: "active-trials",
        variant: "standard",
        title: "Active trials",
        value: formatCompactCount(activeTrials),
        badge: `${Math.abs(activeDelta.percent).toFixed(0)}%`,
        badgeContext: "from last week",
        footerCount: formatCompactCount(recruitingTrials),
        footerText: "in recruiting status",
        tone: activeDelta.percent >= 0 ? "positive" : "negative",
        direction: activeDelta.percent >= 0 ? "up" : "down",
        icon: TrialElements,
      },
      {
        key: "patients-enrolled",
        variant: "standard",
        title: "Patients enrolled",
        value: formatCompactCount(totalEnrolledPatients),
        badge: `${Math.abs(enrolledDelta.percent).toFixed(0)}%`,
        badgeContext: "from last week",
        footerCount: formatCompactCount(patientsRemainingToTarget),
        footerText: "remaining to target",
        tone: enrolledDelta.percent >= 0 ? "positive" : "negative",
        direction: enrolledDelta.percent >= 0 ? "up" : "down",
        icon: Users,
      },
      {
        key: "open-execution",
        variant: "standard",
        title: "Open tasks",
        value: formatCompactCount(openTasks),
        badge: `${Math.abs(openDelta.percent).toFixed(0)}%`,
        badgeContext: "from last week",
        footerCount: formatCompactCount(taskStats.dueSoon),
        footerText: "due in next 7 days",
        tone: openDelta.percent <= 0 ? "positive" : "negative",
        direction: openDelta.percent >= 0 ? "up" : "down",
        icon: LayoutGrid,
      },
      {
        key: "task-completion",
        variant: "completion",
        title: "Task Completion",
        value: `${donePct}%`,
        badge: `${Math.abs(completionDelta.percent).toFixed(0)}%`,
        badgeContext: "from last week",
        tone: completionDelta.percent >= 0 ? "positive" : "negative",
        direction: completionDelta.percent >= 0 ? "up" : "down",
        footerCount: formatCompactCount(taskStats.done),
        footerText: `of ${taskStats.total.toLocaleString()} tasks completed`,
        icon: CheckCircle2,
      },
    ] as const;
  }, [
    activeTrials,
    completionDelta.percent,
    donePct,
    metricDeltas,
    openTasks,
    patientsRemainingToTarget,
    recruitingTrials,
    taskStats.done,
    taskStats.dueSoon,
    taskStats.total,
    totalEnrolledPatients,
  ]);
  const trendLabels = useMemo(() => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", { month: "short" });
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return formatter.format(date);
    });
  }, []);

  const executionTrend = useMemo(() => {
    const completion = taskStats.total > 0 ? taskStats.done / taskStats.total : 0;
    const risk = taskStats.total > 0 ? taskStats.blocked / taskStats.total : 0;
    const base = Math.max(20000, taskStats.total * 2200, activeTrials * 7000);
    const profile = [
      0,
      0.56 + completion * 0.2,
      0.05 + risk * 0.12,
      0.32 + completion * 0.16,
      0.88 + completion * 0.1 - risk * 0.08,
      0.24 + risk * 0.18,
    ];

    return trendLabels.map((label, index) => ({
      name: label,
      value: Math.max(0, Math.round(base * profile[index])),
    }));
  }, [activeTrials, taskStats.blocked, taskStats.done, taskStats.total, trendLabels]);

  const chartCeiling = useMemo(() => {
    const maxValue = executionTrend.reduce((max, point) => Math.max(max, point.value), 0);
    if (!maxValue) return 20000;
    const step = 20000;
    return Math.ceil(maxValue / step) * step;
  }, [executionTrend]);

  const chartTicks = useMemo(() => {
    const step = chartCeiling / 4;
    return [0, step, step * 2, step * 3, step * 4].map((tick) => Math.round(tick));
  }, [chartCeiling]);

  const resolveTaskOwner = useMemo(() => {
    type TeamMemberLite = (typeof state.teamMembers)[number];

    const allMembers = (state.teamMembers || []).filter(Boolean) as TeamMemberLite[];
    const memberById = new Map<string, TeamMemberLite>();
    const memberByNumericId = new Map<string, TeamMemberLite>();
    const memberByName = new Map<string, TeamMemberLite>();
    const membersByRole = new Map<string, TeamMemberLite[]>();

    for (const member of state.teamMembers || []) {
      const rawId = String(member.id || "").trim();
      if (rawId) {
        memberById.set(rawId, member);
        const numericPart = rawId.replace(/^member-/i, "");
        if (/^\d+$/.test(numericPart)) {
          memberByNumericId.set(numericPart, member);
        }
      }

      const normalizedName = normalizePersonName(member.name);
      if (normalizedName && !memberByName.has(normalizedName)) {
        memberByName.set(normalizedName, member);
      }

      const roleToken = normalizeRoleToken(member.clinicalRole || member.role);
      if (roleToken) {
        const bucket = membersByRole.get(roleToken) || [];
        bucket.push(member);
        membersByRole.set(roleToken, bucket);
      }
    }

    return (task: WorkspaceTask, trialId: string) => {
      const assignedToken = task.assignedUserId == null ? "" : String(task.assignedUserId).trim();
      const normalizedAssigned = assignedToken.replace(/^member-/i, "");
      let resolvedMember: TeamMemberLite | null =
        memberById.get(assignedToken) ||
        memberById.get(`member-${normalizedAssigned}`) ||
        memberByNumericId.get(normalizedAssigned) ||
        null;

      if (!resolvedMember) {
        const suggestedName = normalizePersonName(task.suggestedAssignee);
        if (suggestedName) {
          resolvedMember = memberByName.get(suggestedName) || null;
        }
      }

      if (!resolvedMember) {
        const roleToken = normalizeRoleToken(task.assignedRole);
        if (roleToken) {
          const roleCandidates = membersByRole.get(roleToken) || [];
          const candidates =
            roleCandidates.length > 1 ? roleCandidates : allMembers.length > 0 ? allMembers : roleCandidates;
          if (candidates.length > 0) {
            const seed = `${trialId}|${String(task.id || "")}|${roleToken}|${String(task.dueDate || "")}`;
            resolvedMember = candidates[hashString(seed) % candidates.length];
          }
        }
      }

      if (resolvedMember) {
        const memberId = String(resolvedMember.id || "").trim();
        const memberName = String(resolvedMember.name || "").trim() || "Team member";
        return {
          id: memberId || `member-name:${normalizePersonName(memberName)}`,
          name: memberName,
          initials: String(resolvedMember.initials || "").trim() || initialsFromName(memberName),
          avatar: typeof resolvedMember.avatar === "string" ? resolvedMember.avatar : null,
          isUnassigned: false,
        };
      }

      return {
        id: "unassigned",
        name: "Unassigned",
        initials: "UN",
        avatar: null,
        isUnassigned: true,
      };
    };
  }, [state.teamMembers]);

  const memberWorkloadData = useMemo(() => {
    type TeamLoadEntry = {
      id: string;
      name: string;
      count: number;
      initials: string;
      avatar: string | null;
      isUnassigned: boolean;
    };

    const counts = new Map<string, TeamLoadEntry>();
    const addCount = (entry: Omit<TeamLoadEntry, "count">) => {
      const existing = counts.get(entry.id);
      if (existing) {
        existing.count += 1;
        return;
      }
      counts.set(entry.id, { ...entry, count: 1 });
    };

    for (const row of workspaceRows) {
      const trialId = normalizeTrialId(String(row.map?.trialId || ""));
      for (const task of row.tasks || []) {
        if (isDoneStatus(task.status)) continue;
        const resolved = resolveTaskOwner(task, trialId);
        addCount(resolved);
      }
    }

    const allEntries = Array.from(counts.values());
    const unassignedEntry = allEntries.find((entry) => entry.isUnassigned) || null;
    const memberEntries = allEntries
      .filter((entry) => !entry.isUnassigned)
      .sort((a, b) => b.count - a.count);
    const entries = memberEntries.slice(0, 8);
    const totalOpen = allEntries.reduce((sum, entry) => sum + entry.count, 0);
    const unassignedOpen = unassignedEntry?.count || 0;
    const assignedOpen = Math.max(0, totalOpen - unassignedOpen);
    const maxCount = entries.reduce((max, entry) => Math.max(max, entry.count), 0);

    return {
      entries,
      totalOpen,
      assignedOpen,
      unassignedOpen,
      membersWithLoad: memberEntries.length,
      maxCount,
    };
  }, [resolveTaskOwner, workspaceRows]);

  const memberWorkloadDots = useMemo(() => {
    const maxRows = 8;
    const dotColumns = 24;
    const now = new Date();
    const currentWeekStart = startOfWeekDate(now);
    const firstWeekStart = addDays(currentWeekStart, -(dotColumns - 1) * 7);
    const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
    const weekStarts = Array.from({ length: dotColumns }, (_, index) =>
      addDays(firstWeekStart, index * 7)
    );

    type DotRow = {
      id: string;
      name: string;
      initials: string;
      avatar: string | null;
      count: number;
      weeks: number[];
    };

    const rowsById = new Map<string, DotRow>();
    for (const entry of memberWorkloadData.entries.slice(0, maxRows)) {
      rowsById.set(entry.id, {
        id: entry.id,
        name: entry.name,
        initials: entry.initials,
        avatar: entry.avatar,
        count: 0,
        weeks: Array(dotColumns).fill(0),
      });
    }

    if (rowsById.size === 0) {
      for (const member of state.teamMembers.slice(0, maxRows)) {
        const name = String(member.name || "").trim() || "Team member";
        const id = String(member.id || "").trim() || `member-name:${normalizePersonName(name)}`;
        rowsById.set(id, {
          id,
          name,
          initials: String(member.initials || "").trim() || initialsFromName(name),
          avatar: typeof member.avatar === "string" ? member.avatar : null,
          count: 0,
          weeks: Array(dotColumns).fill(0),
        });
      }
    }

    for (const row of workspaceRows) {
      const trialId = normalizeTrialId(String(row.map?.trialId || ""));
      for (const task of row.tasks || []) {
        if (isDoneStatus(task.status)) continue;
        const resolved = resolveTaskOwner(task, trialId);
        if (resolved.isUnassigned) continue;

        let rowEntry = rowsById.get(resolved.id);
        if (!rowEntry) {
          if (rowsById.size >= maxRows) continue;
          rowEntry = {
            id: resolved.id,
            name: resolved.name,
            initials: resolved.initials,
            avatar: resolved.avatar,
            count: 0,
            weeks: Array(dotColumns).fill(0),
          };
          rowsById.set(resolved.id, rowEntry);
        }

        rowEntry.count += 1;
        const eventDate =
          parseDateValue(task.dueDate) ||
          parseDateValue(task.createdAt) ||
          parseDateValue(task.updatedAt) ||
          null;
        if (!eventDate) continue;

        const weekIndex = weeksBetweenWeekStarts(firstWeekStart, startOfWeekDate(eventDate));
        if (weekIndex < 0 || weekIndex >= dotColumns) continue;
        rowEntry.weeks[weekIndex] += 1;
      }
    }

    const seededRows = Array.from(rowsById.values());
    const nonZeroRows = seededRows.filter((row) => row.count > 0);
    const orderedRows = (nonZeroRows.length > 0 ? nonZeroRows : seededRows)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, maxRows);

    const maxWeekCount = Math.max(1, ...orderedRows.flatMap((row) => row.weeks));
    const rows = orderedRows.map((row) => {
      const rowMax = Math.max(1, ...row.weeks);
      const cells = row.weeks.map((count, index) => {
        if (count <= 0) return { color: "#EEF2F8", opacity: 1 };
        const gradientPosition = index / Math.max(dotColumns - 1, 1);
        const baseColor = executionChartColorAt(gradientPosition);
        const intensity = Math.max(
          0.45,
          Math.min(1, (count / rowMax) * 0.75 + (count / maxWeekCount) * 0.25)
        );
        return { color: baseColor, opacity: intensity };
      });
      return { ...row, cells };
    });

    const monthMarkers = weekStarts
      .map((weekStart, index) => ({ weekStart, index }))
      .filter(({ weekStart, index }) =>
        index === 0 || monthFormatter.format(weekStart) !== monthFormatter.format(weekStarts[index - 1]!)
      )
      .map(({ weekStart, index }) => ({
        label: monthFormatter.format(weekStart),
        index,
      }));

    return {
      rows,
      monthMarkers,
      dotColumns,
    };
  }, [memberWorkloadData.entries, resolveTaskOwner, state.teamMembers, workspaceRows]);

  const memberWorkloadGrid = useMemo(() => {
    const seededMembers = state.teamMembers.slice(0, 13).map((member, index) => {
      const name = String(member.name || "").trim() || `Member ${index + 1}`;
      const memberId = String(member.id || "").trim() || `member-name:${normalizePersonName(name)}`;
      return {
        memberId,
        label: firstName(name),
        tasks: 0,
      };
    });

    const points =
      seededMembers.length > 0
        ? seededMembers
        : Array.from({ length: 13 }, (_, index) => ({
            memberId: `member-${index + 1}`,
            label: `M${index + 1}`,
            tasks: 0,
          }));

    const countsByMemberId = new Map<string, number>(points.map((member) => [member.memberId, 0]));
    for (const row of workspaceRows) {
      const trialId = normalizeTrialId(String(row.map?.trialId || ""));
      for (const task of row.tasks || []) {
        if (isDoneStatus(task.status)) continue;
        const resolved = resolveTaskOwner(task, trialId);
        if (resolved.isUnassigned) continue;
        if (!countsByMemberId.has(resolved.id)) continue;
        countsByMemberId.set(resolved.id, (countsByMemberId.get(resolved.id) || 0) + 1);
      }
    }

    const columns = points.map((member) => ({
      ...member,
      tasks: countsByMemberId.get(member.memberId) || 0,
    }));
    const rows = columns;
    const xAxisMax = 77;
    const cellGap = 2;
    const labelColumnWidth = 80;
    const labelToChartGap = 8;
    const fallbackViewportWidth = 1480;
    const resolvedViewportWidth =
      memberWorkloadViewportWidth > 0 ? memberWorkloadViewportWidth : fallbackViewportWidth;
    const targetChartWidth = Math.max(
      640,
      Math.floor(resolvedViewportWidth - labelColumnWidth - labelToChartGap)
    );
    const targetChartHeight = 260;
    const maxCellByWidth = Math.floor(
      (targetChartWidth - Math.max(0, xAxisMax - 1) * cellGap) / Math.max(1, xAxisMax)
    );
    const maxCellByHeight = Math.floor(
      (targetChartHeight - Math.max(0, rows.length - 1) * cellGap) / Math.max(1, rows.length)
    );
    const cellSize = Math.max(8, Math.min(maxCellByWidth, maxCellByHeight));
    const chartWidth = xAxisMax * cellSize + Math.max(0, xAxisMax - 1) * cellGap;
    const chartHeight = rows.length * cellSize + Math.max(0, rows.length - 1) * cellGap;
    const xAxisStep = 10;
    const xTickValues = Array.from({ length: xAxisMax + 1 }, (_, value) => value).filter(
      (value) => value === 0 || value % xAxisStep === 0
    );

    return {
      rows,
      xAxisMax,
      cellSize,
      cellGap,
      chartWidth,
      chartHeight,
      xTickValues,
    };
  }, [memberWorkloadViewportWidth, resolveTaskOwner, state.teamMembers, workspaceRows]);
  const memberWorkloadTickPositionPx = (tick: number) => {
    if (tick <= 0) return 0;
    return (
      (tick - 1) * (memberWorkloadGrid.cellSize + memberWorkloadGrid.cellGap) +
      memberWorkloadGrid.cellSize / 2
    );
  };
  const updateMemberWorkloadHoverState = (
    member: (typeof memberWorkloadGrid.rows)[number],
    clientX: number,
    clientY: number
  ) => {
    const node = memberWorkloadCardRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const tooltipWidth = 146;
    const tooltipHeight = 54;
    const x = Math.max(12, Math.min(rect.width - tooltipWidth - 12, clientX - rect.left + 10));
    const y = Math.max(68, Math.min(rect.height - tooltipHeight - 10, clientY - rect.top - tooltipHeight - 8));
    setHoveredMemberWorkloadId(member.memberId);
    setMemberWorkloadTooltip({
      memberId: member.memberId,
      label: member.label,
      tasks: member.tasks,
      x,
      y,
    });
  };

  useEffect(() => {
    if (!animateMemberWorkloadGrid || typeof window === "undefined") return;
    const timeoutId = window.setTimeout(() => setAnimateMemberWorkloadGrid(false), 820);
    return () => window.clearTimeout(timeoutId);
  }, [animateMemberWorkloadGrid, memberWorkloadAnimationNonce]);

  useEffect(() => {
    const node = memberWorkloadCardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const ratio = Number(entry.intersectionRatio || 0);
        const isClearlyVisible = entry.isIntersecting && ratio >= 0.12;
        const isClearlyOut = !entry.isIntersecting || ratio <= 0.01;

        if (isClearlyVisible && canReplayMemberWorkloadRef.current) {
          canReplayMemberWorkloadRef.current = false;
          setAnimateMemberWorkloadGrid(true);
          setMemberWorkloadAnimationNonce((value) => value + 1);
        }

        if (isClearlyOut) {
          canReplayMemberWorkloadRef.current = true;
          setHoveredMemberWorkloadId(null);
          setMemberWorkloadTooltip(null);
        }
      },
      { threshold: [0, 0.05, 0.12] }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = memberWorkloadViewportRef.current;
    if (!node) return;

    const updateViewportWidth = () => {
      const next = Math.floor(node.getBoundingClientRect().width);
      if (!Number.isFinite(next) || next <= 0) return;
      setMemberWorkloadViewportWidth((previous) => (Math.abs(previous - next) > 1 ? next : previous));
    };

    updateViewportWidth();

    if (typeof ResizeObserver === "undefined") {
      if (typeof window === "undefined") return;
      window.addEventListener("resize", updateViewportWidth);
      return () => window.removeEventListener("resize", updateViewportWidth);
    }

    const observer = new ResizeObserver(() => updateViewportWidth());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hoveredMemberWorkloadId) {
      setMemberWorkloadTooltip(null);
      return;
    }
    if (memberWorkloadGrid.rows.some((row) => row.memberId === hoveredMemberWorkloadId)) return;
    setHoveredMemberWorkloadId(null);
    setMemberWorkloadTooltip(null);
  }, [hoveredMemberWorkloadId, memberWorkloadGrid.rows]);

  useEffect(() => {
    if (hasLoggedViewRef.current) return;
    hasLoggedViewRef.current = true;
    logEvent({
      eventType: "feature_used",
      action: "view_analytics_summary",
      entityType: "analytics",
      payload: {
        demoMode: currentDataMode,
        trialCount: trials.length,
        taskTotal: taskStats.total,
      },
    });
  }, [currentDataMode, taskStats.total, trials.length]);

  return (
    <div className="flex flex-col gap-3 px-8 pb-8 pt-0">
      {!embedded && (
        <div className="sticky top-0 z-40 -mx-8 bg-[#f6f7fb] px-8 pt-4">
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
                {isHomePage ? "Home" : "Analytics Dashboard"}
              </h1>
              <p className="text-sm text-muted-foreground">
                Cross-trial execution metrics for workload, throughput, and risk.
              </p>
            </div>

            <div className="flex h-11 items-center gap-6 rounded-md border border-gray-200 bg-white px-5 py-0">
              <div className="flex items-center gap-2">
                {!isHomePage && (
                  <button
                    type="button"
                    className="pr-5 text-xs text-gray-500 transition-colors hover:text-gray-700 border-r border-gray-200 flex items-center gap-2"
                    onClick={() => {
                      if (window.history.length > 1) {
                        window.history.back();
                        return;
                      }
                      setLocation("/");
                    }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                )}
                <div className="no-scrollbar flex items-center gap-1 overflow-x-auto">
                  <button
                    type="button"
                    className="whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors flex items-center gap-2 text-blue-700 bg-blue-50"
                  >
                    {isHomePage ? <Home className="h-4 w-4" /> : <AnalyticsIcon className="h-4 w-4" />}
                    {isHomePage ? "Home" : "Analytics Dashboard"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-4">
        {topOverviewCards.map((item) => {
          const Icon = item.icon;
          if (item.variant === "completion") {
            const positive = item.tone === "positive";
            const directionUp = item.direction === "up";
            return (
              <article key={item.key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="px-5 pb-4 pt-[18px]">
                  <div className="mb-[18px] flex items-center justify-between">
                    <span className="whitespace-nowrap text-[14px] font-medium leading-[20px] text-[#75778B]">
                      {item.title}
                    </span>
                    <span className="flex h-8 w-8 translate-x-1 items-center justify-center rounded-[7px] bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-[14px]">
                    <p className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
                      {item.value}
                    </p>
                    <div className="inline-flex items-center gap-2">
                      <span
                        className={`flex flex-col items-start gap-[10px] rounded-[2px] border-[0.6px] px-[6px] py-[3px] ${
                          positive
                            ? "border-[rgba(5,193,104,0.20)] bg-[rgba(5,193,104,0.20)]"
                            : "border-[rgba(255,90,101,0.20)] bg-[rgba(255,90,101,0.20)]"
                        }`}
                      >
                        <span
                          className={`inline-flex items-center gap-[6px] text-[12px] font-medium leading-[14px] ${
                            positive ? "text-[#14CA74]" : "text-[#FF5A65]"
                          }`}
                        >
                          {item.badge}
                          {directionUp ? (
                            <ArrowUpRight className="h-[18px] w-[18px]" />
                          ) : (
                            <ArrowDownRight className="h-[18px] w-[18px]" />
                          )}
                        </span>
                      </span>
                      <span className="text-[11px] font-medium leading-[13px] text-[#75778B]">
                        {item.badgeContext}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between bg-[#FAFAFA] px-5 py-3">
                  <p className="flex items-center">
                    <span className="tabular-nums text-[14px] font-semibold leading-[20px] text-[#0E0017]">
                      +{item.footerCount}
                    </span>
                    <span className="ml-2 whitespace-nowrap text-[14px] font-medium leading-[20px] text-[#75778B]">
                      {item.footerText}
                    </span>
                  </p>
                  <span className="flex h-8 w-8 translate-x-1 items-center justify-center">
                    <ChevronRight className="h-4 w-4 text-[#75778B]" />
                  </span>
                </div>
              </article>
            );
          }

          const positive = item.tone === "positive";
          const directionUp = item.direction === "up";
          return (
            <article
              key={item.key}
              className="overflow-hidden rounded-lg border border-gray-200 bg-white"
            >
              <div className="px-5 pb-4 pt-[18px]">
                <div className="mb-[18px] flex items-center justify-between">
                  <span className="whitespace-nowrap text-[14px] font-medium leading-[20px] text-[#75778B]">
                    {item.title}
                  </span>
                  <span className="flex h-8 w-8 translate-x-1 items-center justify-center rounded-[7px] bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </span>
                </div>
                <div className="inline-flex items-center gap-[14px]">
                  <p className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
                    {item.value}
                  </p>
                  <div className="inline-flex items-center gap-2">
                    <span
                      className={`flex flex-col items-start gap-[10px] rounded-[2px] border-[0.6px] px-[6px] py-[3px] ${
                        positive
                          ? "border-[rgba(5,193,104,0.20)] bg-[rgba(5,193,104,0.20)]"
                          : "border-[rgba(255,90,101,0.20)] bg-[rgba(255,90,101,0.20)]"
                      }`}
                    >
                      <span
                        className={`inline-flex items-center gap-[6px] text-[12px] font-medium leading-[14px] ${
                          positive ? "text-[#14CA74]" : "text-[#FF5A65]"
                        }`}
                      >
                        {item.badge}
                        {directionUp ? (
                          <ArrowUpRight className="h-[18px] w-[18px]" />
                        ) : (
                          <ArrowDownRight className="h-[18px] w-[18px]" />
                        )}
                      </span>
                    </span>
                    <span className="text-[11px] font-medium leading-[13px] text-[#75778B]">
                      {item.badgeContext}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between bg-[#FAFAFA] px-5 py-3">
                <p className="flex items-center">
                  <span className="tabular-nums text-[14px] font-semibold leading-[20px] text-[#0E0017]">
                    +{item.footerCount}
                  </span>
                  <span className="ml-2 whitespace-nowrap text-[14px] font-medium leading-[20px] text-[#75778B]">
                    {item.footerText}
                  </span>
                </p>
                <span className="flex h-8 w-8 translate-x-1 items-center justify-center">
                  <ChevronRight className="h-4 w-4 text-[#75778B]" />
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <UpcomingWorkloadPanel
        trials={analyticsTrialOptions}
        taskRows={taskTimelineRows}
        phaseRows={phaseTimelineRows}
      />

      <NetBacklogWorkloadPanel trials={analyticsTrialOptions} taskRows={taskTimelineRows} />

      <BlockedReasonsSplitWorkloadPanel
        trials={analyticsTrialOptions}
        taskRows={taskTimelineRows}
        blockedDeltaPercent={metricDeltas.blockedTasksDelta.percent}
      />

      <section className="mb-2 grid gap-4 lg:grid-cols-2">
        <EnrollmentWorkloadBarPanel
          trials={analyticsTrialOptions}
          taskRows={taskTimelineRows}
          phaseRows={phaseTimelineRows}
        />
        <ThreadResolutionGaugePanel trials={analyticsTrialOptions} />
      </section>

      <section className="mb-2">
        <article
          ref={memberWorkloadCardRef}
          className="relative flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white px-6 pb-6 pt-5"
        >
          <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </span>
          <div className="mb-5 pr-14">
            <h3 className="text-[20px] font-semibold leading-[28px] text-[#0E0017]">Member workload</h3>
            <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
              Task count by team member · each square = 1 task
            </p>
          </div>

          <style>{`
            @keyframes memberWorkloadCellWipeIn {
              from {
                opacity: 0.18;
                transform: scaleX(0.08);
              }
              to {
                opacity: 1;
                transform: scaleX(1);
              }
            }
          `}</style>

          <div
            ref={memberWorkloadViewportRef}
            className="mt-1 min-h-0 flex-1 overflow-hidden"
            onMouseLeave={() => {
              setHoveredMemberWorkloadId(null);
              setMemberWorkloadTooltip(null);
            }}
          >
            <div
              className="inline-grid items-start gap-2 pb-1"
              style={{ gridTemplateColumns: `80px ${memberWorkloadGrid.chartWidth}px` }}
            >
              <div
                className="grid"
                style={{
                  gridTemplateRows: `repeat(${Math.max(1, memberWorkloadGrid.rows.length)}, ${memberWorkloadGrid.cellSize}px)`,
                  rowGap: `${memberWorkloadGrid.cellGap}px`,
                  height: `${memberWorkloadGrid.chartHeight}px`,
                }}
              >
                {memberWorkloadGrid.rows.map((member) => (
                  <span
                    key={`member-workload-y-label-${member.memberId}`}
                    className="inline-flex items-center truncate pr-2 text-[11px] font-semibold leading-[14px] text-[#7A8193]"
                    title={member.label}
                    onMouseEnter={(event) =>
                      updateMemberWorkloadHoverState(member, event.clientX, event.clientY)
                    }
                    onMouseMove={(event) =>
                      updateMemberWorkloadHoverState(member, event.clientX, event.clientY)
                    }
                    style={{
                      opacity:
                        hoveredMemberWorkloadId && hoveredMemberWorkloadId !== member.memberId ? 0.28 : 1,
                      transition: "opacity 180ms ease",
                    }}
                  >
                    {member.label}
                  </span>
                ))}
              </div>

              <div>
                <div
                  key={`member-workload-grid-${memberWorkloadAnimationNonce}`}
                  className="grid"
                  style={{
                    gridTemplateRows: `repeat(${Math.max(1, memberWorkloadGrid.rows.length)}, ${memberWorkloadGrid.cellSize}px)`,
                    rowGap: `${memberWorkloadGrid.cellGap}px`,
                    width: `${memberWorkloadGrid.chartWidth}px`,
                    height: `${memberWorkloadGrid.chartHeight}px`,
                  }}
                >
                  {memberWorkloadGrid.rows.map((member, rowIndex) => (
                    <div
                      key={`member-workload-row-${member.memberId}`}
                      className="grid"
                      title={`${member.label}: ${member.tasks} open tasks`}
                      onMouseEnter={(event) =>
                        updateMemberWorkloadHoverState(member, event.clientX, event.clientY)
                      }
                      onMouseMove={(event) =>
                        updateMemberWorkloadHoverState(member, event.clientX, event.clientY)
                      }
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(1, memberWorkloadGrid.xAxisMax)}, ${memberWorkloadGrid.cellSize}px)`,
                        columnGap: `${memberWorkloadGrid.cellGap}px`,
                        width: `${memberWorkloadGrid.chartWidth}px`,
                        height: `${memberWorkloadGrid.cellSize}px`,
                        opacity:
                          hoveredMemberWorkloadId && hoveredMemberWorkloadId !== member.memberId ? 0.28 : 1,
                        transition: "opacity 180ms ease",
                      }}
                    >
                      {Array.from({ length: Math.max(1, memberWorkloadGrid.xAxisMax) }, (_, columnIndex) => {
                        const level = columnIndex + 1;
                        const filled = member.tasks >= level;
                        const cornerRadius = Math.max(2, Math.round(memberWorkloadGrid.cellSize * 0.22));
                        const animationStyle =
                          filled && animateMemberWorkloadGrid
                            ? ({
                                transformOrigin: "left center",
                                animationName: "memberWorkloadCellWipeIn",
                                animationDuration: "360ms",
                                animationTimingFunction: "cubic-bezier(0.22,1,0.36,1)",
                                animationFillMode: "both",
                                animationDelay: `${columnIndex * 20 + rowIndex * 8}ms`,
                              } as CSSProperties)
                            : undefined;
                        return (
                          <span
                            key={`member-workload-cell-${member.memberId}-${level}`}
                            className="block"
                            style={{
                              width: `${memberWorkloadGrid.cellSize}px`,
                              height: `${memberWorkloadGrid.cellSize}px`,
                              borderRadius: `${cornerRadius}px`,
                              backgroundColor: filled ? "#5654D4" : "#ECEDEF",
                              ...animationStyle,
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>

                <div className="relative mt-2 h-[16px]" style={{ width: `${memberWorkloadGrid.chartWidth}px` }}>
                  {memberWorkloadGrid.xTickValues.map((tick) => (
                    <span
                      key={`member-workload-x-tick-${tick}`}
                      className="absolute top-0 text-[10px] font-semibold leading-none text-[#7A8193]"
                      style={{
                        left: `${memberWorkloadTickPositionPx(tick)}px`,
                        transform:
                          tick === 0
                            ? "translateX(0)"
                            : tick === memberWorkloadGrid.xAxisMax
                              ? "translateX(-100%)"
                              : "translateX(-50%)",
                      }}
                    >
                      {tick}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {memberWorkloadTooltip ? (
            <div
              className="pointer-events-none absolute z-20 rounded-[10px] border border-[#E2E5EB] bg-white px-3 py-2 shadow-[0_10px_28px_rgba(14,0,23,0.14)]"
              style={{
                left: `${memberWorkloadTooltip.x}px`,
                top: `${memberWorkloadTooltip.y}px`,
              }}
            >
              <div className="mb-1 text-[11px] font-medium leading-[14px] text-[#75778B]">
                {memberWorkloadTooltip.label}
              </div>
              <div className="flex items-center gap-1.5 text-[12px] font-semibold leading-[16px] text-[#0E0017]">
                <span className="h-[7px] w-[7px] rounded-full bg-[#5654D4]" />
                <span>{`${memberWorkloadTooltip.tasks} open tasks`}</span>
              </div>
            </div>
          ) : null}
        </article>
      </section>

      <BlockedReasonsByTrialPanel
        trials={analyticsTrialOptions}
        taskRows={taskTimelineRows}
        blockedDeltaPercent={metricDeltas.blockedTasksDelta.percent}
      />

      <DarkRevenuePerformancePanel trials={analyticsTrialOptions} taskRows={taskTimelineRows} />

      <section className="mb-6 rounded-lg border border-[#e7e7e8] bg-[#fcfcfd] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_rgba(15,23,42,0.06)]">
        <div className="mb-4 flex items-center justify-between px-2">
          <h2 className="text-xl font-semibold text-[#131416]">Overview</h2>
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[#d8d8db] bg-transparent px-4 text-sm text-[#2f3033]"
          >
            Last 7 days
            <ChevronDown className="h-4 w-4 text-[#6f7075]" />
          </button>
        </div>

        <div className="rounded-lg border border-[#e4e5e7] bg-[#f9fafb] px-2 pb-2 pt-3">
          <div className="relative h-[310px] w-full">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-[50px] left-[52px] right-[14px] top-[14px] z-0"
              style={{
                backgroundImage: [
                  "linear-gradient(to right, rgba(185,193,217,0.26) 1px, transparent 1px)",
                  "linear-gradient(to top, rgba(185,193,217,0.26) 1px, transparent 1px)",
                ].join(", "),
                backgroundSize: "56px 56px, 56px 56px",
                WebkitMaskImage:
                  "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 58%, rgba(0,0,0,0.18) 100%)",
                maskImage:
                  "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 58%, rgba(0,0,0,0.18) 100%)",
              }}
            />
            <ResponsiveContainer width="100%" height="100%" className="relative z-10">
              <AreaChart data={executionTrend} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="analyticsExecutionStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                    {EXECUTION_CHART_GRADIENT_STOPS.map((stop) => (
                      <stop key={`stroke-${stop.offset}`} offset={stop.offset} stopColor={stop.color} />
                    ))}
                  </linearGradient>
                  <linearGradient id="analyticsExecutionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    {EXECUTION_CHART_GRADIENT_STOPS.map((stop) => (
                      <stop
                        key={`fill-${stop.offset}`}
                        offset={stop.offset}
                        stopColor={stop.color}
                        stopOpacity={0.2}
                      />
                    ))}
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#8b8d93" }}
                  dy={14}
                  height={42}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#8b8d93" }}
                  tickFormatter={formatChartAxis}
                  ticks={chartTicks}
                  width={44}
                  domain={[0, chartCeiling]}
                />
                <Tooltip content={<TrendTooltip />} cursor={{ stroke: "#d8dce1", strokeWidth: 2 }} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="url(#analyticsExecutionStroke)"
                  strokeWidth={3}
                  fill="url(#analyticsExecutionGradient)"
                  activeDot={{
                    r: 5.5,
                    fill: "#ffffff",
                    stroke: "#0047FF",
                    strokeWidth: 3,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <StudentEnrollmentCard />
        <TrafficSourcesCard />

        <div className="mt-3 grid grid-cols-1 gap-4 px-4 xl:grid-cols-[1fr_auto] xl:items-center">
          <div>
            <p className="text-2xl font-semibold text-[#202226]">
              {followUpCount.toLocaleString()} execution items need follow-up
            </p>
            <p className="mt-1 text-sm text-[#6f7075]">
              Route owners and unblock trial operations.
            </p>

            <div className="relative mt-3">
              <div className="flex gap-5 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {featuredMembers.map((member) => (
                  <div key={member.id} className="min-w-[80px] flex-none text-center">
                    <div className="mx-auto h-16 w-16 overflow-hidden rounded-full bg-[#e9eaed]">
                      {member.avatar ? (
                        <img src={member.avatar} alt={member.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[#6f7075]">
                          {member.initials || firstName(member.name).slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <p className="mt-2 truncate text-sm text-[#55565a]">{firstName(member.name)}</p>
                  </div>
                ))}
                <div className="min-w-[80px] flex-none text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#d8d8db] bg-transparent">
                    <ArrowRight className="h-5 w-5 text-[#6f7075]" />
                  </div>
                  <p className="mt-2 text-sm text-[#55565a]">View all</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto xl:mx-0">
            <GradientCompletionGauge value={100} />
          </div>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-border shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Task Completion</CardTitle>
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{donePct}%</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {taskStats.done} / {taskStats.total} tasks
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Blocked Tasks</CardTitle>
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{taskStats.blocked}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {taskStats.inFlight} currently in progress
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unassigned</CardTitle>
            <Activity className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{taskStats.unassigned}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              tasks without an owner
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="relative mb-2 overflow-hidden rounded-[20px] border border-[#E8EAF2] bg-white px-5 pb-5 pt-5 shadow-[2px_4px_24px_0px_rgba(170,170,170,0.10)]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-[80px] border border-[#E4ECF6] bg-[rgba(255,255,255,0.1)] shadow-[inset_0px_0px_8px_0px_rgba(0,73,153,0.25)]">
              <Users className="h-6 w-6 text-[#004999]" />
            </span>
            <div className="leading-[1.2]">
              <h2 className="text-[20px] font-semibold text-[#121212]">Workload by Team Member</h2>
              <p className="mt-1 text-[14px] font-normal text-[#121212]">
                Last 12 months · assignment activity
              </p>
            </div>
          </div>

          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[14px] font-normal text-[#121212]"
          >
            Yearly
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        {memberWorkloadDots.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No task workload data yet.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-[14px] border border-[#E7EBF3] bg-[linear-gradient(270deg,rgba(82,213,255,0.14)_0%,rgba(0,71,255,0.1)_50.52%,rgba(219,183,255,0.14)_100%)] p-3">
            <div className="space-y-2">
              {memberWorkloadDots.rows.map((member) => (
                <div
                  key={`member-dot-row-${member.id}`}
                  className="grid grid-cols-[190px_minmax(0,1fr)_44px] items-center gap-x-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#DFE7F3] bg-white/80">
                      {member.avatar ? (
                        <img src={member.avatar} alt={member.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-[10px] font-semibold text-[#66708A]">{member.initials}</span>
                      )}
                    </span>
                    <span className="truncate text-[13px] font-medium text-[#2B3244]">{member.name}</span>
                  </div>

                  <div
                    className="grid gap-[2px]"
                    style={{
                      gridTemplateColumns: `repeat(${memberWorkloadDots.dotColumns}, minmax(0, 1fr))`,
                    }}
                    aria-hidden="true"
                  >
                    {member.cells.map((cell, index) => (
                      <span
                        key={`member-dot-cell-${member.id}-${index}`}
                        className="block h-[10px] w-full rounded-none"
                        style={{ backgroundColor: cell.color, opacity: cell.opacity }}
                      />
                    ))}
                  </div>

                  <span className="text-right text-[12px] font-semibold text-[#66708A]">{member.count}</span>
                </div>
              ))}
            </div>

            <div className="relative mt-3 ml-[193px] mr-[46px] h-[18px]">
              {memberWorkloadDots.monthMarkers.map((marker) => {
                const leftPct =
                  (marker.index / Math.max(memberWorkloadDots.dotColumns - 1, 1)) * 100;
                return (
                  <span
                    key={`member-dot-month-${marker.label}-${marker.index}`}
                    className="absolute -translate-x-1/2 text-[11px] font-semibold tracking-[0.06em] text-[#9C907F]"
                    style={{ left: `${leftPct}%` }}
                  >
                    {marker.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <TaskStatusDonutPanel tasks={workspaceTasks} />

      <MonthlyChannelAreaPanel trials={analyticsTrialOptions} taskRows={taskTimelineRows} />
    </div>
  );
}
