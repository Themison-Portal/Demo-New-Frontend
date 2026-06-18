import {
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  float,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

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
  investigationalProduct: varchar("investigationalProduct", { length: 255 }),
  indication: varchar("indication", { length: 255 }),
  nctNumber: varchar("nctNumber", { length: 50 }),
  currentVersion: varchar("currentVersion", { length: 50 }),
  amendmentVersion: varchar("amendmentVersion", { length: 50 }),
  releaseDate: varchar("releaseDate", { length: 50 }),
  sampleSize: varchar("sampleSize", { length: 50 }),
  numberOfSites: varchar("numberOfSites", { length: 50 }),
  studyDuration: varchar("studyDuration", { length: 100 }),
  studyDesignType: varchar("studyDesignType", { length: 255 }),
  primaryObjective: text("primaryObjective"),
  primaryEndpoint: text("primaryEndpoint"),
  description: text("description"), // Study description
  phase: varchar("phase", { length: 50 }),
  status: mysqlEnum("status", ["not-started", "active", "recruiting", "on-hold", "completed", "terminated"]).default("not-started").notNull(),
  sponsor: varchar("sponsor", { length: 255 }), // e.g., "Novo Nordisk", "Roche"
  location: varchar("location", { length: 255 }), // e.g., "Copenhagen", "Multi-site"
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  principalInvestigator: varchar("principalInvestigator", { length: 255 }),
  enrolledPatients: int("enrolledPatients").default(0),
  targetPatients: int("targetPatients"),
  completionPercentage: int("completionPercentage").default(0),
  createdBy: int("createdBy").notNull(), // User ID
  // UUID of the matching row in core-backend's `trials` table. Required
  // for core-backend's JWT-protected upload endpoint, which needs a
  // valid `trial_id` from its own DB. Nullable while the mapping is
  // being populated; uploads fall back to the local pipeline when this
  // is unset.
  coreBackendTrialId: varchar("coreBackendTrialId", { length: 36 }),
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
  documentVersion: varchar("documentVersion", { length: 50 }),
  amendmentVersion: varchar("amendmentVersion", { length: 50 }),
  releaseDate: varchar("releaseDate", { length: 50 }),
  isCurrent: boolean("isCurrent").default(false).notNull(),
  archivedAt: timestamp("archivedAt"),
  sourceType: varchar("sourceType", { length: 32 }).default("manual").notNull(), // manual | integration | system
  sourceReference: varchar("sourceReference", { length: 255 }),
  uploadedBy: int("uploadedBy").notNull(), // User ID
  // Linkage to core-backend's `trial_documents` row. Populated when an
  // upload is proxied through core-backend (Phase 3 of the integration).
  // Null on legacy rows / when the local-only pipeline is still in use.
  coreBackendDocumentId: varchar("coreBackendDocumentId", { length: 36 }),
  // Linkage to core-backend's `upload_jobs` row. Drives polling-based
  // status updates (Phase 5).
  coreBackendJobId: varchar("coreBackendJobId", { length: 36 }),
  // Last-known core-backend ingestion state: queued | processing | ready | failed.
  // Surfaced as the doc's status badge in the FE.
  coreBackendIngestStatus: varchar("coreBackendIngestStatus", { length: 32 }),
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
  // Holds the BE `trial_documents` UUID (the FE `protocols` table is retired).
  protocolId: varchar("protocolId", { length: 36 }).notNull(),
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
  // Holds the BE `trial_documents` UUID (the FE `protocols` table is retired).
  protocolId: varchar("protocolId", { length: 36 }).notNull(),
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
 * ============================================================
 * Map Foundation (single execution graph rendered by all views)
 * ============================================================
 */

export const mapStatusEnum = mysqlEnum("map_status", ["draft", "active", "revised", "archived"]);
export const phaseTypeEnum = mysqlEnum("phase_type", [
  "screening",
  "baseline",
  "treatment_visit",
  "follow_up",
  "end_of_study",
  "unscheduled",
  "screen_fail",
  "early_termination",
  "custom",
]);
export const taskCategoryEnum = mysqlEnum("task_category", [
  "consent",
  "eligibility",
  "lab_sample",
  "vital_signs",
  "imaging",
  "drug_administration",
  "assessment",
  "questionnaire",
  "data_entry",
  "coordination",
  "documentation",
  "follow_up",
  "safety_reporting",
  "regulatory",
  "custom",
]);
export const taskPriorityEnum = mysqlEnum("task_priority", ["critical", "high", "medium", "low"]);
const taskStatusValues = [
  "suggested",
  "confirmed",
  "todo",
  "in_progress",
  "blocked",
  "waiting",
  "done",
  "skipped",
  "cancelled",
] as const;
export const taskStatusEnum = mysqlEnum("task_status", taskStatusValues);
export const taskRoleEnum = mysqlEnum("task_role", [
  "pi",
  "sub_i",
  "crc",
  "nurse",
  "pharmacist",
  "lab_tech",
  "data_manager",
  "regulatory_coordinator",
  "study_coordinator",
  "custom",
]);
export const dependencyTypeEnum = mysqlEnum("dependency_type", [
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "concurrent",
  "blocked_by",
]);
export const protocolMapSectionTypeEnum = mysqlEnum("protocol_map_section_type", [
  "schedule",
  "eligibility",
  "procedure",
  "safety",
  "medication",
  "randomization",
  "lab",
  "custom",
]);

/**
 * execution_maps: top-level execution plan container per trial.
 */
export const executionMaps = mysqlTable(
  "execution_maps",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    trialId: varchar("trialId", { length: 50 }).notNull(),
    // Holds the BE `trial_documents` UUID (the FE `protocols` table is retired).
  protocolId: varchar("protocolId", { length: 36 }).notNull(),
    status: mapStatusEnum.default("draft").notNull(),
    version: int("version").default(1).notNull(),
    metadata: json("metadata").notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    launchedAt: timestamp("launchedAt"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    trialIdx: index("idx_maps_trial").on(table.trialId),
    statusIdx: index("idx_maps_status").on(table.status),
  })
);

