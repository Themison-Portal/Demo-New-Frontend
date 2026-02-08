import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  protocols,
  taskScaffolds,
  phases,
  tasks,
  taskDependencies,
  phaseTransitions,
  protocolSections,
  InsertProtocol,
  InsertTaskScaffold,
  InsertPhase,
  InsertTask,
  InsertTaskDependency,
  InsertPhaseTransition,
  InsertProtocolSection,
} from "../drizzle/schema";

/**
 * Protocol operations
 */
export async function createProtocol(data: InsertProtocol) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(protocols).values(data);
}

export async function getProtocolById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(protocols).where(eq(protocols.id, id)).limit(1);
  return result[0] || null;
}

export async function getProtocolsByTrialId(trialId: string) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(protocols).where(eq(protocols.trialId, trialId)).orderBy(desc(protocols.createdAt));
}

/**
 * Task Scaffold operations
 */
export async function createTaskScaffold(data: InsertTaskScaffold) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(taskScaffolds).values(data);
}

export async function getTaskScaffoldById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(taskScaffolds).where(eq(taskScaffolds.id, id)).limit(1);
  return result[0] || null;
}

export async function getTaskScaffoldByProtocolId(protocolId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(taskScaffolds).where(eq(taskScaffolds.protocolId, protocolId)).limit(1);
  return result[0] || null;
}

export async function updateTaskScaffoldStatus(id: number, status: "draft" | "confirmed" | "active", confirmedBy?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(taskScaffolds)
    .set({ 
      status, 
      confirmedAt: status === "confirmed" ? new Date() : undefined,
      confirmedBy: status === "confirmed" ? confirmedBy : undefined,
    })
    .where(eq(taskScaffolds.id, id));
}

export async function deleteTaskScaffold(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get all phases for this scaffold
  const scaffoldPhases = await db.select().from(phases).where(eq(phases.scaffoldId, id));
  
  // Delete all related data for each phase
  for (const phase of scaffoldPhases) {
    // Get all tasks for this phase
    const phaseTasks = await db.select().from(tasks).where(eq(tasks.phaseId, phase.id));
    
    // Delete task dependencies
    for (const task of phaseTasks) {
      await db.delete(taskDependencies).where(eq(taskDependencies.taskId, task.id));
      await db.delete(taskDependencies).where(eq(taskDependencies.dependsOnTaskId, task.id));
    }
    
    // Delete tasks
    await db.delete(tasks).where(eq(tasks.phaseId, phase.id));
    
    // Delete phase transitions
    await db.delete(phaseTransitions).where(eq(phaseTransitions.fromPhaseId, phase.id));
    await db.delete(phaseTransitions).where(eq(phaseTransitions.toPhaseId, phase.id));
  }
  
  // Delete phases
  await db.delete(phases).where(eq(phases.scaffoldId, id));
  
  // Delete protocol sections (they're linked to protocolId, not scaffoldId)
  // We'll get the protocolId from the scaffold
  const scaffold = await db.select().from(taskScaffolds).where(eq(taskScaffolds.id, id)).limit(1);
  if (scaffold[0]) {
    await db.delete(protocolSections).where(eq(protocolSections.protocolId, scaffold[0].protocolId));
  }
  
  // Finally, delete the scaffold itself
  await db.delete(taskScaffolds).where(eq(taskScaffolds.id, id));
}

/**
 * Phase operations
 */
export async function createPhase(data: InsertPhase) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(phases).values(data);
}

export async function getPhasesByScaffoldId(scaffoldId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(phases).where(eq(phases.scaffoldId, scaffoldId)).orderBy(phases.orderIndex);
}

/**
 * Task operations
 */
export async function createTask(data: InsertTask) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(tasks).values(data);
}

export async function getTasksByPhaseId(phaseId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(tasks).where(eq(tasks.phaseId, phaseId)).orderBy(tasks.orderIndex);
}

export async function getTaskById(taskId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return result[0] || null;
}

export async function updateTask(id: number, data: Partial<InsertTask>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(tasks).set(data).where(eq(tasks.id, id));
}

export async function deleteTask(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Delete dependencies first
  await db.delete(taskDependencies).where(eq(taskDependencies.taskId, id));
  await db.delete(taskDependencies).where(eq(taskDependencies.dependsOnTaskId, id));
  
  // Delete task
  await db.delete(tasks).where(eq(tasks.id, id));
}

/**
 * Task Dependency operations
 */
export async function createTaskDependency(data: InsertTaskDependency) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(taskDependencies).values(data);
}

export async function getTaskDependencies(taskId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId));
}

/**
 * Phase Transition operations
 */
export async function createPhaseTransition(data: InsertPhaseTransition) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(phaseTransitions).values(data);
}

export async function getPhaseTransitions(fromPhaseId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(phaseTransitions).where(eq(phaseTransitions.fromPhaseId, fromPhaseId));
}

/**
 * Protocol Section operations
 */
export async function createProtocolSection(data: InsertProtocolSection) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(protocolSections).values(data);
}

export async function getProtocolSections(protocolId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(protocolSections).where(eq(protocolSections.protocolId, protocolId)).orderBy(protocolSections.orderIndex);
}
