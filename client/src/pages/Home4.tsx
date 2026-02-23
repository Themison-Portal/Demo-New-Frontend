import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock3,
  Sparkles,
  Users,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useDemoState } from "@/contexts/DemoStateContext";
import { logEvent } from "@/lib/telemetry";

type WorkspaceTask = {
  id: string;
  name: string;
  status?: string | null;
  dueDate?: string | null;
  completedDate?: string | null;
  assignedUserId?: number | null;
  suggestedAssignee?: string | null;
  priority?: string | null;
  mapId?: string;
};

type WorkspaceRow = {
  map?: { id: string; trialId: string };
  tasks?: WorkspaceTask[];
};

const BUSINESS_WINDOW_DAYS = 7;
const STUDENT_BAR_GRADIENT_STOPS = [
  { t: 0, color: "#0047FF" },
  { t: 0.505208, color: "#52D5FF" },
  { t: 1, color: "#DBB7FF" },
] as const;
const QUICK_CONVERSATION_INTENT_KEY = "themison:quick-conversation-intent";
function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDoneStatus(status?: string | null): boolean {
  const token = String(status || "").toLowerCase();
  return token === "done" || token === "completed" || token === "cancelled" || token === "skipped";
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isBeforeDay(a: Date, b: Date): boolean {
  const ax = new Date(a);
  ax.setHours(0, 0, 0, 0);
  const bx = new Date(b);
  bx.setHours(0, 0, 0, 0);
  return ax.getTime() < bx.getTime();
}

function firstName(value?: string | null): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "User";
  return normalized.split(" ")[0] || "User";
}

