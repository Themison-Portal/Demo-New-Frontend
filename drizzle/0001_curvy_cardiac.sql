CREATE TABLE `phaseTransitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromPhaseId` int NOT NULL,
	`toPhaseId` int NOT NULL,
	`condition` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `phaseTransitions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `phases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scaffoldId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`color` varchar(7) NOT NULL,
	`orderIndex` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `phases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `protocolSections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`protocolId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`pageReference` varchar(50),
	`dateReference` varchar(50),
	`orderIndex` int NOT NULL,
	`parentSectionId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `protocolSections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `protocols` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trialId` int NOT NULL,
	`filename` varchar(255) NOT NULL,
	`fileUrl` text NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`uploadedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `protocols_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `taskDependencies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`dependsOnTaskId` int NOT NULL,
	`type` enum('after','before','concurrent') NOT NULL DEFAULT 'after',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `taskDependencies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `taskScaffolds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`protocolId` int NOT NULL,
	`trialId` int NOT NULL,
	`status` enum('draft','confirmed','active') NOT NULL DEFAULT 'draft',
	`confirmedAt` timestamp,
	`confirmedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `taskScaffolds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phaseId` int NOT NULL,
	`name` varchar(500) NOT NULL,
	`suggestedAssigneeId` int,
	`suggestedDate` timestamp,
	`duration` int,
	`protocolSection` varchar(255),
	`protocolPage` int,
	`status` enum('pending','completed','blocked') NOT NULL DEFAULT 'pending',
	`orderIndex` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
