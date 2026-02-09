ALTER TABLE `trials` MODIFY COLUMN `status` enum('not-started','active','recruiting','on-hold','completed','terminated') NOT NULL DEFAULT 'not-started';--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN IF NOT EXISTS `documentVersion` varchar(50);--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN IF NOT EXISTS `amendmentVersion` varchar(50);--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN IF NOT EXISTS `releaseDate` varchar(50);--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN IF NOT EXISTS `isCurrent` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN IF NOT EXISTS `archivedAt` timestamp;--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN IF NOT EXISTS `sourceType` varchar(32) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN IF NOT EXISTS `sourceReference` varchar(255);
