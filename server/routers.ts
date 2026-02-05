import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { studySetupWizardRouter } from "./studySetupWizardRouter";
import { documentsRouter } from "./documentsRouter";
import { documentAIRouter } from "./documentAIRouter";
import { trialsRouter } from "./trialsRouter";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Study Setup Wizard
  studySetupWizard: studySetupWizardRouter,

  // Documents
  documents: documentsRouter,

  // Document AI Assistant
  documentAI: documentAIRouter,

  // Trials
  trials: trialsRouter,
});

export type AppRouter = typeof appRouter;
