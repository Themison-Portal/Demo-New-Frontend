import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapPhases, mapTasks, trials, type ExecutionMap, type MapPhase } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";

const DONE_STATUSES = new Set(["done", "skipped", "cancelled"]);
const PHASE_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};

function normalizeToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function startOfIsoWeek(source: Date): Date {
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

function parseDateValue(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function modeFromTrialId(trialId: string): ModeFilter | "legacy" {
  if (trialId.startsWith("sample:")) return "sample";
  if (trialId.startsWith("full:")) return "full";
  if (trialId.startsWith("building:")) return "building";
  return "legacy";
}

function shouldIncludeTrialForMode(trialId: string, mode: ModeFilter) {
  if (mode === "all") return true;
  const trialMode = modeFromTrialId(trialId);
  if (trialMode === mode) return true;
  return mode === "sample" && trialMode === "legacy";
}

function pickPreferredMap(rows: ExecutionMap[]) {
  const nonArchived = rows.filter((row) => row.status !== "archived");
  if (!nonArchived.length) return null;
  return [...nonArchived].sort((a, b) => {
    const rank = PHASE_PRIORITY[a.status] - PHASE_PRIORITY[b.status];
    if (rank !== 0) return rank;
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  })[0]!;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));
  const minArg = argv.find((arg) => arg.startsWith("--min="));
  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }
  const weeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(weeks) || weeks < 1 || weeks > 26) {
    throw new Error("weeks must be between 1 and 26");
  }
  const minPerWeek = minArg ? Number(minArg.replace("--min=", "")) : 1;
  if (!Number.isFinite(minPerWeek) || minPerWeek < 1 || minPerWeek > 20) {
    throw new Error("min must be between 1 and 20");
  }
  return { apply, mode, weeks: Math.floor(weeks), minPerWeek: Math.floor(minPerWeek) };
}

async function main() {
  const { apply, mode, weeks, minPerWeek } = parseArgs(process.argv.slice(2));
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const prefixedTrials =
    mode === "all"
      ? await db.select().from(trials)
      : await db.select().from(trials).where(like(trials.id, `${mode}:%`));
  const legacySampleTrials =
    mode === "sample" || mode === "all"
      ? await db.select().from(trials).where(notLike(trials.id, "%:%"))
      : [];
  const trialRows = [...prefixedTrials, ...legacySampleTrials].filter((trial) =>
    shouldIncludeTrialForMode(trial.id, mode)
  );
  const trialIds = trialRows.map((trial) => trial.id);
  if (!trialIds.length) {
    console.log(JSON.stringify({ apply, mode, message: "No trials found." }, null, 2));
    return;
  }

  const mapRows = await db
    .select()
    .from(executionMaps)
    .where(inArray(executionMaps.trialId, trialIds))
    .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version));
  const mapRowsByTrialId = new Map<string, ExecutionMap[]>();
  for (const row of mapRows) {
    const list = mapRowsByTrialId.get(row.trialId) ?? [];
    list.push(row);
    mapRowsByTrialId.set(row.trialId, list);
  }

  const selected = trialRows
    .map((trial) => {
      const map = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
      if (!map) return null;
      return { trialId: trial.id, trialTitle: trial.title, mapId: map.id };
    })
    .filter(Boolean) as Array<{ trialId: string; trialTitle: string; mapId: string }>;

  const mapIds = selected.map((row) => row.mapId);
  if (!mapIds.length) {
    console.log(JSON.stringify({ apply, mode, message: "No maps found." }, null, 2));
    return;
  }

  const phaseRows = await db.select().from(mapPhases).where(inArray(mapPhases.mapId, mapIds));
  const taskRows = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));
  const phasesByMap = new Map<string, MapPhase[]>();
  for (const row of phaseRows) {
    const list = phasesByMap.get(row.mapId) ?? [];
    list.push(row);
    phasesByMap.set(row.mapId, list);
  }

  const weekStart = startOfIsoWeek(new Date());
  const weekCounts = Array.from({ length: weeks }, () => 0);

  for (const task of taskRows) {
    if (DONE_STATUSES.has(normalizeToken(task.status))) continue;
    const anchor = parseDateValue(task.dueDate) ?? parseDateValue(task.suggestedDate);
    if (!anchor) continue;
    const taskWeek = startOfIsoWeek(anchor);
    const index = Math.floor((taskWeek.getTime() - weekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (index >= 0 && index < weeks) weekCounts[index] += 1;
  }

  const created: Array<{ trialId: string; week: number; taskId: string }> = [];
  let trialCursor = 0;

  for (let week = 0; week < weeks; week += 1) {
    let deficit = Math.max(0, minPerWeek - (weekCounts[week] ?? 0));
    while (deficit > 0 && selected.length > 0) {
      const owner = selected[trialCursor % selected.length]!;
      trialCursor += 1;
      const phases = phasesByMap.get(owner.mapId) ?? [];
      const phase = phases[0];
      if (!phase) break;

      const dueDate = addDays(weekStart, week * 7 + 3);
      const suggestedDate = addDays(dueDate, -2);
      const taskId = randomUUID();

      if (apply) {
        await db.insert(mapTasks).values({
          id: taskId,
          mapId: owner.mapId,
          phaseId: phase.id,
          name: `Coverage task W${week + 1}`,
          description: "System-generated to restore upcoming workload coverage.",
          category: "coordination",
          priority: "medium",
          status: "todo",
          blockedReason: null,
          blockedSince: null,
          assignedRole: "study_coordinator",
          assignedUserId: null,
          suggestedAssignee: null,
          suggestedDate,
          dueDate,
          estimatedDuration: 1,
          startDate: null,
          completedDate: null,
          orderInPhase: 1000 + week,
          canvasX: null,
          canvasY: null,
          createdBy: "ai",
          aiConfidence: 0.72,
          conditionalNote: null,
          isCustom: false,
          tags: ["future", "coverage"],
          protocolRefs: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      created.push({ trialId: owner.trialId, week, taskId });
      weekCounts[week] += 1;
      deficit -= 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        weeks,
        minPerWeek,
        weekCounts,
        createdCount: created.length,
        createdByWeek: created.reduce<Record<string, number>>((acc, row) => {
          const key = `W${row.week + 1}`;
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[patch-missing-upcoming-task-weeks] failed", error);
  process.exit(1);
});

