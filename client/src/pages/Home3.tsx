import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock3,
  LayoutGrid,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDemoState } from "@/contexts/DemoStateContext";
import { trpc } from "@/lib/trpc";
import { logEvent } from "@/lib/telemetry";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type WorkspaceTask = {
  id: string;
  name: string;
  status?: string | null;
  dueDate?: string | null;
  completedDate?: string | null;
  updatedAt?: string | null;
  assignedUserId?: number | null;
  suggestedAssignee?: string | null;
  priority?: string | null;
  mapId?: string;
};

type WorkspaceRow = {
  map?: { id: string; trialId: string };
  tasks?: WorkspaceTask[];
};

const GRAPH_COLORS = ["#1D4ED8", "#2563EB", "#3B82F6", "#60A5FA", "#93C5FD", "#BFDBFE", "#DBEAFE"];

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

function formatDueDate(value?: string | null): string {
  const date = parseDate(value);
  if (!date) return "No due date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function firstName(name?: string | null): string {
  const cleaned = String(name || "").trim();
  if (!cleaned) return "User";
  return cleaned.split(" ")[0] || "User";
}

export default function Home3() {
  const { state, getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  const [, setLocation] = useLocation();

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

  const trialLabelById = useMemo(() => {
    const result = new Map<string, string>();
    for (const trial of trials) {
      result.set(String(trial.id), String(trial.investigationalProduct || trial.title || trial.id));
    }
    return result;
  }, [trials]);

  const mapById = useMemo(() => {
    const result = new Map<string, string>();
    for (const row of workspaceRows) {
      if (row.map?.id && row.map?.trialId) {
        result.set(row.map.id, row.map.trialId);
      }
    }
    return result;
  }, [workspaceRows]);

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

  const todaySummary = useMemo(() => {
    const now = new Date();
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
    return { dueToday, overdue, blocked };
  }, [scopedTasks]);

  const personalMetrics = useMemo(() => {
    const myOpen = scopedTasks.filter((task) => !isDoneStatus(task.status)).length;
    const dueToday = todaySummary.dueToday;
    const blocked = todaySummary.blocked;
    return [
      {
        title: "My Open Tasks",
        value: myOpen,
        subtitle: "Actions currently owned by you",
        icon: ListChecks,
      },
      {
        title: "Due Today",
        value: dueToday,
        subtitle: "Needs completion before end of day",
        icon: Clock3,
      },
      {
        title: "Blocked",
        value: blocked,
        subtitle: "Waiting on decisions or dependencies",
        icon: AlertTriangle,
      },
    ];
  }, [scopedTasks, todaySummary.blocked, todaySummary.dueToday]);

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
        const trail = trialId ? trialLabelById.get(trialId) || trialId : "Cross-trial";
        return {
          id: task.id,
          title: String(task.name || "Untitled task"),
          trail,
          dueLabel: formatDueDate(task.dueDate),
          score,
          statusTag: overdue ? "Overdue" : dueToday ? "Today" : status === "blocked" ? "Blocked" : "Open",
          statusClass:
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
      .slice(0, 6);

    if (ranked.length > 0) return ranked;

    return state.tasks
      .filter((task) => !task.completed)
      .map((task, index) => ({
        id: task.id,
        title: task.name,
        trail: "General workspace",
        dueLabel: "Today",
        score: 100 - index,
        statusTag: task.status === "waiting_on_monitor" ? "Blocked" : task.status === "due_today" ? "Today" : "Open",
        statusClass:
          task.status === "waiting_on_monitor"
            ? "border-violet-200 bg-violet-50 text-violet-700"
            : task.status === "due_today"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-blue-200 bg-blue-50 text-blue-700",
      }))
      .slice(0, 6);
  }, [mapById, scopedTasks, state.tasks, trialLabelById]);

  const quickChatMembers = useMemo(() => {
    const currentId = currentMember?.id;
    return state.teamMembers.filter((member) => member.id !== currentId).slice(0, 8);
  }, [currentMember?.id, state.teamMembers]);

  const upcomingLoad = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const points = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return {
        key: date.toISOString(),
        label: index === 0 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" }),
        load: 0,
      };
    });

    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const priorityWeight: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 1 };

    scopedTasks.forEach((task) => {
      if (isDoneStatus(task.status)) return;
      const due = parseDate(task.dueDate);
      if (!due) return;
      if (due.getTime() < start.getTime() || due.getTime() >= end.getTime()) return;
      const index = Math.floor((due.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      if (index < 0 || index >= points.length) return;
      const weight = priorityWeight[String(task.priority || "medium").toLowerCase()] || 1;
      points[index].load += weight;
    });

    if (points.every((item) => item.load === 0)) {
      const seed = Math.max(3, state.tasks.filter((task) => !task.completed).length);
      return points.map((point, index) => ({
        ...point,
        load: Math.max(1, seed - Math.floor((seed / 6) * index)),
      }));
    }

    return points;
  }, [scopedTasks, state.tasks]);

  const graphTotals = useMemo(() => {
    const total = upcomingLoad.reduce((sum, point) => sum + point.load, 0);
    const peak = Math.max(...upcomingLoad.map((point) => point.load));
    return { total, peak };
  }, [upcomingLoad]);

  const handleQuickConversation = (memberId: string) => {
    logEvent({
      eventType: "feature_used",
      action: "quick_conversation",
      entityType: "team_member",
      entityId: memberId,
      payload: { from: "/home3" },
    });
    setLocation("/collaboration");
  };

  return (
    <div className="px-8 pb-8 pt-4">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold leading-[1.05] tracking-tight text-foreground">
            Welcome back, {firstName(currentMember?.name || runtimeUser.name)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quick glance at what matters most today and fast ways to take action.
          </p>
        </div>
        <Button asChild variant="outline" className="border-border bg-white text-foreground">
          <Link href="/tasks">
            Open task manager
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </header>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="overflow-hidden border-[#DDE5FF] shadow-none lg:col-span-8">
          <div className="grid h-full grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="p-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#DDE5FF] bg-[#F4F7FF] px-3 py-1 text-xs font-medium text-primary">
                <Brain className="h-3.5 w-3.5" />
                Themison AI + Brain
              </div>
              <h2 className="mt-4 text-[26px] font-semibold leading-[1.15] text-foreground">
                Ask the brain anything about your trial day
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Jump directly into Themison AI for protocol answers, next actions, and cross-trial context tied to your workload.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Link href="/documents">
                    Open Themison AI
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
                  <Link href="/analytics">See analytics context</Link>
                </Button>
              </div>
            </div>
            <div className="relative min-h-[240px] border-t border-[#E6EBF5] bg-[#F7F9FF] lg:border-l lg:border-t-0">
              <iframe
                src="https://my.spline.design/particleaibraincopycopy-HKDz858gzcKxD2SysKCQOoyn/"
                title="Themison brain"
                className="absolute inset-0 h-full w-full border-0"
                loading="lazy"
                allow="autoplay; fullscreen"
              />
            </div>
          </div>
        </Card>

        <Card className="border-border shadow-none lg:col-span-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold text-foreground">What&apos;s Important Today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm text-foreground">{todaySummary.dueToday} tasks due today</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <span className="text-sm text-foreground">{todaySummary.overdue} tasks overdue</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-sm text-foreground">{todaySummary.blocked} tasks blocked/waiting</span>
            </div>
            <p className="pt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Live feed powered by Themison AI
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {personalMetrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.title} className="border-border shadow-none">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{metric.title}</CardTitle>
                <Icon className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold leading-none text-foreground">{metric.value}</div>
                <p className="mt-2 text-xs text-muted-foreground">{metric.subtitle}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card className="border-border shadow-none xl:col-span-8">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold text-foreground">Start a Conversation</CardTitle>
            <p className="text-sm text-muted-foreground">
              Quick-access colleagues for immediate collaboration.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
              {quickChatMembers.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => handleQuickConversation(member.id)}
                  className="group flex flex-col items-center rounded-lg border border-transparent px-2 py-3 text-center transition-colors hover:border-border hover:bg-muted/40"
                >
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={member.avatar || ""} alt={member.name} />
                    <AvatarFallback className="bg-[#E6EBF5] text-xs text-foreground">
                      {member.initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="mt-2 text-sm font-medium text-foreground">{firstName(member.name)}</span>
                  <span className="mt-0.5 text-[11px] text-muted-foreground">
                    {member.team || member.role || "Team"}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <Button asChild variant="outline" size="sm" className="bg-white">
                <Link href="/collaboration">
                  View all
                  <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none xl:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold text-foreground">Your Tasks Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {todayTasks.length === 0 ? (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
                  No active tasks right now.
                </div>
              ) : (
                todayTasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-medium border ${task.statusClass}`}>
                        {task.statusTag}
                      </span>
                      <span className="text-xs text-muted-foreground">{task.dueLabel}</span>
                    </div>
                    <p className="truncate text-sm text-foreground">{task.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{task.trail}</p>
                  </div>
                ))
              )}
            </div>
            <Button asChild variant="link" className="mt-3 h-auto p-0 text-xs text-muted-foreground hover:text-foreground">
              <Link href="/tasks">
                Go to task manager
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <Card className="border-border shadow-none">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg font-semibold text-foreground">Your 7-Day Focus Load</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Visual workload trend to help you rebalance your week early.
                </p>
              </div>
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Load points</p>
                  <p className="text-2xl font-semibold leading-tight text-foreground">{graphTotals.total}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Peak day</p>
                  <p className="text-2xl font-semibold leading-tight text-foreground">{graphTotals.peak}</p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[290px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={upcomingLoad} margin={{ top: 20, right: 8, left: -8, bottom: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(29, 78, 216, 0.08)" }}
                    contentStyle={{ borderRadius: 10, borderColor: "#DDE2EF" }}
                    formatter={(value) => [`${Number(value)} pts`, "Focus load"]}
                  />
                  <Bar dataKey="load" radius={[8, 8, 0, 0]} maxBarSize={78}>
                    {upcomingLoad.map((_, index) => (
                      <Cell key={`load-cell-${index}`} fill={GRAPH_COLORS[index % GRAPH_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <LayoutGrid className="h-3.5 w-3.5" />
              Use this graph to move tasks before bottlenecks appear.
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
