CREATE TABLE IF NOT EXISTS `protocolChunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`protocolId` int NOT NULL,
	`trialId` varchar(50) NOT NULL,
	`chunkIndex` int NOT NULL,
	`sectionType` varchar(64) NOT NULL,
	`sectionTitle` varchar(255),
	`pageStart` int,
	`pageEnd` int,
	`tokenEstimate` int,
	`contentHash` varchar(64) NOT NULL,
	`chunkText` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `protocolChunks_id` PRIMARY KEY(`id`)
);
