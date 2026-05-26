import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";
import { callBackend } from "./_core/backendClient";

export const patientsRouter = router({
  listByTrial: protectedProcedure
    .input(z.object({ trialId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const enrollments = await callBackend<any[]>(`/api/trial-patients`, {
          query: { trial_id: input.trialId },
          user: ctx.user,
        });
        return enrollments;
      } catch (err) {
        console.error("Error in listByTrial proxy:", err);
        return [];
      }
    }),

  generateCode: protectedProcedure
    .input(z.void())
    .query(async ({ ctx }) => {
      try {
        const res = await callBackend<{ patient_code: string }>(`/api/patients/generate-code`, {
          user: ctx.user,
        });
        return res;
      } catch (err) {
        console.error("Error in generateCode proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate patient code",
        });
      }
    }),

  enrollPatient: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        patientCode: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        dateOfBirth: z.string().optional(),
        gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        consentSigned: z.boolean().default(false),
        consentDate: z.string().optional(),
        screeningNotes: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Step 1: Create patient in database
        const patientPayload = {
          patient_code: input.patientCode,
          first_name: input.firstName,
          last_name: input.lastName,
          date_of_birth: input.dateOfBirth ? input.dateOfBirth.split("T")[0] : null,
          gender: input.gender,
          phone_number: input.phone || null,
          email: input.email || null,
          consent_signed: input.consentSigned,
          consent_date: input.consentDate ? input.consentDate.split("T")[0] : null,
          screening_notes: input.screeningNotes || null,
        };

        const patient = await callBackend<any>("/api/patients", {
          method: "POST",
          body: patientPayload,
          user: ctx.user,
        });

        // Step 2: Enroll patient in trial
        const enrollmentPayload = {
          trial_id: input.trialId,
          patient_id: patient.id,
          status: "enrolled",
          notes: input.notes || "",
        };

        const enrollment = await callBackend<any>("/api/trial-patients", {
          method: "POST",
          body: enrollmentPayload,
          user: ctx.user,
        });

        return enrollment;
      } catch (err) {
        console.error("Error in enrollPatient proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to enroll patient in trial",
        });
      }
    }),

  listVisits: protectedProcedure
    .input(z.object({ patientId: z.string(), trialId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const visits = await callBackend<any[]>(`/api/patient-visits`, {
          query: { patient_id: input.patientId, trial_id: input.trialId },
          user: ctx.user,
        });
        return visits;
      } catch (err) {
        console.error("Error in listVisits proxy:", err);
        return [];
      }
    }),

  createVisit: protectedProcedure
    .input(
      z.object({
        patientId: z.string(),
        trialId: z.string(),
        visitDate: z.string(),
        visitTime: z.string().optional(),
        visitType: z.string().default("follow_up"),
        notes: z.string().optional(),
        location: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Find current member ID to act as doctor_id
        const currentMember = await callBackend<any>("/api/members/me", { user: ctx.user });
        if (!currentMember || !currentMember.id) {
          throw new Error("Could not retrieve current member details");
        }

        const visitPayload = {
          patient_id: input.patientId,
          trial_id: input.trialId,
          doctor_id: currentMember.id,
          visit_date: input.visitDate.split("T")[0],
          visit_time: input.visitTime || null,
          visit_type: input.visitType,
          status: "scheduled",
          notes: input.notes || "",
          location: input.location || "",
        };

        const visit = await callBackend<any>("/api/patient-visits", {
          method: "POST",
          body: visitPayload,
          user: ctx.user,
        });

        return visit;
      } catch (err) {
        console.error("Error in createVisit proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to schedule patient visit",
        });
      }
    }),
});