/**
 * phases: grouped trial workflow units.
 */
export const mapPhases = mysqlTable(
  "map_phases",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    mapId: varchar("mapId", { length: 36 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    phaseType: phaseTypeEnum.default("custom").notNull(),
    displayOrder: int("displayOrder").notNull(),
    color: varchar("color", { length: 7 }).default("#3B82F6").notNull(),
    estimatedDate: timestamp("estimatedDate"),
    windowStart: timestamp("windowStart"),
    windowEnd: timestamp("windowEnd"),
    protocolRef: json("protocolRef"),
    canvasX: float("canvasX"),
    canvasY: float("canvasY"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    mapOrderIdx: index("idx_map_phases_map_order").on(table.mapId, table.displayOrder),
  })
);

/**
 * phase transitions: patient journey edges between phases.
 */
export const mapPhaseTransitions = mysqlTable(
  "map_phase_transitions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    fromPhaseId: varchar("fromPhaseId", { length: 36 }).notNull(),
    toPhaseId: varchar("toPhaseId", { length: 36 }).notNull(),
    conditionLabel: varchar("conditionLabel", { length: 255 }),
    isDefault: boolean("isDefault").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    uniqueEdge: uniqueIndex("idx_map_transitions_unique").on(table.fromPhaseId, table.toPhaseId),
    fromIdx: index("idx_map_transitions_from").on(table.fromPhaseId),
    toIdx: index("idx_map_transitions_to").on(table.toPhaseId),
  })
);

/**
 * map tasks: sticky notes of execution.
 */
