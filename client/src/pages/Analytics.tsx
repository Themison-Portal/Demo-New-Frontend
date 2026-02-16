import { useEffect, useId, useMemo, useRef } from "react";
import { useDemoState } from "@/contexts/DemoStateContext";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FlaskConical,
  MoreHorizontal,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { logEvent } from "@/lib/telemetry";

type WorkspaceTask = {
  status?: string | null;
  assignedUserId?: string | null;
};

type WorkspaceRow = {
  map?: { id: string; trialId: string };
  tasks?: WorkspaceTask[];
};

function normalizeStatus(status?: string | null): string {
  return String(status || "").toLowerCase();
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

const EXECUTION_CHART_GRADIENT_STOPS = [
  { offset: "0%", color: "#DBB7FF" },
  { offset: "50.5208%", color: "#0047FF" },
  { offset: "100%", color: "#52D5FF" },
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

export default function Analytics() {
  const { state, getCurrentDataMode } = useDemoState();
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

  const taskStats = useMemo(() => {
    const tasks = workspaceRows.flatMap((row) => (Array.isArray(row.tasks) ? row.tasks : []));
    const total = tasks.length;
    const done = tasks.filter((task) => {
      const token = normalizeStatus(task.status);
      return token === "done" || token === "completed" || token === "skipped" || token === "cancelled";
    }).length;
    const blocked = tasks.filter((task) => {
      const token = normalizeStatus(task.status);
      return token === "blocked" || token === "waiting";
    }).length;
    const inFlight = tasks.filter((task) => {
      const token = normalizeStatus(task.status);
      return token === "in_progress";
    }).length;
    const unassigned = tasks.filter((task) => !task.assignedUserId).length;

    return { total, done, blocked, inFlight, unassigned };
  }, [workspaceRows]);

  const activeTrials = useMemo(
    () =>
      trials.filter((trial) =>
        ["active", "recruiting"].includes(String(trial.status || "").toLowerCase())
      ).length,
    [trials]
  );

  const donePct = taskStats.total > 0 ? Math.round((taskStats.done / taskStats.total) * 100) : 0;
  const blockedPct = taskStats.total > 0 ? Number(((taskStats.blocked / taskStats.total) * 100).toFixed(1)) : 0;
  const followUpCount = taskStats.blocked + taskStats.unassigned;
  const featuredMembers = useMemo(() => state.teamMembers.slice(0, 7), [state.teamMembers]);
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
    <div className="px-8 pb-8 pt-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Analytics</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Cross-trial execution metrics for workload, throughput, and risk.
        </p>
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

        <div className="mb-5 rounded-xl border border-[#e4e5e7] bg-[#f3f4f6] p-1.5">
          <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
            <div className="rounded-xl border border-[#ececef] bg-white px-6 py-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_20px_rgba(15,23,42,0.06)]">
              <div className="mb-2 flex items-center gap-2 text-base font-medium text-[#232529]">
                <Users className="h-5 w-5 text-[#232529]" />
                Active trials
              </div>
              <div className="flex items-end gap-3 max-md:flex-col max-md:items-start max-md:gap-1">
                <p className="text-4xl font-semibold leading-none text-[#0d0f12] max-sm:text-3xl">
                  {activeTrials.toLocaleString()}
                </p>
                <div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold ${
                      blockedPct > 0
                        ? "border-[#ff6a55]/20 bg-[#ff6a55]/10 text-[#ff6a55]"
                        : "border-[#00a656]/20 bg-[#00a656]/10 text-[#00a656]"
                    }`}
                  >
                    {blockedPct > 0 ? (
                      <TrendingDown className="h-4 w-4" />
                    ) : (
                      <TrendingUp className="h-4 w-4" />
                    )}
                    {Math.abs(blockedPct).toFixed(1)}%
                  </span>
                  <p className="mt-1 text-sm text-[#6f7075]">vs last month</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#ececef] bg-transparent px-6 py-6">
              <div className="mb-2 flex items-center gap-2 text-base font-medium text-[#6f7075]">
                <FlaskConical className="h-5 w-5 text-[#6f7075]" />
                Execution tasks
              </div>
              <div className="flex items-end gap-3 max-md:flex-col max-md:items-start max-md:gap-1">
                <p className="text-4xl font-semibold leading-none text-[#0d0f12] max-sm:text-3xl">
                  {taskStats.total.toLocaleString()}
                </p>
                <div>
                  <span className="inline-flex items-center gap-1 rounded-lg border border-[#00a656]/20 bg-[#00a656]/10 px-2 py-1 text-xs font-semibold text-[#00a656]">
                    <TrendingUp className="h-4 w-4" />
                    {donePct.toFixed(1)}%
                  </span>
                  <p className="mt-1 text-sm text-[#6f7075]">vs last month</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#e4e5e7] bg-[#f9fafb] px-2 pb-2 pt-3">
          <div className="h-[310px] w-full">
            <ResponsiveContainer width="100%" height="100%">
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
                <CartesianGrid stroke="#dde0e4" strokeDasharray="5 7" vertical={false} />
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
    </div>
  );
}
