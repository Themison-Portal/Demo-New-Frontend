import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { trials } from "../drizzle/schema";
import { eq, like, notLike } from "drizzle-orm";
import { toDemoId, serializeTrial, resolveTrialId, type DemoMode } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";

function extractDbErrorDetails(error: unknown) {
  const err = error as any;
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  const sqlState = cause?.sqlState || err?.sqlState;
  const rawMessage =
    cause?.sqlMessage ||
    cause?.message ||
    err?.message ||
    "Database operation failed";

  return {
    code: typeof code === "string" ? code : undefined,
    sqlState: typeof sqlState === "string" ? sqlState : undefined,
    rawMessage: typeof rawMessage === "string" ? rawMessage : String(rawMessage),
  };
}

export const trialsRouter = router({
  // Get a single trial by ID
  getById: publicProcedure
    .input(z.object({
      id: z.string(),
      demoMode: z.enum(["sample", "full", "building"]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedId = await resolveTrialId(db, mode, input.id, mode !== "building");
      const [trial] = await db
        .select()
        .from(trials)
        .where(eq(trials.id, resolvedId))
        .limit(1);
      
      return trial ? serializeTrial(trial) : null;
    }),

  // List all trials
  list: publicProcedure
    .input(z.object({
      demoMode: z.enum(["sample", "full", "building"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const mode = (input?.demoMode ?? "sample") as DemoMode;
      const prefixed = await db
        .select()
        .from(trials)
        .where(like(trials.id, `${mode}:%`))
        .orderBy(trials.createdAt);

      if (prefixed.length > 0) {
        return prefixed.map(serializeTrial);
      }
      if (mode === "building") {
        return [];
      }

      const legacy = await db
        .select()
        .from(trials)
        .where(notLike(trials.id, "%:%"))
        .orderBy(trials.createdAt);

      return legacy.map(serializeTrial);
    }),

  // Create a new trial
  create: protectedProcedure
    .input(z.object({
      id: z.string(),
      title: z.string(),
      protocolNumber: z.string().optional(),
      investigationalProduct: z.string().optional(),
      indication: z.string().optional(),
      nctNumber: z.string().optional(),
      currentVersion: z.string().optional(),
      amendmentVersion: z.string().optional(),
      releaseDate: z.string().optional(),
      sampleSize: z.string().optional(),
      numberOfSites: z.string().optional(),
      studyDuration: z.string().optional(),
      studyDesignType: z.string().optional(),
      primaryObjective: z.string().optional(),
      primaryEndpoint: z.string().optional(),
      description: z.string().optional(),
      phase: z.string().optional(),
      status: z.enum(["not-started", "active", "recruiting", "on-hold", "completed", "terminated"]).default("not-started"),
      sponsor: z.string().optional(),
      location: z.string().optional(),
      startDate: z.string().optional(), // ISO date string
      endDate: z.string().optional(), // ISO date string
      principalInvestigator: z.string().optional(),
      enrolledPatients: z.number().default(0),
      targetPatients: z.number().optional(),
      completionPercentage: z.number().default(0),
      demoMode: z.enum(["sample", "full", "building"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { demoMode, ...trialInput } = input;
      const mode = (demoMode ?? "building") as DemoMode;
      const clampId = (value: string, max: number) => {
        const normalized = value
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/(^-|-$)+/g, "");
        if (!normalized) return "trial";
        if (normalized.length <= max) return normalized;

        // Preserve the random suffix when possible (e.g. slug-abc12)
        const suffixMatch = normalized.match(/-([a-z0-9]{4,8})$/);
        if (suffixMatch) {
          const suffix = suffixMatch[1];
          const baseBudget = Math.max(3, max - suffix.length - 1);
          const base = normalized.slice(0, baseBudget).replace(/-+$/g, "") || "trial";
          return `${base}-${suffix}`;
        }

        return normalized.slice(0, max).replace(/-+$/g, "") || "trial";
      };
      // Keep a conservative ID budget for environments where the column is still narrower.
      const safeBaseId = clampId(input.id, 22);
      const demoId = toDemoId(mode, safeBaseId);
      const clamp = (value: string | undefined, max: number) => {
        if (!value) return value;
        return value.length > max ? value.slice(0, max) : value;
      };
      const clampRequired = (value: string, max: number) => {
        return value.length > max ? value.slice(0, max) : value;
      };

      const insertData = {
        id: demoId,
        title: clampRequired(trialInput.title, 500),
        protocolNumber: clamp(trialInput.protocolNumber, 100),
        investigationalProduct: clamp(trialInput.investigationalProduct, 255),
        indication: clamp(trialInput.indication, 255),
        nctNumber: clamp(trialInput.nctNumber, 50),
        currentVersion: clamp(trialInput.currentVersion, 50),
        amendmentVersion: clamp(trialInput.amendmentVersion, 50),
        releaseDate: clamp(trialInput.releaseDate, 50),
        sampleSize: clamp(trialInput.sampleSize, 50),
        numberOfSites: clamp(trialInput.numberOfSites, 50),
        studyDuration: clamp(trialInput.studyDuration, 100),
        studyDesignType: clamp(trialInput.studyDesignType, 255),
        primaryObjective: trialInput.primaryObjective,
        primaryEndpoint: trialInput.primaryEndpoint,
        description: trialInput.description,
        phase: clamp(trialInput.phase, 50),
        status: trialInput.status,
        sponsor: clamp(trialInput.sponsor, 255),
        location: clamp(trialInput.location, 255),
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        principalInvestigator: clamp(trialInput.principalInvestigator, 255),
        enrolledPatients: trialInput.enrolledPatients,
        targetPatients: trialInput.targetPatients,
        completionPercentage: trialInput.completionPercentage,
        createdBy: ctx.user.id,
      };

      let didInsert = false;
      const mutableInsertData: Record<string, unknown> = { ...insertData };
      const removedColumns: string[] = [];
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          await db.insert(trials).values(mutableInsertData as any);
          didInsert = true;
          break;
        } catch (error) {
          const { rawMessage, code, sqlState } = extractDbErrorDetails(error);
          const unknownColumnMatch = rawMessage.match(/Unknown column '([^']+)'/i);
          if (unknownColumnMatch) {
            const column = unknownColumnMatch[1];
            if (column in mutableInsertData) {
              delete mutableInsertData[column];
              removedColumns.push(column);
              console.warn(`[trials.create] Retrying without missing column '${column}'`);
              continue;
            }
            throw new Error(
              `Database schema mismatch. Missing column '${column}'. Please run migrations and retry.`
            );
          }

          const isStatusEnumMismatch =
            /Data truncated for column 'status'/i.test(rawMessage) ||
            (/column 'status'/i.test(rawMessage) && /Incorrect/i.test(rawMessage)) ||
            code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" ||
            code === "WARN_DATA_TRUNCATED";
          if (isStatusEnumMismatch) {
            if ("status" in mutableInsertData) {
              delete mutableInsertData.status;
              removedColumns.push("status");
              console.warn("[trials.create] Retrying without status due enum mismatch");
              continue;
            }
            throw new Error("Database schema is outdated for trial status. Run migrations and restart the server.");
          }

          const dataTooLongMatch = rawMessage.match(/Data too long for column '([^']+)'/i);
          if (dataTooLongMatch) {
            const column = dataTooLongMatch[1];
            if (column === "id" && typeof mutableInsertData.id === "string") {
              const currentId = mutableInsertData.id;
              const colonIndex = currentId.indexOf(":");
              const prefix = colonIndex >= 0 ? currentId.slice(0, colonIndex + 1) : "";
              const body = colonIndex >= 0 ? currentId.slice(colonIndex + 1) : currentId;
              if (body.length > 8) {
                const nextBody = body.slice(0, Math.max(8, body.length - 4)).replace(/-+$/g, "");
                mutableInsertData.id = `${prefix}${nextBody || "trial"}`;
                console.warn(`[trials.create] Retrying with shorter id '${mutableInsertData.id}'`);
                continue;
              }
            }
            throw new Error(`Field '${column}' is too long. Please shorten it and try again.`);
          }
          if (/Duplicate entry/i.test(rawMessage) || code === "ER_DUP_ENTRY") {
            throw new Error("A similar trial already exists. Please try creating it again.");
          }
          console.error("[trials.create] Insert failed", {
            code,
            sqlState,
            rawMessage,
            payload: mutableInsertData,
          });
          throw new Error("Could not create trial. Please review the entered values and try again.");
        }
      }

      if (!didInsert) {
        throw new Error("Could not create trial after compatibility retries.");
      }
      const createdTrialId = String(mutableInsertData.id ?? demoId);
      if (removedColumns.length > 0) {
        console.warn(
          `[trials.create] Created trial with compatibility mode. Missing DB columns skipped: ${removedColumns.join(", ")}`
        );
      }

      await logTelemetryEvent({
        eventType: "trial_created",
        action: "created",
        userId: String(ctx.user.id),
        entityType: "trial",
        entityId: createdTrialId,
        payload: {
          title: trialInput.title,
          demoMode: mode,
        },
      });

      const [createdTrial] = await db
        .select()
        .from(trials)
        .where(eq(trials.id, createdTrialId))
        .limit(1);

      return createdTrial
        ? serializeTrial(createdTrial)
        : serializeTrial({ id: createdTrialId } as { id: string });
    }),

  // Update trial fields
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      demoMode: z.enum(["sample", "full", "building"]).optional(),
      title: z.string().optional(),
      protocolNumber: z.string().optional(),
      investigationalProduct: z.string().optional(),
      indication: z.string().optional(),
      nctNumber: z.string().optional(),
      currentVersion: z.string().optional(),
      amendmentVersion: z.string().optional(),
      releaseDate: z.string().optional(),
      sampleSize: z.string().optional(),
      numberOfSites: z.string().optional(),
      studyDuration: z.string().optional(),
      studyDesignType: z.string().optional(),
      primaryObjective: z.string().optional(),
      primaryEndpoint: z.string().optional(),
      description: z.string().optional(),
      phase: z.string().optional(),
      status: z.enum(["not-started", "active", "recruiting", "on-hold", "completed", "terminated"]).optional(),
      sponsor: z.string().optional(),
      location: z.string().optional(),
      startDate: z.string().optional(), // ISO date string
      endDate: z.string().optional(), // ISO date string
      principalInvestigator: z.string().optional(),
      enrolledPatients: z.number().optional(),
      targetPatients: z.number().optional(),
      completionPercentage: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { id, demoMode, ...updates } = input;
      const mode = (demoMode ?? "sample") as DemoMode;
      const resolvedId = await resolveTrialId(db, mode, id, mode !== "building");
      
      // Convert date strings to Date objects if provided
      const processedUpdates: any = {};
      const clamp = (value: string | undefined, max: number) => {
        if (!value) return value;
        return value.length > max ? value.slice(0, max) : value;
      };
      if (updates.title !== undefined) processedUpdates.title = clamp(updates.title, 500);
      if (updates.protocolNumber !== undefined) processedUpdates.protocolNumber = clamp(updates.protocolNumber, 100);
      if (updates.investigationalProduct !== undefined) processedUpdates.investigationalProduct = clamp(updates.investigationalProduct, 255);
      if (updates.indication !== undefined) processedUpdates.indication = clamp(updates.indication, 255);
      if (updates.nctNumber !== undefined) processedUpdates.nctNumber = clamp(updates.nctNumber, 50);
      if (updates.currentVersion !== undefined) processedUpdates.currentVersion = clamp(updates.currentVersion, 50);
      if (updates.amendmentVersion !== undefined) processedUpdates.amendmentVersion = clamp(updates.amendmentVersion, 50);
      if (updates.releaseDate !== undefined) processedUpdates.releaseDate = clamp(updates.releaseDate, 50);
      if (updates.sampleSize !== undefined) processedUpdates.sampleSize = clamp(updates.sampleSize, 50);
      if (updates.numberOfSites !== undefined) processedUpdates.numberOfSites = clamp(updates.numberOfSites, 50);
      if (updates.studyDuration !== undefined) processedUpdates.studyDuration = clamp(updates.studyDuration, 100);
      if (updates.studyDesignType !== undefined) processedUpdates.studyDesignType = clamp(updates.studyDesignType, 255);
      if (updates.primaryObjective !== undefined) processedUpdates.primaryObjective = updates.primaryObjective;
      if (updates.primaryEndpoint !== undefined) processedUpdates.primaryEndpoint = updates.primaryEndpoint;
      if (updates.description !== undefined) processedUpdates.description = updates.description;
      if (updates.phase !== undefined) processedUpdates.phase = clamp(updates.phase, 50);
      if (updates.status !== undefined) processedUpdates.status = updates.status;
      if (updates.sponsor !== undefined) processedUpdates.sponsor = clamp(updates.sponsor, 255);
      if (updates.location !== undefined) processedUpdates.location = clamp(updates.location, 255);
      if (updates.principalInvestigator !== undefined) processedUpdates.principalInvestigator = clamp(updates.principalInvestigator, 255);
      if (updates.enrolledPatients !== undefined) processedUpdates.enrolledPatients = updates.enrolledPatients;
      if (updates.targetPatients !== undefined) processedUpdates.targetPatients = updates.targetPatients;
      if (updates.completionPercentage !== undefined) processedUpdates.completionPercentage = updates.completionPercentage;
      if (updates.startDate) {
        processedUpdates.startDate = new Date(updates.startDate);
      }
      if (updates.endDate) {
        processedUpdates.endDate = new Date(updates.endDate);
      }

      const mutableUpdates: Record<string, unknown> = { ...processedUpdates };
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          if (Object.keys(mutableUpdates).length > 0) {
            await db
              .update(trials)
              .set(mutableUpdates as any)
              .where(eq(trials.id, resolvedId));
          }
          break;
        } catch (error) {
          const { rawMessage, code, sqlState } = extractDbErrorDetails(error);
          const unknownColumnMatch = rawMessage.match(/Unknown column '([^']+)'/i);
          if (unknownColumnMatch) {
            const column = unknownColumnMatch[1];
            if (column in mutableUpdates) {
              delete mutableUpdates[column];
              console.warn(`[trials.update] Retrying without missing column '${column}'`);
              continue;
            }
            throw new Error(
              `Database schema mismatch. Missing column '${column}'. Please run migrations and retry.`
            );
          }
          const isStatusEnumMismatch =
            /Data truncated for column 'status'/i.test(rawMessage) ||
            (/column 'status'/i.test(rawMessage) && /Incorrect/i.test(rawMessage)) ||
            code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" ||
            code === "WARN_DATA_TRUNCATED";
          if (isStatusEnumMismatch) {
            if ("status" in mutableUpdates) {
              delete mutableUpdates.status;
              console.warn("[trials.update] Retrying without status due enum mismatch");
              continue;
            }
            throw new Error("Database schema is outdated for trial status. Run migrations and restart the server.");
          }
          const dataTooLongMatch = rawMessage.match(/Data too long for column '([^']+)'/i);
          if (dataTooLongMatch) {
            const column = dataTooLongMatch[1];
            throw new Error(`Field '${column}' is too long. Please shorten it and try again.`);
          }
          console.error("[trials.update] Update failed", {
            code,
            sqlState,
            rawMessage,
            payload: mutableUpdates,
          });
          throw new Error("Could not update trial. Please review the entered values and try again.");
        }
      }

      // Return updated trial
      const [updatedTrial] = await db
        .select()
        .from(trials)
        .where(eq(trials.id, resolvedId))
        .limit(1);

      await logTelemetryEvent({
        eventType: "trial_edited",
        action: "edited",
        entityType: "trial",
        entityId: resolvedId,
        payload: {
          updates,
          demoMode: mode,
        },
      });

      return updatedTrial ? serializeTrial(updatedTrial) : null;
    }),

  // Delete a trial
  delete: protectedProcedure
    .input(z.object({
      id: z.string(),
      demoMode: z.enum(["sample", "full", "building"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedId = await resolveTrialId(db, mode, input.id, mode !== "building");
      await db
        .delete(trials)
        .where(eq(trials.id, resolvedId));

      await logTelemetryEvent({
        eventType: "trial_deleted",
        action: "deleted",
        entityType: "trial",
        entityId: resolvedId,
        payload: { demoMode: mode },
      });

      return { success: true };
    }),
});