export const mapTasks = mysqlTable(
  "map_tasks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    phaseId: varchar("phaseId", { length: 36 }).notNull(),
    mapId: varchar("mapId", { length: 36 }).notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    description: text("description"),
    category: taskCategoryEnum.default("custom").notNull(),
    priority: taskPriorityEnum.default("medium").notNull(),
    status: taskStatusEnum.default("suggested").notNull(),
    blockedReason: text("blockedReason"),
    blockedSince: timestamp("blockedSince"),
    assignedRole: taskRoleEnum,
    assignedUserId: int("assignedUserId"),
    suggestedAssignee: varchar("suggestedAssignee", { length: 255 }),
    suggestedDate: timestamp("suggestedDate"),
    dueDate: timestamp("dueDate"),
    estimatedDuration: int("estimatedDuration"),
    startDate: timestamp("startDate"),
    completedDate: timestamp("completedDate"),
    orderInPhase: int("orderInPhase").default(0).notNull(),
    canvasX: float("canvasX"),
    canvasY: float("canvasY"),
    createdBy: mysqlEnum("map_task_created_by", ["ai", "user"]).default("ai").notNull(),
    aiConfidence: float("aiConfidence"),
    conditionalNote: text("conditionalNote"),
    isCustom: boolean("isCustom").default(false).notNull(),
    tags: json("tags").notNull(),
    protocolRefs: json("protocolRefs").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    phaseOrderIdx: index("idx_map_tasks_phase_order").on(table.phaseId, table.orderInPhase),
    dateIdx: index("idx_map_tasks_dates").on(table.mapId, table.dueDate, table.suggestedDate),
    statusIdx: index("idx_map_tasks_status").on(table.mapId, table.status),
    assigneeIdx: index("idx_map_tasks_assignee").on(table.assignedUserId, table.status),
    mapIdx: index("idx_map_tasks_map").on(table.mapId),
  })
);

/**
 * task dependency graph edges.
 */
export const mapTaskDependencies = mysqlTable(
  "map_task_dependencies",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sourceTaskId: varchar("sourceTaskId", { length: 36 }).notNull(),
    targetTaskId: varchar("targetTaskId", { length: 36 }).notNull(),
    dependencyType: dependencyTypeEnum.default("finish_to_start").notNull(),
    conditionLabel: varchar("conditionLabel", { length: 255 }),
    isCrossPhase: boolean("isCrossPhase").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    uniqueDep: uniqueIndex("idx_map_dependencies_unique").on(table.sourceTaskId, table.targetTaskId),
    sourceIdx: index("idx_map_dependencies_source").on(table.sourceTaskId),
    targetIdx: index("idx_map_dependencies_target").on(table.targetTaskId),
  })
);

/**
 * left-side protocol map sections with task/phase links.
 */
export const protocolMapSections = mysqlTable(
  "protocol_map_sections",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    // Holds the BE `trial_documents` UUID (the FE `protocols` table is retired).
  protocolId: varchar("protocolId", { length: 36 }).notNull(),
    mapId: varchar("mapId", { length: 36 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    sectionType: protocolMapSectionTypeEnum.default("custom").notNull(),
    pageStart: int("pageStart"),
    pageEnd: int("pageEnd"),
    dateReference: timestamp("dateReference"),
    parentSectionId: varchar("parentSectionId", { length: 36 }),
    linkedPhaseIds: json("linkedPhaseIds").notNull(),
    linkedTaskIds: json("linkedTaskIds").notNull(),
    displayOrder: int("displayOrder").default(0).notNull(),
    isChecked: boolean("isChecked").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    mapOrderIdx: index("idx_map_protocol_sections_map_order").on(table.mapId, table.displayOrder),
    parentIdx: index("idx_map_protocol_sections_parent").on(table.parentSectionId),
  })
);

/**
 * high-resolution map telemetry events (data moat for map interactions).
 */
export const mapTelemetryEvents = mysqlTable(
  "map_telemetry_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    mapId: varchar("mapId", { length: 36 }).notNull(),
    trialId: varchar("trialId", { length: 50 }).notNull(),
    eventType: varchar("eventType", { length: 100 }).notNull(),
    userId: int("userId"),
    targetId: varchar("targetId", { length: 36 }),
    targetType: varchar("targetType", { length: 32 }),
    payload: json("payload").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    mapTsIdx: index("idx_map_telemetry_map_ts").on(table.mapId, table.createdAt),
    typeTsIdx: index("idx_map_telemetry_type_ts").on(table.eventType, table.createdAt),
    trialTsIdx: index("idx_map_telemetry_trial_ts").on(table.trialId, table.createdAt),
  })
);

