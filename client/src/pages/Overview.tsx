import { useMemo } from "react";
import { useDemoState } from "@/contexts/DemoStateContext";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  Sparkles,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { logEvent } from "@/lib/telemetry";

interface MetricCard {
  title: string;
  value: number;
  change: number;
  changeLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  linkText: string;
  linkHref: string;
}

type WorkspaceTask = {
  id: string;
  name: string;
  status?: string | null;
  dueDate?: string | null;
  completedDate?: string | null;
  updatedAt?: string | null;
  mapId?: string;
};

type WorkspaceRow = {
  map?: { id: string; trialId: string };
  tasks?: WorkspaceTask[];
};

const metrics: MetricCard[] = [
  {
    title: "Active Trials",
    value: 12,
    change: 2.8,
    changeLabel: "+2.8%",
    icon: TrendingUp,
    linkText: "Go to Trial Workspace",
    linkHref: "/workspace",
  },
  {
    title: "Team Members",
    value: 8,
    change: 2.8,
    changeLabel: "+2.8%",
    icon: TrendingUp,
    linkText: "Go to Collaboration Hub",
    linkHref: "/collaboration",
  },
  {
    title: "Your Tasks",
    value: 21,
    change: -3.1,
    changeLabel: "⚠ 3.1%",
    icon: TrendingDown,
    linkText: "Go to Task Manager",
    linkHref: "/tasks",
  },
  {
    title: "Blocked",
    value: 4,
    change: 2.8,
    changeLabel: "+2.8%",
    icon: TrendingUp,
    linkText: "Waiting on Monitor",
    linkHref: "/tasks?filter=blocked",
  },
];

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
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function timeAgo(value?: string | null): string {
  const date = parseDate(value);
  if (!date) return "just now";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function shorten(value: string, max = 44): string {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export default function Overview() {
  const { state, getActiveTasksCount, getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();

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

  const { data: docsByTrial = {} } = trpc.documents.listMultipleTrials.useQuery(
    {
      trialIds: trials.map((trial) => trial.id),
      demoMode: currentDataMode,
    },
    {
      enabled: trials.length > 0,
      refetchInterval: 15000,
    }
  );

  const activeTrialsCount = trials.filter((trial) =>
    ["active", "recruiting"].includes(String(trial.status || ""))
  ).length;

  const activeTasksCount = getActiveTasksCount();
  const blockedTasksCount = state.tasks.filter(
    (task) => task.status === "waiting_on_monitor" && !task.completed
  ).length;

  const currentUserFirstName = useMemo(() => {
    let name = "";
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem("manus-runtime-user-info");
        if (raw) {
          const parsed = JSON.parse(raw) as { name?: unknown };
          if (typeof parsed?.name === "string" && parsed.name.trim()) {
            name = parsed.name.trim();
          }
        }
      } catch {}
    }
    const fullName = String(name || "Coordinator").trim();
    return fullName.split(" ")[0] || "Coordinator";
  }, []);

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

  const liveHighlights = useMemo(() => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const dueToday = workspaceTasks.filter((task) => {
      const due = parseDate(task.dueDate);
      return Boolean(due && isSameDay(due, now) && !isDoneStatus(task.status));
    }).length;

    const overdue = workspaceTasks.filter((task) => {
      const due = parseDate(task.dueDate);
      return Boolean(due && due.getTime() < now.getTime() && !isDoneStatus(task.status));
    }).length;

    const doneYesterday = workspaceTasks.filter((task) => {
      const done = parseDate(task.completedDate);
      return Boolean(done && isSameDay(done, yesterday));
    }).length;

    return [
      `You have ${dueToday} tasks due today`,
      overdue > 0 ? `${overdue} tasks are overdue` : "No overdue tasks right now",
      `Completed yesterday: ${doneYesterday} tasks`,
    ];
  }, [workspaceTasks]);

  const aiTaskFeed = useMemo(() => {
    const now = new Date();
    const base = workspaceTasks.map((task) => {
      const due = parseDate(task.dueDate);
      const overdue = Boolean(due && due.getTime() < now.getTime() && !isDoneStatus(task.status));
      const dueToday = Boolean(due && isSameDay(due, now) && !isDoneStatus(task.status));
      const status = String(task.status || "todo");
      const score = overdue ? 5 : dueToday ? 4 : status === "blocked" ? 3 : status === "in_progress" ? 2 : 1;
      const mapTrialId = task.mapId ? mapById.get(task.mapId) : undefined;
      return {
        id: task.id,
        title: shorten(task.name || "Untitled task", 56),
        trail: mapTrialId ? shorten(trialLabelById.get(mapTrialId) || mapTrialId, 36) : "Cross-trial",
        score,
        dueDate: due,
        tag:
          overdue ? "Overdue" : dueToday ? "Due today" : status === "blocked" ? "Blocked" : "In progress",
        tagClass:
          overdue
            ? "bg-rose-50 border-rose-200 text-rose-700"
            : dueToday
              ? "bg-amber-50 border-amber-200 text-amber-700"
              : status === "blocked"
                ? "bg-violet-50 border-violet-200 text-violet-700"
                : "bg-blue-50 border-blue-200 text-blue-700",
      };
    });

    if (base.length > 0) {
      return base
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (a.dueDate?.getTime() || Infinity) - (b.dueDate?.getTime() || Infinity);
        })
        .slice(0, 6);
    }

    return state.tasks.slice(0, 6).map((task) => ({
      id: task.id,
      title: shorten(task.name, 56),
      trail: "General",
      score: 1,
      dueDate: null as Date | null,
      tag: task.status === "due_today" ? "Due today" : task.status === "waiting_on_monitor" ? "Blocked" : "Open",
      tagClass:
        task.status === "due_today"
          ? "bg-amber-50 border-amber-200 text-amber-700"
          : task.status === "waiting_on_monitor"
            ? "bg-violet-50 border-violet-200 text-violet-700"
            : "bg-blue-50 border-blue-200 text-blue-700",
    }));
  }, [mapById, state.tasks, trialLabelById, workspaceTasks]);

  const recentDocuments = useMemo(() => {
    const flattened = Object.entries(docsByTrial as Record<string, any[]>).flatMap(
      ([trialId, docs]) =>
        (docs || []).map((doc) => ({
          id: String(doc.id),
          trialId,
          filename: String(doc.filename || "Untitled document"),
          createdAt: String(doc.createdAt || doc.updatedAt || ""),
        }))
    );

    return flattened
      .sort(
        (a, b) =>
          (parseDate(b.createdAt)?.getTime() || 0) - (parseDate(a.createdAt)?.getTime() || 0)
      )
      .slice(0, 6)
      .map((entry) => ({
        ...entry,
        trialLabel: shorten(trialLabelById.get(entry.trialId) || entry.trialId, 28),
      }));
  }, [docsByTrial, trialLabelById]);

  const handleMetricClick = (metric: MetricCard) => {
    logEvent({
      eventType: "feature_used",
      action: "open_metric_link",
      entityType: "overview_metric",
      entityId: metric.title,
      payload: {
        href: metric.linkHref,
        demoMode: currentDataMode,
      },
    });
    toast.info("Feature coming soon");
  };

  return (
    <div className="px-8 pb-8 pt-4">
      <div className="mb-6">
        <h2 className="text-[28px] leading-[1.1] font-semibold tracking-tight text-foreground">
          Hello, {currentUserFirstName}
        </h2>
        <p className="mt-1 text-[16px] leading-tight text-muted-foreground">
          How would you like to start your day?
        </p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const isNegative = metric.change < 0;
          let displayValue = metric.value;
          if (metric.title === "Active Trials") displayValue = activeTrialsCount;
          if (metric.title === "Team Members") displayValue = state.teamMembers.length;
          if (metric.title === "Your Tasks") displayValue = activeTasksCount;
          if (metric.title === "Blocked") displayValue = blockedTasksCount;

          return (
            <Card key={metric.title} className="border-border shadow-none">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {metric.title}
                </CardTitle>
                <Icon className={`h-4 w-4 ${isNegative ? "text-destructive" : "text-primary"}`} />
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-foreground">{displayValue}</span>
                  <span className={`text-xs font-medium ${isNegative ? "text-destructive" : "text-primary"}`}>
                    {metric.changeLabel}
                  </span>
                </div>
                <Button
                  variant="link"
                  className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleMetricClick(metric)}
                >
                  {metric.linkText}
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section className="mb-6 overflow-hidden rounded-lg border border-[#DDE2EF] bg-transparent">
        <iframe
          src="https://my.spline.design/particleaibraincopycopy-HKDz858gzcKxD2SysKCQOoyn/"
          title="AI Brain Visualization"
          className="h-[320px] w-full"
          frameBorder="0"
          loading="lazy"
          allow="autoplay; fullscreen"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="relative min-h-[430px] overflow-hidden border-[#DDE5FF] shadow-none lg:col-span-4">
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: "url('/images/daily-summary-card.png')" }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[rgba(9,23,107,0.18)] via-[rgba(17,35,136,0.36)] to-[rgba(16,30,122,0.58)]" />
          <CardHeader className="relative pb-0">
            <CardTitle className="text-[22px] leading-[1.1] font-semibold text-white">
              What's Important Today
            </CardTitle>
          </CardHeader>
          <CardContent className="relative mt-auto pb-6 text-white">
            <div className="space-y-2 text-[14px] leading-snug">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-white/90" />
                <span>{liveHighlights[0]}</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-white/90" />
                <span>{liveHighlights[1]}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-white/90" />
                <span>{liveHighlights[2]}</span>
              </div>
            </div>
            <p className="mt-4 text-[11px] uppercase tracking-wider text-white/80">
              Live feed powered by Themison AI
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold text-foreground">Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {aiTaskFeed.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
                >
                  <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-medium border ${task.tagClass}`}>
                    {task.tag}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{task.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{task.trail}</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold text-foreground">Recent Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentDocuments.length === 0 ? (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                  No documents available yet.
                </div>
              ) : (
                recentDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{shorten(doc.filename, 34)}</p>
                      <p className="truncate text-xs text-muted-foreground">{doc.trialLabel}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      {timeAgo(doc.createdAt)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
