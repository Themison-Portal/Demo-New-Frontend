import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock3,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { useDemoState } from "@/contexts/DemoStateContext";
import { logEvent } from "@/lib/telemetry";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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

  const keyMetrics = useMemo(() => {
    const myOpen = scopedTasks.filter((task) => !isDoneStatus(task.status)).length;
    const criticalItems = scopedTasks.filter((task) => {
      if (isDoneStatus(task.status)) return false;
      const token = String(task.priority || "").toLowerCase();
      return token === "critical" || token === "high";
    }).length;
    const focusScore = Math.max(
      35,
      Math.min(99, 82 - todaySnapshot.overdue * 7 - todaySnapshot.blocked * 5 + todaySnapshot.completedToday * 4)
    );
    return [
      { label: "My Open Tasks", value: myOpen, helper: "Assigned work still active", icon: Clock3 },
      { label: "Critical Items", value: criticalItems, helper: "High-priority items in queue", icon: AlertTriangle },
      { label: "Focus Score", value: focusScore, helper: "Execution health index", icon: Target, suffix: "%" },
    ];
  }, [scopedTasks, todaySnapshot.blocked, todaySnapshot.completedToday, todaySnapshot.overdue]);

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

  const chartData = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const points = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return {
        key: date.toISOString(),
        day: index === 0 ? "Mon" : date.toLocaleDateString(undefined, { weekday: "short" }),
        load: 0,
      };
    });

    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const priorityWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

    scopedTasks.forEach((task) => {
      if (isDoneStatus(task.status)) return;
      const due = parseDate(task.dueDate);
      if (!due) return;
      if (due.getTime() < start.getTime() || due.getTime() >= end.getTime()) return;
      const index = Math.floor((due.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      if (index < 0 || index >= points.length) return;
      points[index].load += priorityWeight[String(task.priority || "medium").toLowerCase()] || 2;
    });

    if (points.every((point) => point.load === 0)) {
      const seed = Math.max(2, state.tasks.filter((task) => !task.completed).length);
      return points.map((point, index) => ({
        ...point,
        day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index] || point.day,
        load: Math.max(1, seed - Math.floor((seed / 6) * index)),
      }));
    }

    return points.map((point, index) => ({
      ...point,
      day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index] || point.day,
    }));
  }, [scopedTasks, state.tasks]);

  const chartTotals = useMemo(() => {
    const total = chartData.reduce((sum, item) => sum + item.load, 0);
    const peak = Math.max(...chartData.map((item) => item.load));
    return { total, peak };
  }, [chartData]);

  const operationalScore = useMemo(() => {
    const raw =
      82 -
      todaySnapshot.overdue * 7 -
      todaySnapshot.blocked * 5 -
      todaySnapshot.dueToday * 2 +
      todaySnapshot.completedToday * 4;
    return Math.max(24, Math.min(98, raw));
  }, [todaySnapshot.blocked, todaySnapshot.completedToday, todaySnapshot.dueToday, todaySnapshot.overdue]);

  const momentumPct = useMemo(() => {
    const value = 14 + todaySnapshot.completedToday * 4 - todaySnapshot.overdue * 3 - todaySnapshot.blocked * 2;
    return Math.max(-38, Math.min(38, value));
  }, [todaySnapshot.blocked, todaySnapshot.completedToday, todaySnapshot.overdue]);

  const summaryTiles = [
    { label: "Owned", value: keyMetrics[0]?.value ?? 0 },
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
    setLocation("/collaboration");
  };

  const isMomentumPositive = momentumPct >= 0;

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
    <div className="px-8 pb-8 pt-4">
      <div className="mb-6">
        <div>
          <h1 className="text-[30px] font-semibold leading-[1.05] tracking-tight text-foreground">
            Welcome back, {firstName(currentMember?.name || runtimeUser.name)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quick glance at what matters most today and fast ways to take action.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(300px,1fr)]">
        <div className="space-y-4 xl:contents">
          <section
            ref={pulseCardRef}
            className="relative overflow-hidden rounded-lg border border-gray-200 bg-white px-6 pb-7 pt-5 xl:col-start-1 xl:row-start-1"
          >
            <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
              <Target className="h-4 w-4 text-primary" />
            </span>

            <div className="mb-10 pr-14">
              <h2 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Clinical Execution Pulse</h2>
              <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
                Personal execution score, risk pressure, and next-week focus load.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
              <div>
                <div className="inline-flex rounded-full border border-gray-200 bg-[#FAFAFA] px-3 py-1 text-sm font-medium text-[#75778B]">
                  Personal operations score
                </div>
                <div className="mt-5 flex items-end gap-3">
                  <span className="text-[56px] font-semibold leading-none tracking-tight text-[#0E0017]">
                    {operationalScore}
                  </span>
                  <span
                    className={`mb-2 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium ${
                      isMomentumPositive
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-red-200 bg-red-50 text-red-700"
                    }`}
                  >
                    <TrendingUp className={`h-4 w-4 ${isMomentumPositive ? "" : "rotate-180"}`} />
                    {isMomentumPositive ? "+" : ""}
                    {momentumPct}%
                  </span>
                </div>
                <p className="mt-2 text-xs text-[#75778B]">
                  Composite index based on your due tasks, blockers, and completion momentum.
                </p>
              </div>

              <div className="h-[220px] rounded-[10px] border border-gray-200 bg-[#FAFAFA] p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 16, right: 8, left: -14, bottom: 6 }}>
                    <defs>
                      <linearGradient id="home4AreaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity={0.38} />
                        <stop offset="85%" stopColor="#2563EB" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#E8ECF6" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#75778B", fontSize: 12 }} />
                    <YAxis hide />
                    <Tooltip
                      cursor={{ stroke: "#B7C2DE", strokeDasharray: "4 4" }}
                      contentStyle={{
                        background: "#FFFFFF",
                        border: "1px solid #DDE2EF",
                        borderRadius: 12,
                        color: "#0E0017",
                      }}
                      formatter={(value) => [`${Number(value)} pts`, "Focus load"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="load"
                      stroke="#2563EB"
                      strokeWidth={3}
                      fill="url(#home4AreaGradient)"
                      activeDot={{ r: 6, fill: "#2563EB", stroke: "#FFFFFF", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
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
            <section className="relative overflow-hidden rounded-lg border border-gray-200 bg-white px-5 pb-5 pt-[18px]">
              <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
                <Clock3 className="h-4 w-4 text-primary" />
              </span>

              <div className="mb-4 pr-14">
                <h3 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Your Tasks Today</h3>
                <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
                  Prioritized queue for your owned trial work.
                </p>
              </div>

              <div className="space-y-2.5">
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

            <section className="relative overflow-hidden rounded-lg border border-gray-200 bg-white px-5 pb-5 pt-[18px]">
              <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
                <Users className="h-4 w-4 text-primary" />
              </span>

              <div className="mb-4 pr-14">
                <h3 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">Quick Conversations</h3>
                <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
                  Start a thread with key collaborators in one click.
                </p>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {quickChatMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => openConversation(member.id)}
                    className="group rounded-lg border border-transparent px-1 py-2 text-center hover:border-gray-200 hover:bg-[#FAFAFA]"
                  >
                    <Avatar className="mx-auto h-11 w-11">
                      <AvatarImage src={member.avatar || ""} alt={member.name} />
                      <AvatarFallback className="bg-[#E6EBF5] text-xs text-[#0E0017]">{member.initials}</AvatarFallback>
                    </Avatar>
                    <p className="mt-1 truncate text-xs font-medium text-[#0E0017]">{firstName(member.name)}</p>
                  </button>
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

          <article className="overflow-hidden rounded-lg border border-gray-200 bg-white xl:col-start-2 xl:row-start-2">
            <div className="px-5 pb-4 pt-[18px]">
              <div className="mb-[18px] flex items-center justify-between">
                <span className="whitespace-nowrap text-[14px] font-medium leading-[20px] text-[#75778B]">
                  What&apos;s Important Today
                </span>
                <span className="flex h-8 w-8 translate-x-1 items-center justify-center rounded-[7px] bg-primary/10">
                  <Sparkles className="h-4 w-4 text-primary" />
                </span>
              </div>

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

              <p className="mt-4 text-[11px] uppercase tracking-wider text-[#75778B]">Live feed powered by Themison AI</p>
            </div>

            <div className="flex items-center justify-between bg-[#FAFAFA] px-5 py-3">
              <p className="text-[14px] font-medium leading-[20px] text-[#0E0017]">See today&apos;s priorities</p>
              <Link
                href="/tasks"
                aria-label="See today's priorities"
                className="flex h-8 w-8 translate-x-1 items-center justify-center"
              >
                <ArrowRight className="h-4 w-4 text-[#75778B]" />
              </Link>
            </div>
          </article>

          <section className="relative overflow-hidden rounded-lg border border-gray-200 bg-white px-5 pb-5 pt-[18px] xl:col-start-2 xl:row-start-3">
            <span className="pointer-events-none absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10">
              <TrendingUp className="h-4 w-4 text-primary" />
            </span>

            <div className="mb-4 pr-14">
              <h3 className="text-[22px] font-semibold leading-[30px] text-[#0E0017]">3 Personal Metrics</h3>
              <p className="mt-1 text-[13px] font-medium leading-[18px] text-[#75778B]">
                Personalized indicators for your current workload.
              </p>
            </div>

            <div className="space-y-2">
              {keyMetrics.map((metric) => {
                const Icon = metric.icon;
                return (
                  <div key={metric.label} className="rounded-lg border border-gray-200 bg-[#FAFAFA] px-3 py-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm text-[#75778B]">
                        <Icon className="h-4 w-4 text-primary" />
                        {metric.label}
                      </div>
                      <p className="text-xl font-semibold leading-none text-[#0E0017]">
                        {metric.value}
                        {"suffix" in metric ? metric.suffix : ""}
                      </p>
                    </div>
                    <p className="text-xs text-[#75778B]">{metric.helper}</p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
