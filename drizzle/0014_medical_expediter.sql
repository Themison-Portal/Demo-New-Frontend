CREATE TABLE `execution_maps` (
	`id` varchar(36) NOT NULL,
	`trialId` varchar(50) NOT NULL,
	`protocolId` int NOT NULL,
	`map_status` enum('draft','active','revised','archived') NOT NULL DEFAULT 'draft',
	`version` int NOT NULL DEFAULT 1,
	`metadata` json NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`launchedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `execution_maps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `map_phase_transitions` (
	`id` varchar(36) NOT NULL,
	`fromPhaseId` varchar(36) NOT NULL,
	`toPhaseId` varchar(36) NOT NULL,
	`conditionLabel` varchar(255),
	`isDefault` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `map_phase_transitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_map_transitions_unique` UNIQUE(`fromPhaseId`,`toPhaseId`)
);
--> statement-breakpoint
CREATE TABLE `map_phases` (
	`id` varchar(36) NOT NULL,
	`mapId` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`phase_type` enum('screening','baseline','treatment_visit','follow_up','end_of_study','unscheduled','screen_fail','early_termination','custom') NOT NULL DEFAULT 'custom',
	`displayOrder` int NOT NULL,
	`color` varchar(7) NOT NULL DEFAULT '#3B82F6',
	`estimatedDate` timestamp,
	`windowStart` timestamp,
	`windowEnd` timestamp,
	`protocolRef` json,
	`canvasX` float,
	`canvasY` float,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `map_phases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `map_task_dependencies` (
	`id` varchar(36) NOT NULL,
	`sourceTaskId` varchar(36) NOT NULL,
	`targetTaskId` varchar(36) NOT NULL,
	`dependency_type` enum('finish_to_start','start_to_start','finish_to_finish','concurrent','blocked_by') NOT NULL DEFAULT 'finish_to_start',
	`conditionLabel` varchar(255),
	`isCrossPhase` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `map_task_dependencies_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_map_dependencies_unique` UNIQUE(`sourceTaskId`,`targetTaskId`)
);
--> statement-breakpoint
CREATE TABLE `map_tasks` (
	`id` varchar(36) NOT NULL,
	`phaseId` varchar(36) NOT NULL,
	`mapId` varchar(36) NOT NULL,
	`name` varchar(500) NOT NULL,
	`description` text,
	`task_category` enum('consent','eligibility','lab_sample','vital_signs','imaging','drug_administration','assessment','questionnaire','data_entry','coordination','documentation','follow_up','safety_reporting','regulatory','custom') NOT NULL DEFAULT 'custom',
	`task_priority` enum('critical','high','medium','low') NOT NULL DEFAULT 'medium',
	`task_status` enum('suggested','confirmed','todo','in_progress','blocked','waiting','done','skipped','cancelled') NOT NULL DEFAULT 'suggested',
	`blockedReason` text,
	`blockedSince` timestamp,
	`task_role` enum('pi','sub_i','crc','nurse','pharmacist','lab_tech','data_manager','regulatory_coordinator','study_coordinator','custom'),
	`assignedUserId` int,
	`suggestedAssignee` varchar(255),
	`suggestedDate` timestamp,
	`dueDate` timestamp,
	`estimatedDuration` int,
	`startDate` timestamp,
	`completedDate` timestamp,
	`orderInPhase` int NOT NULL DEFAULT 0,
	`canvasX` float,
	`canvasY` float,
	`map_task_created_by` enum('ai','user') NOT NULL DEFAULT 'ai',
	`aiConfidence` float,
	`isCustom` boolean NOT NULL DEFAULT false,
	`tags` json NOT NULL,
	`protocolRefs` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `map_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `map_telemetry_events` (
	`id` varchar(36) NOT NULL,
	`mapId` varchar(36) NOT NULL,
	`trialId` varchar(50) NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`userId` int,
	`targetId` varchar(36),
	`targetType` varchar(32),
	`payload` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `map_telemetry_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `protocol_map_sections` (
	`id` varchar(36) NOT NULL,
	`protocolId` int NOT NULL,
	`mapId` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`protocol_map_section_type` enum('schedule','eligibility','procedure','safety','medication','randomization','lab','custom') NOT NULL DEFAULT 'custom',
	`pageStart` int,
	`pageEnd` int,
	`dateReference` timestamp,
	`parentSectionId` varchar(36),
	`linkedPhaseIds` json NOT NULL,
	`linkedTaskIds` json NOT NULL,
	`displayOrder` int NOT NULL DEFAULT 0,
	`isChecked` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `protocol_map_sections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_maps_trial` ON `execution_maps` (`trialId`);--> statement-breakpoint
CREATE INDEX `idx_maps_status` ON `execution_maps` (`map_status`);--> statement-breakpoint
CREATE INDEX `idx_map_transitions_from` ON `map_phase_transitions` (`fromPhaseId`);--> statement-breakpoint
CREATE INDEX `idx_map_transitions_to` ON `map_phase_transitions` (`toPhaseId`);--> statement-breakpoint
CREATE INDEX `idx_map_phases_map_order` ON `map_phases` (`mapId`,`displayOrder`);--> statement-breakpoint
CREATE INDEX `idx_map_dependencies_source` ON `map_task_dependencies` (`sourceTaskId`);--> statement-breakpoint
CREATE INDEX `idx_map_dependencies_target` ON `map_task_dependencies` (`targetTaskId`);--> statement-breakpoint
CREATE INDEX `idx_map_tasks_phase_order` ON `map_tasks` (`phaseId`,`orderInPhase`);--> statement-breakpoint
CREATE INDEX `idx_map_tasks_dates` ON `map_tasks` (`mapId`,`dueDate`,`suggestedDate`);--> statement-breakpoint
CREATE INDEX `idx_map_tasks_status` ON `map_tasks` (`mapId`,`task_status`);--> statement-breakpoint
CREATE INDEX `idx_map_tasks_assignee` ON `map_tasks` (`assignedUserId`,`task_status`);--> statement-breakpoint
CREATE INDEX `idx_map_tasks_map` ON `map_tasks` (`mapId`);--> statement-breakpoint
CREATE INDEX `idx_map_telemetry_map_ts` ON `map_telemetry_events` (`mapId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_map_telemetry_type_ts` ON `map_telemetry_events` (`eventType`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_map_telemetry_trial_ts` ON `map_telemetry_events` (`trialId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_map_protocol_sections_map_order` ON `protocol_map_sections` (`mapId`,`displayOrder`);--> statement-breakpoint
CREATE INDEX `idx_map_protocol_sections_parent` ON `protocol_map_sections` (`parentSectionId`);
