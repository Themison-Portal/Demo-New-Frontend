import { useEffect, useId, useMemo, useRef } from "react";
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { logEvent } from "@/lib/telemetry";

type WorkspaceTask = {
  status?: string | null;
  assignedUserId?: string | number | null;
  dueDate?: string | Date | null;
  blockedSince?: string | Date | null;
  completedDate?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

type WorkspaceRow = {
  map?: { id: string; trialId: string };
  tasks?: WorkspaceTask[];
};

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

function isDoneStatus(status?: string | null): boolean {
  const token = normalizeStatus(status);
  return token === "done" || token === "completed" || token === "skipped" || token === "cancelled";
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

function firstName(value: string) {
  const token = String(value || "").trim().split(/\s+/)[0];
  return token || "Member";
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

const TRAFFIC_SOURCES = [
  { label: "Organic Search", value: 1600, color: "#6842E7" },
  { label: "Referrals", value: 700, color: "#8A7AE9" },
  { label: "Social Media", value: 400, color: "#A79FEA" },
  { label: "Others", value: 300, color: "#C6C2EE" },
] as const;
const MAIN_CHART_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MAIN_REVENUE_SERIES = [8, 18, 42, 95, 120, 128, 136, 162, 198, 228, 248, 256] as const;
const MAIN_EXPENSE_SERIES = [42, 58, 40, 46, 92, 84, 96, 146, 152, 98, 82, 106] as const;
const PROFIT_BAR_SERIES = [24, 20, 24, 14, 22, 20, 28, 24, 18, 28, 22, 25, 20, 23, 26, 20, 24, 22, 27, 19, 23, 21, 25, 27] as const;
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

function RevenuePerformancePanel() {
  const leftChartWidth = 547;
  const leftChartHeight = 320;
  const leftRevenuePath = buildSeriesPath(MAIN_REVENUE_SERIES, leftChartWidth, leftChartHeight, 20, {
    min: 0,
    max: 280,
  });
  const leftExpensePath = buildSeriesPath(MAIN_EXPENSE_SERIES, leftChartWidth, leftChartHeight, 20, {
    min: 0,
    max: 280,
  });
  const sessionChartPath = buildSeriesPath(SESSION_SERIES, 320, 110, 10, { min: 0, max: 24 });
  const maxProfitBar = Math.max(...PROFIT_BAR_SERIES);

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-[#e4e6ea] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr]">
        <div className="border-b border-[#eceef3] p-4 xl:border-b-0 xl:border-r">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-[#6f7075]">Total revenue</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-3xl font-semibold leading-none text-[#0d0f12]">$240.8K</p>
                <span className="rounded-sm border border-[#00a656]/20 bg-[#00a656]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#00a656]">
                  24.6%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1 text-sm text-[#6f7075]">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#0047FF]" />
                Revenue
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#52D5FF]" />
                Expenses
              </div>
              <button
                type="button"
                className="rounded-md border border-[#dfe2e8] px-2 py-1 text-xs text-[#6f7075]"
              >
                Jan 2024 - Dec 2024
              </button>
            </div>
          </div>

          <div className="relative h-[320px] overflow-hidden rounded-lg border border-[#e8eaf0] bg-[#f9faff]">
            <svg aria-hidden="true" viewBox={`0 0 ${leftChartWidth} ${leftChartHeight}`} className="h-full w-full">
              <defs>
                <linearGradient id="revenueFillMain" x1="0%" y1="0%" x2="100%" y2="0%">
                  {EXECUTION_CHART_GRADIENT_STOPS.map((stop) => (
                    <stop
                      key={`revenue-fill-${stop.offset}`}
                      offset={stop.offset}
                      stopColor={stop.color}
                      stopOpacity={0.2}
                    />
                  ))}
                </linearGradient>
                <linearGradient id="revenueStrokeMain" x1="0%" y1="0%" x2="100%" y2="0%">
                  {EXECUTION_CHART_GRADIENT_STOPS.map((stop) => (
                    <stop key={`revenue-stroke-${stop.offset}`} offset={stop.offset} stopColor={stop.color} />
                  ))}
                </linearGradient>
                <linearGradient id="expenseStrokeMain" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#52D5FF" stopOpacity="0.75" />
                  <stop offset="100%" stopColor="#0047FF" stopOpacity="0.75" />
                </linearGradient>
              </defs>

              <path
                opacity="0.2"
                d="M110.951 248.671C84.2508 297.881 25.8586 316.728 0 320H546.187V0C409.978 0 360.817 148.548 264.75 142.004C168.682 135.46 144.327 187.157 110.951 248.671Z"
                fill="url(#revenueFillMain)"
              />
              <path d={leftExpensePath} fill="none" stroke="url(#expenseStrokeMain)" strokeWidth="2.2" strokeLinecap="round" />
              <path d={leftRevenuePath} fill="none" stroke="url(#revenueStrokeMain)" strokeWidth="2.2" strokeLinecap="round" />
            </svg>

            <div className="pointer-events-none absolute bottom-2 left-3 right-3 grid grid-cols-12 text-[11px] text-[#8b8d93]">
              {MAIN_CHART_MONTHS.map((month) => (
                <span key={month} className="text-center">
                  {month}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-rows-2 divide-y divide-[#eceef3]">
          <div className="p-4">
            <div className="mb-3">
              <p className="text-sm text-[#6f7075]">Total profit</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-3xl font-semibold leading-none text-[#0d0f12]">$144.6K</p>
                <span className="rounded-sm border border-[#00a656]/20 bg-[#00a656]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#00a656]">
                  28.5%
                </span>
              </div>
            </div>

            <div className="h-[110px] rounded-lg border border-[#e8eaf0] bg-[#fbfcff] p-2">
              <div className="flex h-full items-end gap-1.5">
                {PROFIT_BAR_SERIES.map((value, index) => (
                  <div
                    key={`profit-bar-${index}`}
                    className="flex-1 rounded-t-[2px]"
                    style={{
                      height: `${Math.max(6, Math.round((value / maxProfitBar) * 100))}%`,
                      background: `linear-gradient(180deg, ${executionChartColorAt(
                        index / Math.max(1, PROFIT_BAR_SERIES.length - 1)
                      )} 0%, ${executionChartColorAt(
                        Math.min(1, index / Math.max(1, PROFIT_BAR_SERIES.length - 1) + 0.2)
                      )} 100%)`,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between text-[10px] text-[#8b8d93]">
              {MINI_TIMES.map((label) => (
                <span key={`profit-time-${label}`}>{label}</span>
              ))}
            </div>
          </div>

          <div className="p-4">
            <div className="mb-2">
              <p className="text-sm text-[#6f7075]">Total sessions</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-3xl font-semibold leading-none text-[#0d0f12]">400</p>
                <span className="rounded-sm border border-[#00a656]/20 bg-[#00a656]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#00a656]">
                  16.8%
                </span>
              </div>
            </div>

            <div className="h-[110px] rounded-lg border border-[#e8eaf0] bg-[#fbfcff] p-2">
              <svg aria-hidden="true" viewBox="0 0 320 110" className="h-full w-full">
                <defs>
                  <linearGradient id="sessionStrokeMain" x1="0%" y1="0%" x2="100%" y2="0%">
                    {EXECUTION_CHART_GRADIENT_STOPS.map((stop) => (
                      <stop key={`session-stroke-${stop.offset}`} offset={stop.offset} stopColor={stop.color} />
                    ))}
                  </linearGradient>
                </defs>
                {[20, 40, 60, 80].map((row) => (
                  <line
                    key={`session-grid-${row}`}
                    x1="0"
                    y1={row}
                    x2="320"
                    y2={row}
                    stroke="#edf0f4"
                    strokeWidth="1"
                  />
                ))}
                <path d={sessionChartPath} fill="none" stroke="url(#sessionStrokeMain)" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </div>

            <div className="mt-2 flex items-center justify-between text-[10px] text-[#8b8d93]">
              {MINI_TIMES.map((label) => (
                <span key={`session-time-${label}`}>{label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Analytics({ embedded = false }: { embedded?: boolean } = {}) {
  const { state, getCurrentDataMode } = useDemoState();
  const [location, setLocation] = useLocation();
  const isHomePage = location === "/";
  const currentDataMode = getCurrentDataMode();
  const hasLoggedViewRef = useRef(false);

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
  const openTasks = Math.max(0, taskStats.total - taskStats.done);
  const followUpCount = taskStats.blocked + taskStats.unassigned;
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
      openTasksDelta: buildDeltaMetric(openTasks, baseline.openTasks, baseline.openTasks),
      blockedTasksDelta: buildDeltaMetric(taskStats.blocked, baseline.blockedTasks, baseline.blockedTasks),
    };
  }, [activeTrials, currentDataMode, openTasks, taskStats.blocked, totalEnrolledPatients]);
  const topOverviewCards = useMemo(() => {
    const activeDelta = metricDeltas.activeTrialsDelta;
    const enrolledDelta = metricDeltas.patientsEnrolledDelta;
    const openDelta = metricDeltas.openTasksDelta;
    const blockedDelta = metricDeltas.blockedTasksDelta;

    return [
      {
        key: "active-trials",
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
        key: "blocked-tasks",
        title: "Blocked tasks",
        value: formatCompactCount(taskStats.blocked),
        badge: `${Math.abs(blockedDelta.percent).toFixed(0)}%`,
        badgeContext: "from last week",
        footerCount: formatCompactCount(taskStats.blockedOver48h),
        footerText: "blocked over 48h",
        tone: blockedDelta.percent <= 0 ? "positive" : "negative",
        direction: blockedDelta.percent >= 0 ? "up" : "down",
        icon: AlertTriangle,
      },
    ] as const;
  }, [
    activeTrials,
    metricDeltas,
    openTasks,
    patientsRemainingToTarget,
    recruitingTrials,
    taskStats.blocked,
    taskStats.blockedOver48h,
    taskStats.dueSoon,
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

  const topLoad = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of workspaceRows) {
      for (const task of row.tasks || []) {
        const assignee = String(task.assignedUserId || "unassigned");
        counts.set(assignee, (counts.get(assignee) || 0) + 1);
      }
    }
    const nameById = new Map(state.teamMembers.map((member) => [String(member.id), String(member.name)]));
    return Array.from(counts.entries())
      .map(([id, count]) => ({
        id,
        count,
        name: id === "unassigned" ? "Unassigned" : nameById.get(id) || "Unknown member",
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [state.teamMembers, workspaceRows]);

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
    <div className={`px-8 pb-8 ${embedded ? "pt-0" : "pt-4"} flex flex-col gap-4`}>
      {!embedded && (
        <>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
              {isHomePage ? "Home" : "Analytics Dashboard"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Cross-trial execution metrics for workload, throughput, and risk.
            </p>
          </div>

          <div className="h-11 items-center gap-6 rounded-lg border border-gray-200 bg-white pl-5 pr-2 py-0 flex">
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
        </>
      )}

      <div className="mb-1 grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-4">
        {topOverviewCards.map((item) => {
          const Icon = item.icon;
          const positive = item.tone === "positive";
          const directionUp = item.direction === "up";
          return (
            <article
              key={item.key}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white"
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
                  <p className="text-[40px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
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

      <section className="mb-6 rounded-xl border border-[#e7e7e8] bg-[#fcfcfd] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_rgba(15,23,42,0.06)]">
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

        <div className="rounded-xl border border-[#e4e5e7] bg-[#f9fafb] px-2 pb-2 pt-3">
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

      <Card className="border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-foreground">Workload by Team Member</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topLoad.length === 0 ? (
              <p className="text-sm text-muted-foreground">No task workload data yet.</p>
            ) : (
              topLoad.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[1fr_auto] items-center gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{entry.name}</p>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{
                          width: `${Math.max(
                            8,
                            Math.round((entry.count / Math.max(topLoad[0]?.count || 1, 1)) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground">{entry.count}</span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <RevenuePerformancePanel />
    </div>
  );
}
