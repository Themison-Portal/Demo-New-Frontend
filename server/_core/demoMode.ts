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

function parseSampleSizeToTarget(sampleSize: unknown): number | undefined {
  const normalized = String(sampleSize ?? "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!normalized) return undefined;
  const match = normalized.match(/\d{1,3}(?:,\d{3})+|\d+/);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[0].replace(/,/g, ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function normalizeTargetPatients(rawTarget: unknown, sampleSize: unknown): number | undefined {
  const explicit = Number(rawTarget || 0);
  const fallback = parseSampleSizeToTarget(sampleSize);
  if (!Number.isFinite(explicit) || explicit <= 0) return fallback;

  const allDigits = Number.parseInt(String(sampleSize ?? "").replace(/[^0-9]/g, ""), 10);
  if (fallback && Number.isFinite(allDigits) && allDigits === explicit && fallback !== explicit) {
    return fallback;
  }

  if (explicit >= 500000) {
    const leading = Number.parseInt(String(explicit).slice(0, 3), 10);
    if (Number.isFinite(leading) && leading > 0 && leading <= 5000) {
      return leading;
    }
  }

  return explicit;
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
  const serialized: Record<string, unknown> = {
    ...trial,
    id: stripDemoId(trial.id),
  };

  if ("targetPatients" in (trial as Record<string, unknown>) || "sampleSize" in (trial as Record<string, unknown>)) {
    const normalizedTarget = normalizeTargetPatients(
      (trial as Record<string, unknown>).targetPatients,
      (trial as Record<string, unknown>).sampleSize
    );
    if (normalizedTarget !== undefined) {
      serialized.targetPatients = normalizedTarget;
    }
  }

  return serialized as T;
}
