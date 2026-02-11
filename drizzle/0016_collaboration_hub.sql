CREATE TABLE `conversations` (
  `id` varchar(36) NOT NULL,
  `trialId` varchar(50) NOT NULL,
  `collab_conversation_type` enum('direct','group') NOT NULL,
  `name` varchar(255),
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversation_participants` (
  `id` varchar(36) NOT NULL,
  `conversationId` varchar(36) NOT NULL,
  `userId` int NOT NULL,
  `joinedAt` timestamp NOT NULL DEFAULT (now()),
  `lastReadAt` timestamp,
  CONSTRAINT `conversation_participants_id` PRIMARY KEY(`id`),
  CONSTRAINT `uidx_collab_conv_participant` UNIQUE(`conversationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `threads` (
  `id` varchar(36) NOT NULL,
  `trialId` varchar(50) NOT NULL,
  `title` varchar(500) NOT NULL,
  `collab_thread_category` enum('question','decision','issue','action_required','approval','clarification') NOT NULL,
  `collab_thread_status` enum('open','pending','resolved','closed') NOT NULL DEFAULT 'open',
  `resolvedBy` int,
  `resolvedAt` timestamp,
  `resolutionSummary` text,
  `aiContributed` boolean NOT NULL DEFAULT false,
  `aiResolutionSuggested` boolean NOT NULL DEFAULT false,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `thread_anchors` (
  `id` varchar(36) NOT NULL,
  `threadId` varchar(36) NOT NULL,
  `collab_thread_anchor_type` enum('document_section','task','visit','trial_wide','therapeutic_area','team_member') NOT NULL,
  `anchorLabel` varchar(255) NOT NULL,
  `anchorRefId` varchar(64),
  `anchorRefType` varchar(64),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `thread_anchors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `thread_participants` (
  `id` varchar(36) NOT NULL,
  `threadId` varchar(36) NOT NULL,
  `userId` int NOT NULL,
  `joinedAt` timestamp NOT NULL DEFAULT (now()),
  `lastReadAt` timestamp,
  CONSTRAINT `thread_participants_id` PRIMARY KEY(`id`),
  CONSTRAINT `uidx_collab_thread_participant` UNIQUE(`threadId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `trial_inboxes` (
  `id` varchar(36) NOT NULL,
  `trialId` varchar(50) NOT NULL,
  `emailAddress` varchar(320) NOT NULL,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `trial_inboxes_id` PRIMARY KEY(`id`),
  CONSTRAINT `uidx_collab_trial_inboxes_trial` UNIQUE(`trialId`),
  CONSTRAINT `uidx_collab_trial_inboxes_email` UNIQUE(`emailAddress`)
);
--> statement-breakpoint
CREATE TABLE `email_chains` (
  `id` varchar(36) NOT NULL,
  `inboxId` varchar(36) NOT NULL,
  `subject` varchar(500) NOT NULL,
  `collab_email_folder` enum('inbox','sent','drafts','archived') NOT NULL DEFAULT 'inbox',
  `aiLabels` json,
  `collab_email_priority` enum('high','medium','low'),
  `aiSummary` text,
  `aiSuggestedThreadId` varchar(36),
  `linkedThreadId` varchar(36),
  `fromAddress` varchar(320),
  `fromName` varchar(255),
  `toAddresses` json,
  `ccAddresses` json,
  `messageCount` int NOT NULL DEFAULT 0,
  `isRead` boolean NOT NULL DEFAULT false,
  `isStarred` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `email_chains_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
  `id` varchar(36) NOT NULL,
  `conversationId` varchar(36),
  `threadId` varchar(36),
  `emailChainId` varchar(36),
  `senderId` int,
  `collab_sender_type` enum('user','ai','system','email_external') NOT NULL DEFAULT 'user',
  `senderName` varchar(255),
  `senderEmail` varchar(320),
  `content` text NOT NULL,
  `collab_message_content_type` enum('text','protocol_snippet','task_card','ai_response','email') NOT NULL DEFAULT 'text',
  `embeddedContent` json,
  `isAiGenerated` boolean NOT NULL DEFAULT false,
  `aiModel` varchar(100),
  `aiLatencyMs` int,
  `editedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cross_references` (
  `id` varchar(36) NOT NULL,
  `collab_cross_ref_source_entity_type` enum('message','thread','email_chain','task') NOT NULL,
  `sourceId` varchar(36) NOT NULL,
  `collab_cross_ref_target_entity_type` enum('message','thread','email_chain','task') NOT NULL,
  `targetId` varchar(36) NOT NULL,
  `collab_cross_ref_type` enum('manual','ai_suggested','spawned_from') NOT NULL DEFAULT 'manual',
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `cross_references_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `collab_telemetry_events` (
  `id` varchar(36) NOT NULL,
  `trialId` varchar(50) NOT NULL,
  `userId` int,
  `eventType` varchar(120) NOT NULL,
  `eventData` json NOT NULL,
  `collab_layer` enum('messages','threads','inbox') NOT NULL,
  `aiInvolved` boolean NOT NULL DEFAULT false,
  `aiModel` varchar(100),
  `aiLatencyMs` int,
  `aiAccepted` boolean,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `collab_telemetry_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_collab_conversations_trial` ON `conversations` (`trialId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_conversations_type` ON `conversations` (`collab_conversation_type`);
--> statement-breakpoint
CREATE INDEX `idx_collab_conversations_updated` ON `conversations` (`updatedAt`);
--> statement-breakpoint
CREATE INDEX `idx_collab_conv_participants_user` ON `conversation_participants` (`userId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_conv_participants_conversation` ON `conversation_participants` (`conversationId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_threads_trial` ON `threads` (`trialId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_threads_status` ON `threads` (`collab_thread_status`);
--> statement-breakpoint
CREATE INDEX `idx_collab_threads_category` ON `threads` (`collab_thread_category`);
--> statement-breakpoint
CREATE INDEX `idx_collab_threads_trial_status` ON `threads` (`trialId`,`collab_thread_status`);
--> statement-breakpoint
CREATE INDEX `idx_collab_threads_updated` ON `threads` (`updatedAt`);
--> statement-breakpoint
CREATE INDEX `idx_collab_thread_anchors_thread` ON `thread_anchors` (`threadId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_thread_anchors_ref` ON `thread_anchors` (`anchorRefId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_thread_participants_user` ON `thread_participants` (`userId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_thread_participants_thread` ON `thread_participants` (`threadId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_email_chains_inbox` ON `email_chains` (`inboxId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_email_chains_folder` ON `email_chains` (`collab_email_folder`);
--> statement-breakpoint
CREATE INDEX `idx_collab_email_chains_inbox_folder` ON `email_chains` (`inboxId`,`collab_email_folder`);
--> statement-breakpoint
CREATE INDEX `idx_collab_email_chains_linked_thread` ON `email_chains` (`linkedThreadId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_email_chains_priority` ON `email_chains` (`collab_email_priority`);
--> statement-breakpoint
CREATE INDEX `idx_collab_email_chains_updated` ON `email_chains` (`updatedAt`);
--> statement-breakpoint
CREATE INDEX `idx_collab_messages_conversation` ON `messages` (`conversationId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_collab_messages_thread` ON `messages` (`threadId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_collab_messages_email_chain` ON `messages` (`emailChainId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_collab_messages_sender` ON `messages` (`senderId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_messages_ai` ON `messages` (`isAiGenerated`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_collab_cross_refs_source` ON `cross_references` (`collab_cross_ref_source_entity_type`,`sourceId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_cross_refs_target` ON `cross_references` (`collab_cross_ref_target_entity_type`,`targetId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_telemetry_trial` ON `collab_telemetry_events` (`trialId`);
--> statement-breakpoint
CREATE INDEX `idx_collab_telemetry_type` ON `collab_telemetry_events` (`eventType`);
--> statement-breakpoint
CREATE INDEX `idx_collab_telemetry_ai` ON `collab_telemetry_events` (`aiInvolved`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_collab_telemetry_created` ON `collab_telemetry_events` (`createdAt`);
