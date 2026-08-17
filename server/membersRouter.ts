import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";
import { callBackend } from "./_core/backendClient";
import { isConnectionError } from "./_core/fallbackHelper";

export const membersRouter = router({
    /**
     * Get the currently authenticated member's profile from the backend.
     */
    me: protectedProcedure.query(async (opts) => {
        const { ctx } = opts;
        try {
            const member = await callBackend<any>("/api/members/me", {
                user: ctx.user,
                authToken: ctx.authToken,
            });
            return member;
        } catch (err) {
            if (isConnectionError(err)) return null;
            console.error("[membersRouter] Error fetching current member:", err);
            return null;
        }
    }),

    /**
     * List all members in the current user's organization.
     */
    list: protectedProcedure.query(async (opts) => {
        const { ctx } = opts;
        try {
            const members = await callBackend<any[]>("/api/members/", {
                user: ctx.user,
                authToken: ctx.authToken,
            });
            return Array.isArray(members) ? members : [];
        } catch (err) {
            if (isConnectionError(err)) return [];
            console.error("[membersRouter] Error fetching members:", err);
            return [];
        }
    }),

    /**
     * List members assigned to a specific trial.
     */
    listByTrial: protectedProcedure
        .input(z.object({ trialId: z.string() }))
        .query(async (opts) => {
            const { ctx, input } = opts;
            try {
                const members = await callBackend<any[]>("/api/trial-members/", {
                    query: { trial_id: input.trialId },
                    user: ctx.user,
                    authToken: ctx.authToken,
                });
                return Array.isArray(members) ? members : [];
            } catch (err) {
                if (isConnectionError(err)) return [];
                console.error("[membersRouter] Error fetching trial members:", err);
                return [];
            }
        }),
});
