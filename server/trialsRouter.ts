import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { trials } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export const trialsRouter = router({
  // Get a single trial by ID
  getById: publicProcedure
    .input(z.object({
      id: z.string(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [trial] = await db
        .select()
        .from(trials)
        .where(eq(trials.id, input.id))
        .limit(1);
      
      return trial || null;
    }),

  // List all trials
  list: publicProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      return await db
        .select()
        .from(trials)
        .orderBy(trials.createdAt);
    }),

  // Create a new trial
  create: protectedProcedure
    .input(z.object({
      id: z.string(),
      title: z.string(),
      protocolNumber: z.string().optional(),
      description: z.string().optional(),
      phase: z.enum(["Phase I", "Phase II", "Phase III", "Phase IV"]).optional(),
      status: z.enum(["active", "recruiting", "on-hold", "completed", "terminated"]).default("active"),
      sponsor: z.string().optional(),
      location: z.string().optional(),
      startDate: z.string().optional(), // ISO date string
      endDate: z.string().optional(), // ISO date string
      principalInvestigator: z.string().optional(),
      enrolledPatients: z.number().default(0),
      targetPatients: z.number().optional(),
      completionPercentage: z.number().default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [newTrial] = await db.insert(trials).values({
        ...input,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        createdBy: ctx.user.id,
      });

      return newTrial;
    }),

  // Update trial fields
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().optional(),
      protocolNumber: z.string().optional(),
      description: z.string().optional(),
      phase: z.enum(["Phase I", "Phase II", "Phase III", "Phase IV"]).optional(),
      status: z.enum(["active", "recruiting", "on-hold", "completed", "terminated"]).optional(),
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
      const { id, ...updates } = input;
      
      // Convert date strings to Date objects if provided
      const processedUpdates: any = { ...updates };
      if (updates.startDate) {
        processedUpdates.startDate = new Date(updates.startDate);
      }
      if (updates.endDate) {
        processedUpdates.endDate = new Date(updates.endDate);
      }

      await db
        .update(trials)
        .set(processedUpdates)
        .where(eq(trials.id, id));

      // Return updated trial
      const [updatedTrial] = await db
        .select()
        .from(trials)
        .where(eq(trials.id, id))
        .limit(1);

      return updatedTrial;
    }),

  // Delete a trial
  delete: protectedProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db
        .delete(trials)
        .where(eq(trials.id, input.id));

      return { success: true };
    }),
});
