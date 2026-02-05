CREATE TABLE `documentChunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`protocolId` int NOT NULL,
	`trialId` varchar(50) NOT NULL,
	`chunkText` text NOT NULL,
	`chunkIndex` int NOT NULL,
	`pageNumber` int,
	`embedding` json NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documentChunks_id` PRIMARY KEY(`id`)
);
