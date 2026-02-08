import { eq } from "drizzle-orm";
import { trials } from "../../drizzle/schema";
import type { InferSelectModel } from "drizzle-orm";

export type DemoMode = "sample" | "full" | "building";

export function toDemoId(mode: DemoMode, id: string) {
  return `${mode}:${id}`;
}

export function stripDemoId(id: string) {
  const parts = id.split(":");
  if (parts.length < 2) return id;
  return parts.slice(1).join(":");
}

export async function resolveTrialId(
  db: { select: Function },
  mode: DemoMode,
  id: string,
  allowLegacy = true
) {
  const prefixed = toDemoId(mode, id);
  const prefixedResult = await db
    .select()
    .from(trials)
    .where(eq(trials.id, prefixed))
    .limit(1);

  if (prefixedResult.length > 0) return prefixed;

  if (!allowLegacy) return prefixed;

  const legacyResult = await db
    .select()
    .from(trials)
    .where(eq(trials.id, id))
    .limit(1);

  return legacyResult.length > 0 ? id : prefixed;
}

export function serializeTrial<T extends { id: string }>(trial: T) {
  return {
    ...trial,
    id: stripDemoId(trial.id),
  };
}