function formatDueDate(value?: string | null): string {
  const date = parseDate(value);
  if (!date) return "No due date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dateKey(date: Date): string {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return `${normalized.getFullYear()}-${String(normalized.getMonth() + 1).padStart(2, "0")}-${String(
    normalized.getDate()
  ).padStart(2, "0")}`;
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

export default function Home4() {
  const { state, getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  const [, setLocation] = useLocation();
  const pulseCardRef = useRef<HTMLElement | null>(null);
  const [topRowHeight, setTopRowHeight] = useState<number | null>(null);

  const runtimeUser = useMemo(() => {
    if (typeof window === "undefined") {
      return { name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
    }
    try {
      const raw = window.localStorage.getItem("manus-runtime-user-info");
      if (!raw) return { name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
      const parsed = JSON.parse(raw) as { name?: unknown; email?: unknown };
      return {
        name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : "Kaleb Sanders",
        email: typeof parsed.email === "string" && parsed.email.trim() ? parsed.email.trim() : "kaleb.s@azorg.be",
      };
    } catch {
      return { name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
    }
  }, []);

  const currentMember = useMemo(() => {
    const normalizedRuntimeEmail = runtimeUser.email.toLowerCase();
    const normalizedRuntimeName = runtimeUser.name.toLowerCase();
    const matchedByEmail = state.teamMembers.find(
      (member) => member.email.toLowerCase() === normalizedRuntimeEmail
    );
    if (matchedByEmail) return matchedByEmail;
    const matchedByName = state.teamMembers.find(
      (member) => member.name.toLowerCase() === normalizedRuntimeName
    );
    return matchedByName ?? state.teamMembers[0] ?? null;
  }, [runtimeUser.email, runtimeUser.name, state.teamMembers]);

  const { data: trials = [] } = trpc.trials.list.useQuery({ demoMode: currentDataMode });

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

  const mapById = useMemo(() => {
    const result = new Map<string, string>();
    for (const row of workspaceRows) {
      if (row.map?.id && row.map?.trialId) {
        result.set(row.map.id, row.map.trialId);
      }
    }
    return result;
  }, [workspaceRows]);

  const trialLabelById = useMemo(() => {
    const result = new Map<string, string>();
    for (const trial of trials) {
      result.set(String(trial.id), String(trial.investigationalProduct || trial.title || trial.id));
    }
    return result;
  }, [trials]);

  const workspaceTasks = useMemo(
    () => workspaceRows.flatMap((row) => (Array.isArray(row.tasks) ? row.tasks : [])),
    [workspaceRows]
  );

  const myWorkspaceTasks = useMemo(() => {
    if (!currentMember) return [] as WorkspaceTask[];
    const memberName = String(currentMember.name || "").trim().toLowerCase();
    const memberId = String(currentMember.id || "").trim();
    return workspaceTasks.filter((task) => {
      const matchById =
        task.assignedUserId != null &&
        (memberId === String(task.assignedUserId) || memberId === `member-${task.assignedUserId}`);
      const matchByName =
        Boolean(memberName) && String(task.suggestedAssignee || "").trim().toLowerCase() === memberName;
      return matchById || matchByName;
    });
  }, [currentMember, workspaceTasks]);

  const scopedTasks = myWorkspaceTasks.length > 0 ? myWorkspaceTasks : workspaceTasks;

  const todaySnapshot = useMemo(() => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const dueToday = scopedTasks.filter((task) => {
      const due = parseDate(task.dueDate);
      return Boolean(due && isSameDay(due, now) && !isDoneStatus(task.status));
    }).length;

    const overdue = scopedTasks.filter((task) => {
      const due = parseDate(task.dueDate);
      return Boolean(due && isBeforeDay(due, now) && !isDoneStatus(task.status));
    }).length;

    const blocked = scopedTasks.filter((task) => {
      const status = String(task.status || "").toLowerCase();
      return status === "blocked" || status === "waiting";
    }).length;

    const completedToday = scopedTasks.filter((task) => {
      const done = parseDate(task.completedDate);
      return Boolean(done && isSameDay(done, now));
    }).length;

    const completedYesterday = scopedTasks.filter((task) => {
      const done = parseDate(task.completedDate);
      return Boolean(done && isSameDay(done, yesterday));
    }).length;

    return { dueToday, overdue, blocked, completedToday, completedYesterday };
  }, [scopedTasks]);

  const todayTasks = useMemo(() => {
    const now = new Date();
    const priorityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const ranked = scopedTasks
      .filter((task) => !isDoneStatus(task.status))
      .map((task) => {
        const due = parseDate(task.dueDate);
        const overdue = Boolean(due && isBeforeDay(due, now));
        const dueToday = Boolean(due && isSameDay(due, now));
        const status = String(task.status || "todo").toLowerCase();
        const baseScore = overdue ? 6 : dueToday ? 5 : status === "blocked" ? 4 : status === "in_progress" ? 3 : 2;
        const priorityScore = priorityRank[String(task.priority || "low").toLowerCase()] || 1;
        const score = baseScore * 10 + priorityScore;
        const trialId = task.mapId ? mapById.get(task.mapId) : undefined;

        return {
          id: task.id,
          title: String(task.name || "Untitled task"),
          trail: trialId ? trialLabelById.get(trialId) || trialId : "Cross-trial",
          dueLabel: formatDueDate(task.dueDate),
          score,
          tag: overdue ? "Overdue" : dueToday ? "Today" : status === "blocked" ? "Blocked" : "Open",
          tagClass:
            overdue
              ? "border-red-200 bg-red-50 text-red-700"
              : dueToday
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : status === "blocked"
                  ? "border-violet-200 bg-violet-50 text-violet-700"
                  : "border-blue-200 bg-blue-50 text-blue-700",
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (ranked.length > 0) return ranked;

    return state.tasks
      .filter((task) => !task.completed)
      .map((task, index) => ({
        id: task.id,
        title: task.name,
        trail: "General workspace",
        dueLabel: "Today",
        score: 100 - index,
        tag: task.status === "waiting_on_monitor" ? "Blocked" : task.status === "due_today" ? "Today" : "Open",
        tagClass:
          task.status === "waiting_on_monitor"
            ? "border-violet-200 bg-violet-50 text-violet-700"
            : task.status === "due_today"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-blue-200 bg-blue-50 text-blue-700",
      }))
      .slice(0, 5);
  }, [mapById, scopedTasks, state.tasks, trialLabelById]);

  const quickChatMembers = useMemo(() => {
    const currentId = currentMember?.id;
    return state.teamMembers.filter((member) => member.id !== currentId).slice(0, 8);
  }, [currentMember?.id, state.teamMembers]);

  const collaborationQueue = useMemo(() => {
    const loadScore = todaySnapshot.overdue + todaySnapshot.blocked + Math.ceil(todaySnapshot.dueToday / 2);
    const threadsWaiting = Math.max(0, Math.min(12, loadScore));
    const mentions = Math.max(0, Math.min(6, Math.ceil((todaySnapshot.blocked + todaySnapshot.overdue) / 2)));
    const unreadMessages = Math.max(0, threadsWaiting + mentions);
    return { threadsWaiting, unreadMessages, mentions };
  }, [todaySnapshot.blocked, todaySnapshot.dueToday, todaySnapshot.overdue]);

  const weekdayPressureData = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const businessDates: Date[] = [];
    const cursor = new Date(now);

    while (businessDates.length < BUSINESS_WINDOW_DAYS) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        businessDates.push(new Date(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    const openScopedTasks = scopedTasks.filter((task) => !isDoneStatus(task.status));

    const points = businessDates.map((date, index) => ({
      day: date.toLocaleDateString(undefined, { weekday: "long" }),
      index,
      dateKey: dateKey(date),
      load: 0,
    }));
    const indexByDate = new Map(points.map((point, index) => [point.dateKey, index]));

    let backlogCursor = 0;
    const backlogPattern = [0, 1, 0, 2, 1, 3, 0, 2, 4, 1, 5, 3, 6] as const;
    const assignBacklogTask = () => {
      const slot = backlogPattern[backlogCursor % backlogPattern.length] ?? 0;
      backlogCursor += 1;
      points[slot].load += 1;
    };

    openScopedTasks.forEach((task) => {
      const due = parseDate(task.dueDate);
      const statusToken = String(task.status || "").toLowerCase();
      const isBlocked = statusToken === "blocked" || statusToken === "waiting";

      if (due) {
        const idx = indexByDate.get(dateKey(due));
        if (idx != null) {
          points[idx].load += 1;
          return;
        }
        if (isBeforeDay(due, now)) {
          points[0].load += 1;
          return;
        }
      }

      if (isBlocked) {
        points[0].load += 1;
        return;
      }

      assignBacklogTask();
    });

    return points;
  }, [scopedTasks]);

  const pressureAxisTicks = useMemo(() => {
    const peak = Math.max(1, ...weekdayPressureData.map((point) => point.load));
    const axisTop = Math.max(14, Math.ceil((peak + 1) / 2) * 2);
    const step = Math.max(2, Math.round(axisTop / 6));
    return [axisTop, axisTop - step, axisTop - step * 2, axisTop - step * 3, axisTop - step * 4, axisTop - step * 5];
  }, [weekdayPressureData]);

  const weekdayPressureChartBars = useMemo(() => {
    const peakLoad = Math.max(1, ...weekdayPressureData.map((point) => point.load));
    const visualBarMax = Math.max(1, pressureAxisTicks[0] || peakLoad);
    const maxBarHeight = 178;
    const minBarHeight = 10;

    return weekdayPressureData.map((point, index, allPoints) => {
      const height = Math.max(
        minBarHeight,
        Math.min(maxBarHeight, Math.round((point.load / visualBarMax) * maxBarHeight))
      );
      return {
        ...point,
        pressureValue: point.load,
        height,
        highlighted: index === 0,
        final: index === allPoints.length - 1,
      };
    });
  }, [pressureAxisTicks, weekdayPressureData]);

  const myOpenTaskCount = useMemo(
    () => scopedTasks.filter((task) => !isDoneStatus(task.status)).length,
    [scopedTasks]
  );

  const summaryTiles = [
    { label: "Owned", value: myOpenTaskCount },
    { label: "Due today", value: todaySnapshot.dueToday },
    { label: "Overdue", value: todaySnapshot.overdue },
    { label: "Done today", value: todaySnapshot.completedToday },
  ];

  const openConversation = (memberId: string) => {
    logEvent({
      eventType: "feature_used",
      action: "quick_conversation",
      entityType: "team_member",
      entityId: memberId,
      payload: { from: "/home4" },
    });
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          QUICK_CONVERSATION_INTENT_KEY,
          JSON.stringify({
            memberId,
            layer: "messages",
            compose: "new",
            from: "home4",
            at: Date.now(),
          })
        );
      } catch {
        // Ignore storage failures; query-param handoff still applies.
      }
    }
    const query = new URLSearchParams({
      layer: "messages",
      compose: "new",
      memberId,
      from: "home4",
    });
    setLocation(`/collaboration?${query.toString()}`);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = pulseCardRef.current;
    if (!target) return;

    const syncHeight = () => {
      const next = Math.round(target.getBoundingClientRect().height);
      setTopRowHeight((previous) => (previous === next ? previous : next));
    };

    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(target);
    window.addEventListener("resize", syncHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncHeight);
    };
  }, []);

  return (
    <div className="px-8 pb-8">
      <div className="sticky top-0 z-30 bg-[#F7F8FB] pb-3 pt-4">
        <div>
          <h1 className="text-[30px] font-semibold leading-[1.05] tracking-tight text-foreground">
            Welcome back, {firstName(currentMember?.name || runtimeUser.name)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quick glance at what matters most today and fast ways to take action.
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(300px,1fr)]">
        <div className="space-y-4 xl:contents">
          <section
            ref={pulseCardRef}
            className="relative overflow-hidden rounded-lg border border-gray-200 bg-white px-6 pb-7 pt-5 xl:col-start-1 xl:row-start-1"
          >
            <span className="pointer-events-none absolute right-4 top-5">
              <DotLottieReact
                src="/animations/loader-10.json"
                loop
                autoplay
                layout={{ fit: "contain", align: [0.5, 0.5] }}
                renderConfig={{ autoResize: true }}
                className="h-9 w-9"
              />
            </span>

            <div className="mb-10 pr-14">
              <h2 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Clinical Execution Pulse</h2>
              <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
                Tasks to action across 7 business days (today highlighted).
              </p>
            </div>

              <div className="flex h-[230px] w-full">
                <div className="flex h-full w-[30px] flex-col justify-between pr-2 text-[11px] text-[#525252]">
                  {pressureAxisTicks.map((axis) => (
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
                  {weekdayPressureChartBars.map((item, index, allBars) => {
                    const maxIndex = Math.max(1, allBars.length - 1);
                    const bodyColor = studentBarColorAt(index / maxIndex);
                    const connectorColor = studentBarColorAt(Math.min(1, (index + 0.45) / maxIndex));

                    return (
                      <div
                        key={`${item.dateKey}-${index}`}
                        className={`relative border-r border-[#f5f5f5] ${item.highlighted ? "bg-[#eff8ff]" : ""} ${item.final ? "border-r-0" : ""}`}
                      >
                        <p
                          className={`absolute left-3 top-2 text-[9px] leading-[10px] ${
                            item.highlighted ? "font-semibold text-[#0E0017]" : "font-normal text-[#525252]"
                          }`}
                        >
                          {item.highlighted ? "Today" : item.day}
                        </p>
                        <p
                          className={`absolute left-3 top-5 text-sm leading-5 tracking-[-0.12px] ${
                            item.highlighted ? "font-semibold text-[#0a0a0a]" : "font-normal text-[#525252]"
                          }`}
                        >
                          {item.pressureValue} tasks
                        </p>

                        <div className="absolute bottom-0 left-0 right-0">
                          <div className="relative" style={{ height: item.height }}>
                            <div
                              className="absolute bottom-0 left-0"
                              style={{
                                width: "calc(100% - 19px)",
                                height: "100%",
                                backgroundColor: bodyColor,
                              }}
                            />
                            <div className="absolute bottom-0 right-0 w-[19px]" style={{ height: item.height }}>
                              <StudentBarConnector
                                height={item.height}
                                index={index}
                                fillColor={item.final ? bodyColor : connectorColor}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-8 overflow-hidden rounded-lg border border-gray-200 bg-[#FAFAFA]">
              <div className="grid grid-cols-2 md:grid-cols-4">
                {summaryTiles.map((item, index) => (
                  <div
                    key={item.label}
                    className={`relative px-4 py-3 ${
                      index >= 2 ? "border-t border-gray-200 md:border-t-0" : ""
                    } ${index % 2 === 1 ? "border-l border-gray-200 md:border-l-0" : ""} ${
                      index < summaryTiles.length - 1
                        ? "md:after:absolute md:after:bottom-3 md:after:right-0 md:after:top-3 md:after:w-px md:after:bg-gray-200"
                        : ""
                    }`}
                  >
                    <p className="text-xs text-[#75778B]">{item.label}</p>
                    <p className="mt-1 text-[26px] font-semibold leading-none text-[#0E0017]">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:col-start-1 xl:row-start-2">
            <article className="relative flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
              <img src="/vision/molecules2.png" alt="" className="absolute left-0 top-0 h-full w-auto max-w-none" />

              <div className="relative z-10 flex flex-1 flex-col px-5 pb-4 pt-[18px]">
                <div className="mb-[18px] flex items-start justify-between">
                  <div className="pr-3">
                    <h3 className="whitespace-nowrap text-[22px] font-semibold leading-[30px] text-[#0E0017]">
                      What&apos;s Important Today
                    </h3>
                    <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
                      Quick status of due, overdue, and completed tasks.
                    </p>
                  </div>
                  <span className="mt-0.5 flex h-8 w-8 translate-x-1 items-center justify-center rounded-[7px] bg-primary/10">
                    <DotLottieReact
                      src="/animations/genetics-lottie.json"
                      loop
                      autoplay
                      className="h-6 w-6"
                    />
                  </span>
                </div>

                <div className="mt-auto">
                  <div className="space-y-2 text-[14px] leading-snug text-[#0E0017]">
                    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                      <Sparkles className="h-4 w-4" />
                      {todaySnapshot.dueToday} tasks due today
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                      <AlertTriangle className="h-4 w-4" />
                      {todaySnapshot.overdue} tasks overdue
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      {todaySnapshot.completedYesterday} completed yesterday
                    </div>
                  </div>
                  <p className="mt-4 text-[11px] uppercase tracking-wider text-[#75778B]">
                    Live feed powered by Themison AI
                  </p>
                </div>
              </div>

            </article>

            <section className="relative flex h-full min-h-[460px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white px-5 pb-5 pt-[18px]">
              <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
                <Clock3 className="h-4 w-4 text-primary" />
              </span>

              <div className="mb-4 pr-14">
                <h3 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Your Tasks Today</h3>
                <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
                  Prioritized queue for your owned trial work.
                </p>
              </div>

              <div className="flex-1 space-y-2.5">
                {todayTasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-gray-200 bg-[#FAFAFA] p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-medium border ${task.tagClass}`}>
                        {task.tag}
                      </span>
                      <span className="text-xs text-[#75778B]">{task.dueLabel}</span>
                    </div>
                    <p className="truncate text-sm font-medium text-[#0E0017]">{task.title}</p>
                    <p className="truncate text-xs text-[#75778B]">{task.trail}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <div className="space-y-4 xl:contents">
          <article
            className="overflow-hidden rounded-lg border border-gray-200 bg-white xl:col-start-2 xl:row-start-1 xl:flex xl:h-[var(--home4-top-row-height)] xl:flex-col"
            style={
              topRowHeight
                ? ({ "--home4-top-row-height": `${topRowHeight}px` } as CSSProperties)
                : undefined
            }
          >
            <div className="px-5 pb-4 pt-[18px] xl:flex xl:flex-1 xl:flex-col">
              <div className="mb-[18px] flex items-center justify-between">
                <h3 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">
                  Themison AI
                </h3>
                <span className="flex h-8 w-8 translate-x-1 items-center justify-center rounded-[7px] bg-primary/10">
                  <Brain className="h-4 w-4 text-primary" />
                </span>
              </div>

              <p className="mb-3 text-[13px] font-medium leading-[18px] text-[#75778B]">
                Ask Themison about protocol questions, trial milestones, tasks, and execution risks.
              </p>

              <div className="relative h-[220px] overflow-hidden xl:min-h-[220px] xl:flex-1">
                <div
                  className="absolute inset-0 z-0 bg-center bg-no-repeat opacity-20"
                  style={{
                    backgroundImage: "url('/vision/eclipseframer.svg')",
                    backgroundSize: "100% 100%",
                  }}
                />
                <iframe
                  src="https://my.spline.design/particleaibraincopycopy-HKDz858gzcKxD2SysKCQOoyn/"
                  title="Themison brain"
                  className="pointer-events-auto absolute left-[56%] top-[53%] z-10 h-[190%] w-[190%] origin-center -translate-x-1/2 -translate-y-1/2 scale-[0.56] border-0"
                  loading="lazy"
                  allow="autoplay; fullscreen"
                />
              </div>
            </div>

            <div className="flex items-center justify-between bg-[#FAFAFA] px-5 py-3">
              <p className="text-[14px] font-medium leading-[20px] text-[#0E0017]">Ask</p>
              <Link
                href="/documents"
                aria-label="Ask"
                className="flex h-8 w-8 translate-x-1 items-center justify-center"
              >
                <ArrowRight className="h-4 w-4 text-[#75778B]" />
              </Link>
            </div>
          </article>

          <section className="relative h-full overflow-hidden rounded-lg border border-gray-200 bg-white px-5 pb-0 pt-[18px] xl:col-start-2 xl:row-start-2 xl:flex xl:flex-col">
            <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
              <Users className="h-4 w-4 text-primary" />
            </span>

            <div className="mb-4 pr-14">
              <h3 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Quick Conversations</h3>
              <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
                Start a thread with key collaborators in one click.
              </p>
            </div>

            <div className="space-y-3 xl:flex xl:flex-1 xl:flex-col">
              <div className="rounded-lg border border-[#E7EBF3] bg-[linear-gradient(270deg,rgba(82,213,255,0.12)_0%,rgba(0,71,255,0.08)_50.52%,rgba(219,183,255,0.12)_100%)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0E0017]">
                      {collaborationQueue.unreadMessages} unread messages
                    </p>
                    <p className="mt-0.5 text-xs text-[#66708A]">
                      {collaborationQueue.threadsWaiting} threads waiting for your reply.
                    </p>
                  </div>
                  <div className="flex -space-x-2">
                    {quickChatMembers.slice(0, 3).map((member) => (
                      <span
                        key={`stack-${member.id}`}
                        className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md border border-white bg-gray-100"
                      >
                        {member.avatar ? (
                          <img src={member.avatar} alt={member.name} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[9px] font-semibold text-[#0E0017]">{member.initials}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <div className="rounded-md border border-[#DDE2EF] bg-white px-2 py-1">
                    <p className="text-[10px] text-[#75778B]">Mentions</p>
                    <p className="text-xs font-semibold text-[#0E0017]">{collaborationQueue.mentions}</p>
                  </div>
                  <div className="rounded-md border border-[#DDE2EF] bg-white px-2 py-1">
                    <p className="text-[10px] text-[#75778B]">Waiting</p>
                    <p className="text-xs font-semibold text-[#0E0017]">{collaborationQueue.threadsWaiting}</p>
                  </div>
                  <div className="rounded-md border border-[#DDE2EF] bg-white px-2 py-1">
                    <p className="text-[10px] text-[#75778B]">Teammates</p>
                    <p className="text-xs font-semibold text-[#0E0017]">{quickChatMembers.length}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex-1 xl:auto-rows-fr">
                {quickChatMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => openConversation(member.id)}
                    className="group flex h-full items-center gap-2.5 rounded-lg border border-gray-200 bg-[#FAFAFA] px-2.5 py-2 text-left transition-colors hover:bg-white"
                  >
                    <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-100">
                      {member.avatar ? (
                        <img src={member.avatar} alt={member.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-[10px] font-semibold text-[#0E0017]">{member.initials}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-[#0E0017]">{member.name}</span>
                      <span className="block truncate text-[11px] text-[#75778B]">
                        {member.clinicalRole || member.role || "Team member"}
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-[#A0A4B8] transition-colors group-hover:text-[#6B728B]" />
                  </button>
                ))}
              </div>

              <div className="-mx-5 mt-1 border-t border-gray-200 bg-[#FAFAFA] px-5 py-3">
                <Link
                  href="/collaboration"
                  className="flex items-center justify-between text-[14px] font-medium leading-[20px] text-[#0E0017]"
                >
                  <span>Open collaboration hub</span>
                  <ArrowRight className="h-4 w-4 text-[#75778B]" />
                </Link>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