/**
 * durable task status ledger (entered/exited windows per status).
 */
export const mapTaskStatusHistory = mysqlTable(
  "map_task_status_history",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    mapId: varchar("mapId", { length: 36 }).notNull(),
    trialId: varchar("trialId", { length: 50 }).notNull(),
    taskId: varchar("taskId", { length: 36 }).notNull(),
    fromStatus: mysqlEnum("fromStatus", taskStatusValues),
    toStatus: mysqlEnum("toStatus", taskStatusValues).notNull(),
    reason: text("reason"),
    source: varchar("source", { length: 32 }).default("status_change").notNull(),
    changedBy: int("changedBy"),
    enteredAt: timestamp("enteredAt").defaultNow().notNull(),
    exitedAt: timestamp("exitedAt"),
    durationSeconds: int("durationSeconds"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    mapTaskEnteredIdx: index("idx_task_status_history_map_task_entered").on(table.mapId, table.taskId, table.enteredAt),
    trialEnteredIdx: index("idx_task_status_history_trial_entered").on(table.trialId, table.enteredAt),
    taskOpenIdx: index("idx_task_status_history_task_open").on(table.taskId, table.exitedAt),
  })
);

export type ExecutionMap = typeof executionMaps.$inferSelect;
export type InsertExecutionMap = typeof executionMaps.$inferInsert;

export type MapPhase = typeof mapPhases.$inferSelect;
export type InsertMapPhase = typeof mapPhases.$inferInsert;

export type MapPhaseTransition = typeof mapPhaseTransitions.$inferSelect;
export type InsertMapPhaseTransition = typeof mapPhaseTransitions.$inferInsert;

export type MapTask = typeof mapTasks.$inferSelect;
export type InsertMapTask = typeof mapTasks.$inferInsert;

export type MapTaskDependency = typeof mapTaskDependencies.$inferSelect;
export type InsertMapTaskDependency = typeof mapTaskDependencies.$inferInsert;

export type ProtocolMapSection = typeof protocolMapSections.$inferSelect;
export type InsertProtocolMapSection = typeof protocolMapSections.$inferInsert;

export type MapTelemetryEvent = typeof mapTelemetryEvents.$inferSelect;
export type InsertMapTelemetryEvent = typeof mapTelemetryEvents.$inferInsert;

export type MapTaskStatusHistory = typeof mapTaskStatusHistory.$inferSelect;
export type InsertMapTaskStatusHistory = typeof mapTaskStatusHistory.$inferInsert;

/**
 * Protocol chunks - section-aware chunks for local context retrieval and citation grounding.
 */
