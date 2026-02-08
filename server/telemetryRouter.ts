import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { logTelemetryEvent } from "./_core/telemetry";

const telemetryInput = z.object({
  eventType: z.string(),
  action: z.string(),
  sessionId: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  payload: z.unknown().optional(),
  durationMs: z.number().optional(),
  aiInvolved: z.boolean().optional(),
  aiOutput: z.string().optional(),
  aiSources: z.unknown().optional(),
  userCorrection: z.string().optional(),
});

export const telemetryRouter = router({
  logEvent: publicProcedure
    .input(telemetryInput)
    .mutation(async ({ input, ctx }) => {
      await logTelemetryEvent({
        eventType: input.eventType,
        action: input.action,
        sessionId: input.sessionId,
        userId: ctx.user ? String(ctx.user.id) : null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        payload: input.payload ?? null,
        durationMs: input.durationMs ?? null,
        aiInvolved: input.aiInvolved ?? false,
        aiOutput: input.aiOutput ?? null,
        aiSources: input.aiSources ?? null,
        userCorrection: input.userCorrection ?? null,
      });
      return { success: true } as const;
    }),
});
