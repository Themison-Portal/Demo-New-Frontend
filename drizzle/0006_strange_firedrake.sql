CREATE TABLE `fileSearchDocuments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`protocolId` int NOT NULL,
	`documentName` varchar(255) NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fileSearchDocuments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fileSearchStores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trialId` varchar(50) NOT NULL,
	`storeName` varchar(255) NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fileSearchStores_id` PRIMARY KEY(`id`),
	CONSTRAINT `fileSearchStores_trialId_unique` UNIQUE(`trialId`),
	CONSTRAINT `fileSearchStores_storeName_unique` UNIQUE(`storeName`)
);
--> statement-breakpoint
DROP TABLE `documentChunks`;