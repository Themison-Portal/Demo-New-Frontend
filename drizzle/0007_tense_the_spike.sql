CREATE TABLE `documentCategories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`isDefault` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documentCategories_id` PRIMARY KEY(`id`),
	CONSTRAINT `documentCategories_name_unique` UNIQUE(`name`)
);
