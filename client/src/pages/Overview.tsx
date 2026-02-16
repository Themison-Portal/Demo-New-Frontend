/**
 * Overview Dashboard Page
 * Design: Clinical Modernism - Information-first layout with systematic spacing
 * Features: Key metrics, task list, and status indicators
 */

import { useDemoState } from "@/contexts/DemoStateContext";
import { trpc } from "@/lib/trpc";
import { Bell, TrendingUp, TrendingDown, ExternalLink, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface MetricCard {
  title: string;
  value: number;
  change: number;
  changeLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  linkText: string;
  linkHref: string;
}

const statusTypeMap = {
  due_today: "due" as const,
  waiting_on_monitor: "waiting" as const,
  review_pending: "review" as const,
  need_answers: "answer" as const,
  completed: "answer" as const,
};

const statusLabelMap = {
  due_today: "Due today",
  waiting_on_monitor: "Waiting on monitor",
  review_pending: "Review pending",
  need_answers: "Need answers",
  completed: "Completed",
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

const getStatusStyles = (statusType: "due" | "waiting" | "review" | "answer") => {
  switch (statusType) {
    case "due":
      return "bg-red-50 text-red-700 border border-red-200";
    case "waiting":
      return "bg-orange-50 text-orange-700 border border-orange-200";
    case "review":
      return "bg-yellow-50 text-yellow-700 border border-yellow-200";
    case "answer":
      return "bg-green-50 text-green-700 border border-green-200";
    default:
      return "bg-gray-50 text-gray-700 border border-gray-200";
  }
};

export default function Overview() {
  const { state, updateTask, getActiveTasksCount } = useDemoState();
  
  // Fetch trials from database
  const { getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  const { data: trials = [] } = trpc.trials.list.useQuery({ demoMode: currentDataMode });
  const activeTrialsCount = trials.filter(t => ['active', 'recruiting'].includes(t.status)).length;

  const handleMetricClick = (href: string) => {
    toast.info("Feature coming soon");
  };

  const handleTaskToggle = (taskId: string) => {
    const task = state.tasks.find(t => t.id === taskId);
    if (task) {
      updateTask(taskId, { completed: !task.completed });
    }
  };

  // Calculate dynamic metrics
  const activeTasksCount = getActiveTasksCount();
  const blockedTasksCount = state.tasks.filter(t => t.status === "waiting_on_monitor" && !t.completed).length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            Overview
          </h1>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const isNegative = metric.change < 0;
          
          // Use dynamic values for certain metrics
          let displayValue = metric.value;
          if (metric.title === "Active Trials") displayValue = activeTrialsCount;
          if (metric.title === "Team Members") displayValue = state.teamMembers.length;
          if (metric.title === "Your Tasks") displayValue = activeTasksCount;
          if (metric.title === "Blocked") displayValue = blockedTasksCount;
          
          return (
            <Card key={metric.title} className="border-border">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {metric.title}
                </CardTitle>
                <Icon className={`h-4 w-4 ${isNegative ? 'text-destructive' : 'text-primary'}`} />
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-3xl font-bold text-foreground">
                    {displayValue}
                  </span>
                  <span className={`text-xs font-medium ${isNegative ? 'text-destructive' : 'text-primary'}`}>
                    {metric.changeLabel}
                  </span>
                </div>
                <Button
                  variant="link"
                  className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleMetricClick(metric.linkHref)}
                >
                  {metric.linkText}
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Important Now Section */}
      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-semibold text-foreground">
            Important Now
          </CardTitle>
          <Button
            variant="link"
            className="h-auto p-0 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => toast.info("Feature coming soon")}
          >
            View All
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {/* Header Row */}
            <div className="grid grid-cols-2 gap-4 px-4 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
              <div>Tasks Name</div>
              <div>Status</div>
            </div>
            
            {/* Task Rows */}
            {state.tasks.map((task) => (
              <div
                key={task.id}
                className="grid grid-cols-2 gap-4 px-4 py-3 hover:bg-muted/50 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`h-4 w-4 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
                      task.completed
                        ? "bg-primary border-primary"
                        : "border-muted-foreground hover:border-primary"
                    }`}
                    onClick={() => handleTaskToggle(task.id)}
                  >
                    {task.completed && (
                      <svg
                        className="h-3 w-3 text-white"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-sm ${
                    task.completed
                      ? "text-muted-foreground line-through"
                      : "text-foreground"
                  }`}>
                    {task.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${getStatusStyles(statusTypeMap[task.status])}`}>
                    {statusLabelMap[task.status]}
                    <ExternalLink className="h-3 w-3" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