export const protocolChunks = mysqlTable("protocolChunks", {
  id: int("id").autoincrement().primaryKey(),
  // Holds the BE `trial_documents` UUID (the FE `protocols` table is retired).
  protocolId: varchar("protocolId", { length: 36 }).notNull(),
  trialId: varchar("trialId", { length: 50 }).notNull(),
  chunkIndex: int("chunkIndex").notNull(),
  sectionType: varchar("sectionType", { length: 64 }).notNull(), // synopsis, visit, criteria, safety, etc.
  sectionTitle: varchar("sectionTitle", { length: 255 }),
  pageStart: int("pageStart"),
  pageEnd: int("pageEnd"),
  tokenEstimate: int("tokenEstimate"),
  contentHash: varchar("contentHash", { length: 64 }).notNull(),
  chunkText: text("chunkText").notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProtocolChunk = typeof protocolChunks.$inferSelect;
export type InsertProtocolChunk = typeof protocolChunks.$inferInsert;

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
  protocolId: varchar("protocolId", { length: 36 }).notNull(), // BE document UUID (protocols table retired)
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

/**
 * Telemetry events - user actions and AI interactions
 */
export const telemetryEvents = mysqlTable("telemetry_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  eventType: varchar("eventType", { length: 100 }).notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  userId: varchar("userId", { length: 64 }),
  sessionId: varchar("sessionId", { length: 128 }).notNull(),
  entityType: varchar("entityType", { length: 64 }),
  entityId: varchar("entityId", { length: 128 }),
  action: varchar("action", { length: 64 }).notNull(),
  payload: json("payload"),
  durationMs: int("durationMs"),
  aiInvolved: boolean("aiInvolved").default(false).notNull(),
  aiOutput: text("aiOutput"),
  aiSources: json("aiSources"),
  userCorrection: text("userCorrection"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TelemetryEvent = typeof telemetryEvents.$inferSelect;
export type InsertTelemetryEvent = typeof telemetryEvents.$inferInsert;

/**
 * AI feature snapshots - model-ready trial features captured over time.
 * Foundation for offline training and longitudinal analytics.
 */
export const aiFeatureSnapshots = mysqlTable("ai_feature_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  trialId: varchar("trialId", { length: 50 }).notNull(),
  snapshotDate: varchar("snapshotDate", { length: 10 }).notNull(), // YYYY-MM-DD
  snapshotVersion: varchar("snapshotVersion", { length: 32 }).default("v1").notNull(),
  featureVector: json("featureVector").notNull(),
  readinessScore: int("readinessScore").default(0).notNull(),
  riskScore: int("riskScore").default(0).notNull(),
  aiCoverageScore: int("aiCoverageScore").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiFeatureSnapshot = typeof aiFeatureSnapshots.$inferSelect;
export type InsertAiFeatureSnapshot = typeof aiFeatureSnapshots.$inferInsert;

/**
 * AI analytics rollups - day-level operational rollups for cross-trial insights.
 */
export const aiAnalyticsRollups = mysqlTable("ai_analytics_rollups", {
  id: int("id").autoincrement().primaryKey(),
  trialId: varchar("trialId", { length: 50 }).notNull(),
  rollupDate: varchar("rollupDate", { length: 10 }).notNull(), // YYYY-MM-DD
  documentTotal: int("documentTotal").default(0).notNull(),
  documentIndexed: int("documentIndexed").default(0).notNull(),
  taskTotal: int("taskTotal").default(0).notNull(),
  taskPending: int("taskPending").default(0).notNull(),
  taskBlocked: int("taskBlocked").default(0).notNull(),
  taskCompleted: int("taskCompleted").default(0).notNull(),
  telemetryEvents7d: int("telemetryEvents7d").default(0).notNull(),
  aiInvolvedEvents7d: int("aiInvolvedEvents7d").default(0).notNull(),
  aiUsageRateBps: int("aiUsageRateBps").default(0).notNull(), // 0..10000
  riskScore: int("riskScore").default(0).notNull(), // 0..100
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiAnalyticsRollup = typeof aiAnalyticsRollups.$inferSelect;
export type InsertAiAnalyticsRollup = typeof aiAnalyticsRollups.$inferInsert;

/**
 * AI training examples - captures supervised signals from user behavior and corrections.
 */
export const aiTrainingExamples = mysqlTable("ai_training_examples", {
  id: int("id").autoincrement().primaryKey(),
  sourceEventId: varchar("sourceEventId", { length: 36 }),
  trialId: varchar("trialId", { length: 50 }),
  userId: varchar("userId", { length: 64 }),
  prompt: text("prompt"),
  response: text("response"),
  label: varchar("label", { length: 32 }).default("unknown").notNull(), // accepted|rejected|edited|unknown
  correction: text("correction"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiTrainingExample = typeof aiTrainingExamples.$inferSelect;
export type InsertAiTrainingExample = typeof aiTrainingExamples.$inferInsert;

/**
 * Knowledge graph nodes - persisted entities for graph queries.
 */
export const knowledgeGraphNodes = mysqlTable("knowledge_graph_nodes", {
  id: int("id").autoincrement().primaryKey(),
  trialId: varchar("trialId", { length: 50 }).notNull(),
  nodeType: varchar("nodeType", { length: 64 }).notNull(),
  nodeKey: varchar("nodeKey", { length: 191 }).notNull(),
  displayName: varchar("displayName", { length: 255 }),
  properties: json("properties"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KnowledgeGraphNode = typeof knowledgeGraphNodes.$inferSelect;
export type InsertKnowledgeGraphNode = typeof knowledgeGraphNodes.$inferInsert;

/**
 * Knowledge graph edges - persisted relationships between entities.
 */
export const knowledgeGraphEdges = mysqlTable("knowledge_graph_edges", {
  id: int("id").autoincrement().primaryKey(),
  trialId: varchar("trialId", { length: 50 }).notNull(),
  edgeType: varchar("edgeType", { length: 64 }).notNull(),
  fromNodeKey: varchar("fromNodeKey", { length: 191 }).notNull(),
  toNodeKey: varchar("toNodeKey", { length: 191 }).notNull(),
  properties: json("properties"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type KnowledgeGraphEdge = typeof knowledgeGraphEdges.$inferSelect;
export type InsertKnowledgeGraphEdge = typeof knowledgeGraphEdges.$inferInsert;

/**
 * ============================================================
 * Collaboration Hub (Messages, Threads, Inbox)
 * ============================================================
 */

export const collabConversationTypeEnum = mysqlEnum("collab_conversation_type", ["direct", "group"]);
export const collabSenderTypeEnum = mysqlEnum("collab_sender_type", [
  "user",
  "ai",
  "system",
  "email_external",
]);
export const collabMessageContentTypeEnum = mysqlEnum("collab_message_content_type", [
  "text",
  "protocol_snippet",
  "task_card",
  "ai_response",
  "email",
]);
export const collabThreadCategoryEnum = mysqlEnum("collab_thread_category", [
  "question",
  "decision",
  "issue",
  "action_required",
  "approval",
  "clarification",
]);
export const collabThreadStatusEnum = mysqlEnum("collab_thread_status", [
  "open",
  "pending",
  "resolved",
  "closed",
]);
export const collabThreadAnchorTypeEnum = mysqlEnum("collab_thread_anchor_type", [
  "document_section",
  "task",
  "visit",
  "trial_wide",
  "therapeutic_area",
  "team_member",
]);
export const collabEmailFolderEnum = mysqlEnum("collab_email_folder", [
  "inbox",
  "sent",
  "drafts",
  "archived",
]);
export const collabEmailPriorityEnum = mysqlEnum("collab_email_priority", ["high", "medium", "low"]);
export const collabCrossRefSourceEntityTypeEnum = mysqlEnum("collab_cross_ref_source_entity_type", [
  "message",
  "thread",
  "email_chain",
  "task",
]);
export const collabCrossRefTargetEntityTypeEnum = mysqlEnum("collab_cross_ref_target_entity_type", [
  "message",
  "thread",
  "email_chain",
  "task",
]);
export const collabCrossRefTypeEnum = mysqlEnum("collab_cross_ref_type", [
  "manual",
  "ai_suggested",
  "spawned_from",
]);
export const collabLayerEnum = mysqlEnum("collab_layer", ["messages", "threads", "inbox"]);

/**
 * Conversations for direct/group collaboration.
 */
export const conversations = mysqlTable(
  "conversations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    trialId: varchar("trialId", { length: 50 }).notNull(),
    type: collabConversationTypeEnum.notNull(),
    name: varchar("name", { length: 255 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    trialIdx: index("idx_collab_conversations_trial").on(table.trialId),
    typeIdx: index("idx_collab_conversations_type").on(table.type),
    updatedIdx: index("idx_collab_conversations_updated").on(table.updatedAt),
  })
);

/**
 * Conversation participants.
 */
export const conversationParticipants = mysqlTable(
  "conversation_participants",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    conversationId: varchar("conversationId", { length: 36 }).notNull(),
    userId: int("userId").notNull(),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
    lastReadAt: timestamp("lastReadAt"),
  },
  (table) => ({
    userIdx: index("idx_collab_conv_participants_user").on(table.userId),
    conversationIdx: index("idx_collab_conv_participants_conversation").on(table.conversationId),
    uniquePair: uniqueIndex("uidx_collab_conv_participant").on(table.conversationId, table.userId),
  })
);

/**
 * Structured threads for decisions/issues.
 */
export const threads = mysqlTable(
  "threads",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    trialId: varchar("trialId", { length: 50 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    category: collabThreadCategoryEnum.notNull(),
    status: collabThreadStatusEnum.default("open").notNull(),
    resolvedBy: int("resolvedBy"),
    resolvedAt: timestamp("resolvedAt"),
    resolutionSummary: text("resolutionSummary"),
    aiContributed: boolean("aiContributed").default(false).notNull(),
    aiResolutionSuggested: boolean("aiResolutionSuggested").default(false).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    trialIdx: index("idx_collab_threads_trial").on(table.trialId),
    statusIdx: index("idx_collab_threads_status").on(table.status),
    categoryIdx: index("idx_collab_threads_category").on(table.category),
    trialStatusIdx: index("idx_collab_threads_trial_status").on(table.trialId, table.status),
    updatedIdx: index("idx_collab_threads_updated").on(table.updatedAt),
  })
);

/**
 * Thread anchors for traceable context.
 */
export const threadAnchors = mysqlTable(
  "thread_anchors",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    threadId: varchar("threadId", { length: 36 }).notNull(),
    anchorType: collabThreadAnchorTypeEnum.notNull(),
    anchorLabel: varchar("anchorLabel", { length: 255 }).notNull(),
    anchorRefId: varchar("anchorRefId", { length: 64 }),
    anchorRefType: varchar("anchorRefType", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    threadIdx: index("idx_collab_thread_anchors_thread").on(table.threadId),
    refIdx: index("idx_collab_thread_anchors_ref").on(table.anchorRefId),
  })
);

/**
 * Thread participants.
 */
export const threadParticipants = mysqlTable(
  "thread_participants",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    threadId: varchar("threadId", { length: 36 }).notNull(),
    userId: int("userId").notNull(),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
    lastReadAt: timestamp("lastReadAt"),
  },
  (table) => ({
    userIdx: index("idx_collab_thread_participants_user").on(table.userId),
    threadIdx: index("idx_collab_thread_participants_thread").on(table.threadId),
    uniquePair: uniqueIndex("uidx_collab_thread_participant").on(table.threadId, table.userId),
  })
);

/**
 * Trial-scoped inbox configuration.
 */
export const trialInboxes = mysqlTable(
  "trial_inboxes",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    trialId: varchar("trialId", { length: 50 }).notNull(),
    emailAddress: varchar("emailAddress", { length: 320 }).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    trialUnique: uniqueIndex("uidx_collab_trial_inboxes_trial").on(table.trialId),
    emailUnique: uniqueIndex("uidx_collab_trial_inboxes_email").on(table.emailAddress),
  })
);

/**
 * Email chains in trial inboxes.
 */
export const emailChains = mysqlTable(
  "email_chains",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    inboxId: varchar("inboxId", { length: 36 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    folder: collabEmailFolderEnum.default("inbox").notNull(),
    aiLabels: json("aiLabels"),
    aiPriority: collabEmailPriorityEnum,
    aiSummary: text("aiSummary"),
    aiSuggestedThreadId: varchar("aiSuggestedThreadId", { length: 36 }),
    linkedThreadId: varchar("linkedThreadId", { length: 36 }),
    fromAddress: varchar("fromAddress", { length: 320 }),
    fromName: varchar("fromName", { length: 255 }),
    toAddresses: json("toAddresses"),
    ccAddresses: json("ccAddresses"),
    messageCount: int("messageCount").default(0).notNull(),
    isRead: boolean("isRead").default(false).notNull(),
    isStarred: boolean("isStarred").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    inboxIdx: index("idx_collab_email_chains_inbox").on(table.inboxId),
    folderIdx: index("idx_collab_email_chains_folder").on(table.folder),
    inboxFolderIdx: index("idx_collab_email_chains_inbox_folder").on(table.inboxId, table.folder),
    linkedThreadIdx: index("idx_collab_email_chains_linked_thread").on(table.linkedThreadId),
    priorityIdx: index("idx_collab_email_chains_priority").on(table.aiPriority),
    updatedIdx: index("idx_collab_email_chains_updated").on(table.updatedAt),
  })
);

/**
 * Unified message object for messages, threads, and inbox chains.
 */
export const messages = mysqlTable(
  "messages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    conversationId: varchar("conversationId", { length: 36 }),
    threadId: varchar("threadId", { length: 36 }),
    emailChainId: varchar("emailChainId", { length: 36 }),
    senderId: int("senderId"),
    senderType: collabSenderTypeEnum.default("user").notNull(),
    senderName: varchar("senderName", { length: 255 }),
    senderEmail: varchar("senderEmail", { length: 320 }),
    content: text("content").notNull(),
    contentType: collabMessageContentTypeEnum.default("text").notNull(),
    embeddedContent: json("embeddedContent"),
    isAiGenerated: boolean("isAiGenerated").default(false).notNull(),
    aiModel: varchar("aiModel", { length: 100 }),
    aiLatencyMs: int("aiLatencyMs"),
    editedAt: timestamp("editedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    conversationIdx: index("idx_collab_messages_conversation").on(table.conversationId, table.createdAt),
    threadIdx: index("idx_collab_messages_thread").on(table.threadId, table.createdAt),
    emailIdx: index("idx_collab_messages_email_chain").on(table.emailChainId, table.createdAt),
    senderIdx: index("idx_collab_messages_sender").on(table.senderId),
    aiIdx: index("idx_collab_messages_ai").on(table.isAiGenerated, table.createdAt),
  })
);

/**
 * Cross-layer references among collaboration entities.
 */
export const crossReferences = mysqlTable(
  "cross_references",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sourceType: collabCrossRefSourceEntityTypeEnum.notNull(),
    sourceId: varchar("sourceId", { length: 36 }).notNull(),
    targetType: collabCrossRefTargetEntityTypeEnum.notNull(),
    targetId: varchar("targetId", { length: 36 }).notNull(),
    refType: collabCrossRefTypeEnum.default("manual").notNull(),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    sourceIdx: index("idx_collab_cross_refs_source").on(table.sourceType, table.sourceId),
    targetIdx: index("idx_collab_cross_refs_target").on(table.targetType, table.targetId),
  })
);

/**
 * Collaboration telemetry events.
 */
export const collabTelemetryEvents = mysqlTable(
  "collab_telemetry_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    trialId: varchar("trialId", { length: 50 }).notNull(),
    userId: int("userId"),
    eventType: varchar("eventType", { length: 120 }).notNull(),
    eventData: json("eventData").notNull(),
    layer: collabLayerEnum.notNull(),
    aiInvolved: boolean("aiInvolved").default(false).notNull(),
    aiModel: varchar("aiModel", { length: 100 }),
    aiLatencyMs: int("aiLatencyMs"),
    aiAccepted: boolean("aiAccepted"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    trialIdx: index("idx_collab_telemetry_trial").on(table.trialId),
    typeIdx: index("idx_collab_telemetry_type").on(table.eventType),
    aiIdx: index("idx_collab_telemetry_ai").on(table.aiInvolved, table.createdAt),
    createdIdx: index("idx_collab_telemetry_created").on(table.createdAt),
  })
);

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type InsertConversationParticipant = typeof conversationParticipants.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

export type Thread = typeof threads.$inferSelect;
export type InsertThread = typeof threads.$inferInsert;

export type ThreadAnchor = typeof threadAnchors.$inferSelect;
export type InsertThreadAnchor = typeof threadAnchors.$inferInsert;

export type ThreadParticipant = typeof threadParticipants.$inferSelect;
export type InsertThreadParticipant = typeof threadParticipants.$inferInsert;

export type TrialInbox = typeof trialInboxes.$inferSelect;
export type InsertTrialInbox = typeof trialInboxes.$inferInsert;

export type EmailChain = typeof emailChains.$inferSelect;
export type InsertEmailChain = typeof emailChains.$inferInsert;

export type CrossReference = typeof crossReferences.$inferSelect;
export type InsertCrossReference = typeof crossReferences.$inferInsert;

export type CollabTelemetryEvent = typeof collabTelemetryEvents.$inferSelect;
export type InsertCollabTelemetryEvent = typeof collabTelemetryEvents.$inferInsert;
