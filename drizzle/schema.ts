import { int, json, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Study Setup Wizard Tables

/**
 * Trials table - stores clinical trial information
 */
export const trials = mysqlTable("trials", {
  id: varchar("id", { length: 50 }).primaryKey(), // e.g., "abc-123", "def-456"
  title: varchar("title", { length: 500 }).notNull(), // e.g., "Diabetes Mellitus (SURPASS J-mono)"
  protocolNumber: varchar("protocolNumber", { length: 100 }), // e.g., "8F-JE-GPGQ(a)"
  description: text("description"), // Study description
  phase: mysqlEnum("phase", ["Phase I", "Phase II", "Phase III", "Phase IV"]),
  status: mysqlEnum("status", ["active", "recruiting", "on-hold", "completed", "terminated"]).default("active").notNull(),
  sponsor: varchar("sponsor", { length: 255 }), // e.g., "Novo Nordisk", "Roche"
  location: varchar("location", { length: 255 }), // e.g., "Copenhagen", "Multi-site"
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  principalInvestigator: varchar("principalInvestigator", { length: 255 }),
  enrolledPatients: int("enrolledPatients").default(0),
  targetPatients: int("targetPatients"),
  completionPercentage: int("completionPercentage").default(0),
  createdBy: int("createdBy").notNull(), // User ID
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Trial = typeof trials.$inferSelect;
export type InsertTrial = typeof trials.$inferInsert;

/**
 * Protocols table - stores uploaded protocol PDFs
 */
export const protocols = mysqlTable("protocols", {
  id: int("id").autoincrement().primaryKey(),
  trialId: varchar("trialId", { length: 50 }).notNull(), // Reference to trial
  filename: varchar("filename", { length: 255 }).notNull(),
  fileUrl: text("fileUrl").notNull(), // S3 URL
  fileKey: varchar("fileKey", { length: 512 }).notNull(), // S3 key
  fileSize: int("fileSize").notNull(), // File size in bytes
  category: varchar("category", { length: 100 }).notNull(), // Protocols, Amendments, etc.
  uploadedBy: int("uploadedBy").notNull(), // User ID
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Protocol = typeof protocols.$inferSelect;
export type InsertProtocol = typeof protocols.$inferInsert;

/**
 * Task scaffolds - AI-generated execution plans
 */
export const taskScaffolds = mysqlTable("taskScaffolds", {
  id: int("id").autoincrement().primaryKey(),
  protocolId: int("protocolId").notNull(),
  trialId: varchar("trialId", { length: 50 }).notNull(),
  status: mysqlEnum("status", ["draft", "confirmed", "active"]).default("draft").notNull(),
  confirmedAt: timestamp("confirmedAt"),
  confirmedBy: int("confirmedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TaskScaffold = typeof taskScaffolds.$inferSelect;
export type InsertTaskScaffold = typeof taskScaffolds.$inferInsert;

/**
 * Phases - groups of tasks (Screening, Visit 1, etc.)
 */
export const phases = mysqlTable("phases", {
  id: int("id").autoincrement().primaryKey(),
  scaffoldId: int("scaffoldId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(), // Hex color
  orderIndex: int("orderIndex").notNull(), // For ordering phases
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Phase = typeof phases.$inferSelect;
export type InsertPhase = typeof phases.$inferInsert;

/**
 * Tasks - individual action items within phases
 */
export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  phaseId: int("phaseId").notNull(),
  name: varchar("name", { length: 500 }).notNull(),
  suggestedAssigneeId: int("suggestedAssigneeId"),
  suggestedDate: timestamp("suggestedDate"),
  duration: int("duration"), // Duration in days
  protocolSection: varchar("protocolSection", { length: 255 }),
  protocolPage: int("protocolPage"),
  status: mysqlEnum("status", ["pending", "completed", "blocked"]).default("pending").notNull(),
  orderIndex: int("orderIndex").notNull(), // For ordering tasks within phase
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

/**
 * Task dependencies - relationships between tasks
 */
export const taskDependencies = mysqlTable("taskDependencies", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(), // The dependent task
  dependsOnTaskId: int("dependsOnTaskId").notNull(), // The task it depends on
  type: mysqlEnum("type", ["after", "before", "concurrent"]).default("after").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskDependency = typeof taskDependencies.$inferSelect;
export type InsertTaskDependency = typeof taskDependencies.$inferInsert;

/**
 * Phase transitions - workflow paths between phases
 */
export const phaseTransitions = mysqlTable("phaseTransitions", {
  id: int("id").autoincrement().primaryKey(),
  fromPhaseId: int("fromPhaseId").notNull(),
  toPhaseId: int("toPhaseId").notNull(),
  condition: varchar("condition", { length: 255 }), // e.g., "Passed", "Screen Fail"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PhaseTransition = typeof phaseTransitions.$inferSelect;
export type InsertPhaseTransition = typeof phaseTransitions.$inferInsert;

/**
 * Protocol sections - for the Protocol Map sidebar
 */
export const protocolSections = mysqlTable("protocolSections", {
  id: int("id").autoincrement().primaryKey(),
  protocolId: int("protocolId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  pageReference: varchar("pageReference", { length: 50 }), // e.g., "p. 63-72"
  dateReference: varchar("dateReference", { length: 50 }), // e.g., "Mar 28"
  orderIndex: int("orderIndex").notNull(),
  parentSectionId: int("parentSectionId"), // For nested sections
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProtocolSection = typeof protocolSections.$inferSelect;
export type InsertProtocolSection = typeof protocolSections.$inferInsert;

/**
 * Vector Stores - tracks OpenAI Vector Stores (one per trial)
 * Each store is a managed vector database in OpenAI's cloud for RAG
 */
export const fileSearchStores = mysqlTable("fileSearchStores", {
  id: int("id").autoincrement().primaryKey(),
  trialId: varchar("trialId", { length: 50 }).notNull().unique(), // One store per trial
  storeName: varchar("storeName", { length: 255 }).notNull().unique(), // OpenAI Vector Store ID (e.g., 'vs_abc123')
  displayName: varchar("displayName", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FileSearchStore = typeof fileSearchStores.$inferSelect;
export type InsertFileSearchStore = typeof fileSearchStores.$inferInsert;

/**
 * Vector Store Documents - tracks documents uploaded to OpenAI Vector Stores
 */
export const fileSearchDocuments = mysqlTable("fileSearchDocuments", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull(), // Reference to fileSearchStores
  protocolId: int("protocolId").notNull(), // Reference to protocols table
  documentName: varchar("documentName", { length: 255 }).notNull(), // OpenAI File ID (e.g., 'file_abc123')
  displayName: varchar("displayName", { length: 255 }).notNull(),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
});

export type FileSearchDocument = typeof fileSearchDocuments.$inferSelect;
export type InsertFileSearchDocument = typeof fileSearchDocuments.$inferInsert;

/**
 * Document categories - predefined and custom categories for document uploads
 */
export const documentCategories = mysqlTable("documentCategories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  isDefault: boolean("isDefault").default(false).notNull(), // Predefined categories
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DocumentCategory = typeof documentCategories.$inferSelect;
export type InsertDocumentCategory = typeof documentCategories.$inferInsert;
