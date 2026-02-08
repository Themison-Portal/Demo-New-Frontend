ALTER TABLE `trials` MODIFY COLUMN `phase` varchar(50);--> statement-breakpoint
ALTER TABLE `trials` ADD `investigationalProduct` varchar(255);--> statement-breakpoint
ALTER TABLE `trials` ADD `indication` varchar(255);--> statement-breakpoint
ALTER TABLE `trials` ADD `nctNumber` varchar(50);--> statement-breakpoint
ALTER TABLE `trials` ADD `currentVersion` varchar(50);--> statement-breakpoint
ALTER TABLE `trials` ADD `amendmentVersion` varchar(50);--> statement-breakpoint
ALTER TABLE `trials` ADD `releaseDate` varchar(50);--> statement-breakpoint
ALTER TABLE `trials` ADD `sampleSize` varchar(50);--> statement-breakpoint
ALTER TABLE `trials` ADD `numberOfSites` varchar(50);--> statement-breakpoint
ALTER TABLE `trials` ADD `studyDuration` varchar(100);--> statement-breakpoint
ALTER TABLE `trials` ADD `studyDesignType` varchar(255);--> statement-breakpoint
ALTER TABLE `trials` ADD `primaryObjective` text;--> statement-breakpoint
ALTER TABLE `trials` ADD `primaryEndpoint` text;