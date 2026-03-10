import { desc, inArray, like, notLike } from "drizzle-orm";
import {
  executionMaps,
  mapTasks,
  trials,
  type ExecutionMap,
  type MapTask,
} from "../drizzle/schema";
import { getDb } from "../server/db";

type Mode = "sample" | "full" | "building";

const BUSINESS_WINDOW_DAYS = 7;
const MAP_STATUS_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};

function parseArgs(argv: string[]) {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const nameArg = argv.find((arg) => arg.startsWith("--name="));
  const memberIdArg = argv.find((arg) => arg.startsWith("--member-id="));
  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as Mode;
  if (!["sample", "full", "building"].includes(mode)) {
    throw new Error("mode must be sample|full|building");
  }
  const memberName = (nameArg ? nameArg.replace("--name=", "") : "Kaleb Sanders").trim().toLowerCase();
  const memberId = (memberIdArg ? memberIdArg.replace("--member-id=", "") : "1").trim();
  return { mode, memberName, memberId };
}

function modeFromTrialId(trialId: string): "sample" | "full" | "building" | "legacy" {
  if (trialId.startsWith("sample:")) return "sample";
  if (trialId.startsWith("full:")) return "full";
  if (trialId.startsWith("building:")) return "building";
  return "legacy";
}

function shouldIncludeTrialForMode(trialId: string, mode: Mode) {
  const trialMode = modeFromTrialId(trialId);
  if (trialMode === mode) return true;
  return mode === "sample" && trialMode === "legacy";
}

function pickPreferredMap(rows: ExecutionMap[]) {
  const nonArchived = rows.filter((row) => row.status !== "archived");
  if (!nonArchived.length) return null;
  return [...nonArchived].sort((a, b) => {
    const rank = MAP_STATUS_PRIORITY[a.status] - MAP_STATUS_PRIORITY[b.status];
    if (rank !== 0) return rank;
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  })[0]!;
}

function parseDate(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function startOfDay(source: Date) {
  const result = new Date(source);
  result.setHours(0, 0, 0, 0);
  return result;
}

function isDoneStatus(status?: string | null): boolean {
  const token = String(status || "").toLowerCase();
  return token === "done" || token === "completed" || token === "cancelled" || token === "skipped";
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isBeforeDay(a: Date, b: Date) {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}

function dateKey(source: Date) {
  const date = startOfDay(source);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function businessWindow(days: number) {
  const now = startOfDay(new Date());
  const result: Date[] = [];
  const cursor = new Date(now);
  while (result.length < days) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) result.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function buildPulseLoads(tasks: MapTask[], dates: Date[]) {
  const now = startOfDay(new Date());
  const points = dates.map((date, index) => ({ index, key: dateKey(date), load: 0 }));
  const byDate = new Map(points.map((point, index) => [point.key, index]));

  let backlogCursor = 0;
  const backlogPattern = [1, 2, 3, 4, 5, 6, 2, 3, 4, 5, 6, 1] as const;
  const assignBacklog = () => {
    const slot = backlogPattern[backlogCursor % backlogPattern.length] ?? 1;
    backlogCursor += 1;
    const safeSlot = Math.max(1, Math.min(points.length - 1, slot));
    points[safeSlot].load += 1;
  };

  for (const task of tasks) {
    if (isDoneStatus(task.status)) continue;
    const due = parseDate(task.dueDate);
    const statusToken = String(task.status || "").toLowerCase();
    const blocked = statusToken === "blocked" || statusToken === "waiting";

    if (due) {
      const idx = byDate.get(dateKey(due));
      if (idx != null) {
        points[idx].load += 1;
        continue;
      }
      if (isBeforeDay(due, now)) {
        points[0].load += 1;
        continue;
      }
    }

    if (blocked) {
      points[0].load += 1;
      continue;
    }

    assignBacklog();
  }

  return points.map((point) => point.load);
}

function scopeTasksForMember(tasks: MapTask[], memberName: string, memberId: string) {
  const normalizedName = memberName.trim().toLowerCase();
  const scoped = tasks.filter((task) => {
    const matchById =
      task.assignedUserId != null &&
      (memberId === String(task.assignedUserId) || memberId === `member-${task.assignedUserId}`);
    const matchByName = String(task.suggestedAssignee || "").trim().toLowerCase() === normalizedName;
    return matchById || matchByName;
  });
  return scoped.length > 0 ? scoped : tasks;
}

async function main() {
  const { mode, memberName, memberId } = parseArgs(process.argv.slice(2));
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const prefixedTrials = await db.select().from(trials).where(like(trials.id, `${mode}:%`));
  const legacySampleTrials =
    mode === "sample" ? await db.select().from(trials).where(notLike(trials.id, "%:%")) : [];
  const trialRows = [...prefixedTrials, ...legacySampleTrials].filter((trial) =>
    shouldIncludeTrialForMode(trial.id, mode)
  );

  const trialIds = trialRows.map((trial) => trial.id);
  if (!trialIds.length) {
    console.log(JSON.stringify({ mode, message: "No trials found." }, null, 2));
    return;
  }

  const mapRows = await db
    .select()
    .from(executionMaps)
    .where(inArray(executionMaps.trialId, trialIds))
    .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version));
  const mapsByTrialId = new Map<string, ExecutionMap[]>();
  for (const row of mapRows) {
    const list = mapsByTrialId.get(row.trialId) ?? [];
    list.push(row);
    mapsByTrialId.set(row.trialId, list);
  }

  const selectedMaps = trialRows
    .map((trial) => pickPreferredMap(mapsByTrialId.get(trial.id) ?? []))
    .filter(Boolean) as ExecutionMap[];
  const mapIds = selectedMaps.map((row) => row.id);
  if (!mapIds.length) {
    console.log(JSON.stringify({ mode, message: "No active maps found." }, null, 2));
    return;
  }

  const allTasks = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));
  const scopedTasks = scopeTasksForMember(allTasks, memberName, memberId);
  const openTasks = scopedTasks.filter((task) => !isDoneStatus(task.status));

  const now = new Date();
  const today = startOfDay(now);
  const dueToday = openTasks.filter((task) => {
    const due = parseDate(task.dueDate);
    return Boolean(due && isSameDay(due, today));
  }).length;
  const overdue = openTasks.filter((task) => {
    const due = parseDate(task.dueDate);
    return Boolean(due && isBeforeDay(due, today));
  }).length;
  const blocked = openTasks.filter((task) => {
    const status = String(task.status || "").toLowerCase();
    return status === "blocked" || status === "waiting";
  }).length;
  const completedToday = scopedTasks.filter((task) => {
    const completed = parseDate(task.completedDate);
    return Boolean(completed && isSameDay(completed, today));
  }).length;

  const dates = businessWindow(BUSINESS_WINDOW_DAYS);
  const pulse = buildPulseLoads(scopedTasks, dates);
  const openByStatus = openTasks.reduce<Record<string, number>>((acc, task) => {
    const key = String(task.status || "unknown").toLowerCase();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        mode,
        memberId,
        memberName,
        selectedTrialCount: trialIds.length,
        selectedMapCount: mapIds.length,
        scopedTaskCount: scopedTasks.length,
        openOwned: openTasks.length,
        dueToday,
        overdue,
        blocked,
        completedToday,
        pulse,
        openByStatus,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[inspect-home4-kaleb-metrics] failed", error);
  process.exit(1);
});
