import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import * as db from "./studySetupWizard";
import { extractPdfText } from "./pdfExtractor";

/**
 * Study Setup Wizard Router
 * Handles protocol analysis and task scaffold generation
 */
export const studySetupWizardRouter = router({
  /**
   * Generate task scaffold from protocol
   * This is the AI-powered "Generate Execution Plan" button
   */
  generateScaffold: protectedProcedure
    .input(z.object({
      protocolId: z.number(),
      trialId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { protocolId, trialId } = input;
      
      // Get protocol details
      const protocol = await db.getProtocolById(protocolId);
      if (!protocol) {
        throw new Error("Protocol not found");
      }

      // Check if scaffold already exists - if so, delete it and regenerate
      const existingScaffold = await db.getTaskScaffoldByProtocolId(protocolId);
      if (existingScaffold) {
        console.log(`Deleting existing scaffold ${existingScaffold.id} for protocol ${protocolId}`);
        await db.deleteTaskScaffold(existingScaffold.id);
      }

      // Use AI to analyze protocol and generate task scaffold
      const systemPrompt = `You are an expert clinical trial coordinator. Analyze the protocol document and generate a comprehensive task scaffold for executing the clinical trial.

Your response MUST be valid JSON matching this structure:
{
  "protocolSections": [
    {
      "name": "Schedule of activities",
      "dateReference": "Mar 28",
      "pageReference": null,
      "children": [
        { "name": "Screening", "dateReference": "Mar 28", "pageReference": null },
        { "name": "Baseline / Visit 1", "pageReference": "P.2" }
      ]
    },
    {
      "name": "Inclusion / Exclusion",
      "dateReference": "Apr 25",
      "pageReference": null
    }
  ],
  "phases": [
    {
      "name": "Screening",
      "color": "#3B82F6",
      "tasks": [
        {
          "name": "Screen potential participants",
          "suggestedDate": "2026-03-05",
          "duration": 3,
          "protocolSection": "Schedule of activities",
          "protocolPage": 12,
          "dependencies": []
        },
        {
          "name": "Prep Screening tools & kits",
          "suggestedDate": "2026-03-08",
          "duration": 2,
          "dependencies": []
        }
      ],
      "transitions": [
        { "toPhase": "Visit 1 - Baseline", "condition": "Passed" },
        { "toPhase": "Screen Fail", "condition": "Failed" }
      ]
    }
  ]
}

Generate realistic tasks based on typical clinical trial workflows. Include:
- Protocol sections for the sidebar (Schedule of activities, Inclusion/Exclusion, Procedures, Lab & Samples, Adverse Events, Concomitant Medications, Randomization & Dosing)
- Phases (Screening, Visit 1, Visit 2, etc.) with appropriate colors
- Tasks with suggested dates, durations, and dependencies
- Phase transitions showing workflow paths`;

      // Extract text from the PDF
      let protocolContent = '';
      try {
        protocolContent = await extractPdfText(protocol.fileUrl);
        console.log(`Extracted ${protocolContent.length} characters from PDF`);
      } catch (error) {
        console.error('Failed to extract PDF text:', error);
        throw new Error('Failed to read protocol document. Please ensure the file is a valid PDF.');
      }

      // Truncate if too long (keep first 50000 characters to stay within token limits)
      const maxLength = 50000;
      if (protocolContent.length > maxLength) {
        protocolContent = protocolContent.substring(0, maxLength) + '\n\n[Content truncated due to length...]';
      }

      const userPrompt = `Protocol Document: ${protocol.filename}

Protocol Content:
${protocolContent}

Based on the protocol content above, generate a complete task scaffold for this clinical trial. Include all necessary phases, tasks, and dependencies.`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "task_scaffold",
            strict: true,
            schema: {
              type: "object",
              properties: {
                protocolSections: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      dateReference: { type: ["string", "null"] },
                      pageReference: { type: ["string", "null"] },
                      children: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            dateReference: { type: ["string", "null"] },
                            pageReference: { type: ["string", "null"] },
                          },
                          required: ["name"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["name"],
                    additionalProperties: false,
                  },
                },
                phases: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      color: { type: "string" },
                      tasks: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            suggestedDate: { type: ["string", "null"] },
                            duration: { type: ["number", "null"] },
                            protocolSection: { type: ["string", "null"] },
                            protocolPage: { type: ["number", "null"] },
                            dependencies: {
                              type: "array",
                              items: { type: "string" },
                            },
                          },
                          required: ["name", "dependencies"],
                          additionalProperties: false,
                        },
                      },
                      transitions: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            toPhase: { type: "string" },
                            condition: { type: ["string", "null"] },
                          },
                          required: ["toPhase"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["name", "color", "tasks"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["protocolSections", "phases"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new Error("Failed to generate task scaffold");
      }

      const scaffoldData = JSON.parse(content);

      // Create task scaffold
      await db.createTaskScaffold({
        protocolId,
        trialId,
        status: "draft",
      });

      const scaffold = await db.getTaskScaffoldByProtocolId(protocolId);
      if (!scaffold) {
        throw new Error("Failed to create task scaffold");
      }

      // Create protocol sections
      for (let i = 0; i < scaffoldData.protocolSections.length; i++) {
        const section = scaffoldData.protocolSections[i];
        await db.createProtocolSection({
          protocolId,
          name: section.name,
          dateReference: section.dateReference || null,
          pageReference: section.pageReference || null,
          orderIndex: i,
          parentSectionId: null,
        });

        // Create child sections if any
        if (section.children) {
          for (let j = 0; j < section.children.length; j++) {
            const child = section.children[j];
            await db.createProtocolSection({
              protocolId,
              name: child.name,
              dateReference: child.dateReference || null,
              pageReference: child.pageReference || null,
              orderIndex: j,
              parentSectionId: null, // We'll need to get the parent ID properly
            });
          }
        }
      }

      // Create phases and tasks
      const phaseMap = new Map<string, number>();
      
      for (let i = 0; i < scaffoldData.phases.length; i++) {
        const phase = scaffoldData.phases[i];
        
        await db.createPhase({
          scaffoldId: scaffold.id,
          name: phase.name,
          color: phase.color,
          orderIndex: i,
        });

        const phases = await db.getPhasesByScaffoldId(scaffold.id);
        const createdPhase = phases.find(p => p.name === phase.name);
        if (createdPhase) {
          phaseMap.set(phase.name, createdPhase.id);
        }

        // Create tasks for this phase
        if (createdPhase) {
          for (let j = 0; j < phase.tasks.length; j++) {
            const task = phase.tasks[j];
            await db.createTask({
              phaseId: createdPhase.id,
              name: task.name,
              suggestedDate: task.suggestedDate ? new Date(task.suggestedDate) : null,
              duration: task.duration || null,
              protocolSection: task.protocolSection || null,
              protocolPage: task.protocolPage || null,
              status: "pending",
              orderIndex: j,
            });
          }
        }
      }

      // Create phase transitions
      for (const phase of scaffoldData.phases) {
        const fromPhaseId = phaseMap.get(phase.name);
        if (fromPhaseId && phase.transitions) {
          for (const transition of phase.transitions) {
            const toPhaseId = phaseMap.get(transition.toPhase);
            if (toPhaseId) {
              await db.createPhaseTransition({
                fromPhaseId,
                toPhaseId,
                condition: transition.condition || null,
              });
            }
          }
        }
      }

      return {
        success: true,
        scaffoldId: scaffold.id,
      };
    }),

  /**
   * Get task scaffold with all related data
   */
  getScaffold: protectedProcedure
    .input(z.object({
      protocolId: z.number(),
    }))
    .query(async ({ input }) => {
      const scaffold = await db.getTaskScaffoldByProtocolId(input.protocolId);
      if (!scaffold) {
        return null;
      }

      const phases = await db.getPhasesByScaffoldId(scaffold.id);
      const phasesWithTasks = await Promise.all(
        phases.map(async (phase) => {
          const tasks = await db.getTasksByPhaseId(phase.id);
          const tasksWithDeps = await Promise.all(
            tasks.map(async (task) => {
              const dependencies = await db.getTaskDependencies(task.id);
              return { ...task, dependencies };
            })
          );
          const transitions = await db.getPhaseTransitions(phase.id);
          return { ...phase, tasks: tasksWithDeps, transitions };
        })
      );

      const protocol = await db.getProtocolById(input.protocolId);
      const sections = await db.getProtocolSections(input.protocolId);

      return {
        scaffold,
        phases: phasesWithTasks,
        protocol,
        sections,
      };
    }),

  /**
   * Confirm and launch scaffold
   */
  confirmScaffold: protectedProcedure
    .input(z.object({
      scaffoldId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.updateTaskScaffoldStatus(input.scaffoldId, "confirmed", ctx.user.id);
      return { success: true };
    }),

  /**
   * Update task
   */
  updateTask: protectedProcedure
    .input(z.object({
      taskId: z.number(),
      name: z.string().optional(),
      suggestedDate: z.string().optional(),
      duration: z.number().optional(),
      status: z.enum(["pending", "completed", "blocked"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { taskId, ...updates } = input;
      await db.updateTask(taskId, {
        ...updates,
        suggestedDate: updates.suggestedDate ? new Date(updates.suggestedDate) : undefined,
      });
      return { success: true };
    }),

  /**
   * Delete task
   */
  deleteTask: protectedProcedure
    .input(z.object({
      taskId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.deleteTask(input.taskId);
      return { success: true };
    }),
});
