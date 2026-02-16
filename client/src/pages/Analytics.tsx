import { useMemo } from "react";
import { useDemoState } from "@/contexts/DemoStateContext";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, CheckCircle2, FlaskConical } from "lucide-react";

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

export default function Analytics() {
  const { state, getCurrentDataMode } = useDemoState();
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

  return (
    <div className="px-8 pb-8 pt-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Analytics</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Cross-trial execution metrics for workload, throughput, and risk.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Trials</CardTitle>
            <FlaskConical className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{activeTrials}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {trials.length} total in current mode
            </p>
          </CardContent>
        </Card>

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
