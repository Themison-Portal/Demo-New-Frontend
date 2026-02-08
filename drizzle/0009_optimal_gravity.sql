CREATE TABLE `telemetry_events` (
	`id` varchar(36) NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`userId` varchar(64),
	`sessionId` varchar(128) NOT NULL,
	`entityType` varchar(64),
	`entityId` varchar(128),
	`action` varchar(64) NOT NULL,
	`payload` json,
	`durationMs` int,
	`aiInvolved` boolean NOT NULL DEFAULT false,
	`aiOutput` text,
	`aiSources` json,
	`userCorrection` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telemetry_events_id` PRIMARY KEY(`id`)
);
