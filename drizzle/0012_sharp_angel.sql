CREATE TABLE IF NOT EXISTS `ai_analytics_rollups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trialId` varchar(50) NOT NULL,
	`rollupDate` varchar(10) NOT NULL,
	`documentTotal` int NOT NULL DEFAULT 0,
	`documentIndexed` int NOT NULL DEFAULT 0,
	`taskTotal` int NOT NULL DEFAULT 0,
	`taskPending` int NOT NULL DEFAULT 0,
	`taskBlocked` int NOT NULL DEFAULT 0,
	`taskCompleted` int NOT NULL DEFAULT 0,
	`telemetryEvents7d` int NOT NULL DEFAULT 0,
	`aiInvolvedEvents7d` int NOT NULL DEFAULT 0,
	`aiUsageRateBps` int NOT NULL DEFAULT 0,
	`riskScore` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_analytics_rollups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_feature_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trialId` varchar(50) NOT NULL,
	`snapshotDate` varchar(10) NOT NULL,
	`snapshotVersion` varchar(32) NOT NULL DEFAULT 'v1',
	`featureVector` json NOT NULL,
	`readinessScore` int NOT NULL DEFAULT 0,
	`riskScore` int NOT NULL DEFAULT 0,
	`aiCoverageScore` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_feature_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_training_examples` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceEventId` varchar(36),
	`trialId` varchar(50),
	`userId` varchar(64),
	`prompt` text,
	`response` text,
	`label` varchar(32) NOT NULL DEFAULT 'unknown',
	`correction` text,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_training_examples_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_graph_edges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trialId` varchar(50) NOT NULL,
	`edgeType` varchar(64) NOT NULL,
	`fromNodeKey` varchar(191) NOT NULL,
	`toNodeKey` varchar(191) NOT NULL,
	`properties` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `knowledge_graph_edges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_graph_nodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trialId` varchar(50) NOT NULL,
	`nodeType` varchar(64) NOT NULL,
	`nodeKey` varchar(191) NOT NULL,
	`displayName` varchar(255),
	`properties` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_graph_nodes_id` PRIMARY KEY(`id`)
);
