import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";
import { callBackend } from "./_core/backendClient";
import { isConnectionError } from "./_core/fallbackHelper";

// In-memory array to track mock visits scheduled during local dev session,
// so that newly scheduled visits immediately show up in the UI timeline on refetch.
const mockScheduledVisitsStore: any[] = [];

export const patientsRouter = router({
  listByTrial: protectedProcedure
    .input(z.object({ trialId: z.string() }))
    .query(async (opts) => {
      const { input, ctx } = opts;
      try {
        const enrollments = await callBackend<any[]>(`/api/trial-patients`, {
          query: { trial_id: input.trialId },
          user: ctx.user,
        });
        return enrollments;
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn("[patientsRouter] Backend offline. Falling back to mock patient cohort.");
          return [
            {
              id: "mock-enroll-1",
              patient_id: "mock-p001",
              trial_id: input.trialId,
              status: "enrolled",
              enrollment_date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
              notes: "Patient is responding well to initial cycles. Mild fatigue reported.",
              patient_code: "SUBJ-081",
              patient_first_name: "Eleanor",
              patient_last_name: "Vance",
              patient_data: {
                email: "e.vance@example.com",
                phone_number: "+1 (555) 014-9821",
                date_of_birth: "1984-08-12",
                gender: "female",
                consent_signed: true,
                consent_date: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                screening_notes: "Subject meets all inclusion criteria. ECOG performance status 0.",
              }
            },
            {
              id: "mock-enroll-2",
              patient_id: "mock-p002",
              trial_id: input.trialId,
              status: "screening",
              enrollment_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
              notes: "Awaiting baseline ECG and coagulation panel results.",
              patient_code: "SUBJ-102",
              patient_first_name: "Gordon",
              patient_last_name: "Freeman",
              patient_data: {
                email: "gfreeman@blackmesa.org",
                phone_number: "+1 (555) 017-4581",
                date_of_birth: "1972-11-20",
                gender: "male",
                consent_signed: true,
                consent_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                screening_notes: "Prior chemotherapy completed > 6 months ago. Normal cardiac function.",
              }
            },
            {
              id: "mock-enroll-3",
              patient_id: "mock-p003",
              trial_id: input.trialId,
              status: "enrolled",
              enrollment_date: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
              notes: "Dose level 1 cohort. Compliance with daily diary is excellent.",
              patient_code: "SUBJ-094",
              patient_first_name: "Alyx",
              patient_last_name: "Vance",
              patient_data: {
                email: "alyx@example.com",
                phone_number: "+1 (555) 019-9043",
                date_of_birth: "2002-03-24",
                gender: "female",
                consent_signed: true,
                consent_date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                screening_notes: "Signed informed consent. Adequate hepatic and renal function.",
              }
            }
          ];
        }
        console.error("Error in listByTrial proxy:", err);
        return [];
      }
    }),

  generateCode: protectedProcedure
    .input(z.void())
    .query(async (opts) => {
      try {
        const res = await callBackend<{ patient_code: string }>(`/api/patients/generate-code`, {
          user: opts.ctx.user,
        });
        return res;
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn("[patientsRouter] Backend offline. Falling back to mock code generator.");
          return { patient_code: `SUBJ-${Math.floor(100 + Math.random() * 900)}` };
        }
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
    .mutation(async (opts) => {
      const { input, ctx } = opts;
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
        if (isConnectionError(err)) {
          console.warn("[patientsRouter] Backend offline. Falling back to mock patient enrollment.");
          return {
            id: `mock-enroll-${Math.floor(100 + Math.random() * 900)}`,
            patient_id: `mock-${input.patientCode.toLowerCase()}`,
            trial_id: input.trialId,
            status: "enrolled",
            enrollment_date: new Date().toISOString().split("T")[0],
            notes: input.notes || "",
            patient_code: input.patientCode,
            patient_first_name: input.firstName,
            patient_last_name: input.lastName,
            patient_data: {
              email: input.email || null,
              phone_number: input.phone || null,
              date_of_birth: input.dateOfBirth ? input.dateOfBirth.split("T")[0] : null,
              gender: input.gender || null,
              consent_signed: input.consentSigned,
              consent_date: input.consentDate ? input.consentDate.split("T")[0] : null,
              screening_notes: input.screeningNotes || null,
            }
          };
        }
        console.error("Error in enrollPatient proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to enroll patient in trial",
        });
      }
    }),

  listVisits: protectedProcedure
    .input(z.object({ patientId: z.string(), trialId: z.string() }))
    .query(async (opts) => {
      const { input, ctx } = opts;
      try {
        const visits = await callBackend<any[]>(`/api/patient-visits`, {
          query: { patient_id: input.patientId, trial_id: input.trialId },
          user: ctx.user,
        });
        return visits;
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn("[patientsRouter] Backend offline. Falling back to mock visits history.");
          
          const staticMockVisits = [
            {
              id: "mock-visit-1",
              patient_id: input.patientId,
              trial_id: input.trialId,
              doctor_id: 1,
              doctor_name: "Dr. Sarah Connor",
              visit_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
              visit_time: "09:00",
              visit_type: "screening",
              status: "completed",
              location: "Clinical Building A - Room 104",
              notes: "Subject checked in for screening. Informed consent signed, height/weight logged, and screening blood samples successfully drawn. Vital signs stable.",
            },
            {
              id: "mock-visit-2",
              patient_id: input.patientId,
              trial_id: input.trialId,
              doctor_id: 1,
              doctor_name: "Dr. Sarah Connor",
              visit_date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
              visit_time: "10:30",
              visit_type: "baseline",
              status: "completed",
              location: "Clinical Building A - Room 104",
              notes: "Baseline visit. Confirmed all inclusion and exclusion parameters. ECG completed and analyzed. Administered Cycle 1 Day 1 dose of study drug. No immediate adverse events observed during 2-hour monitoring window.",
            },
            {
              id: "mock-visit-3",
              patient_id: input.patientId,
              trial_id: input.trialId,
              doctor_id: 1,
              doctor_name: "Dr. Sarah Connor",
              visit_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
              visit_time: "11:00",
              visit_type: "follow_up",
              status: "scheduled",
              location: "Clinical Building A - Room 202",
              notes: "Cycle 2 checkup. Assess safety, perform blood chemistry panel, and distribute study drug kit #3.",
            }
          ];

          // Filter mock store for items created during active session that match this patient
          const sessionCreatedVisits = mockScheduledVisitsStore.filter(
            v => v.patient_id === input.patientId && v.trial_id === input.trialId
          );

          // Return static mock visits combined with session scheduled visits, sorted by date desc
          return [...sessionCreatedVisits, ...staticMockVisits].sort(
            (a, b) => new Date(b.visit_date).getTime() - new Date(a.visit_date).getTime()
          );
        }
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
    .mutation(async (opts) => {
      const { input, ctx } = opts;
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
        if (isConnectionError(err)) {
          console.warn("[patientsRouter] Backend offline. Creating session-level mock visit.");
          
          const mockVisit = {
            id: `mock-visit-${Math.floor(1000 + Math.random() * 9000)}`,
            patient_id: input.patientId,
            trial_id: input.trialId,
            doctor_id: 1,
            doctor_name: "Dr. Sarah Connor",
            visit_date: input.visitDate.split("T")[0],
            visit_time: input.visitTime || "09:00",
            visit_type: input.visitType,
            status: "scheduled",
            location: input.location || "Clinical Building A",
            notes: input.notes || "",
          };

          // Store in the transient in-memory array for query refetches
          mockScheduledVisitsStore.push(mockVisit);
          return mockVisit;
        }
        console.error("Error in createVisit proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to schedule patient visit",
        });
      }
    }),
});
