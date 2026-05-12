-- Phase 3 of the Auth0 + RAG integration: link the FE's local
-- `trials`/`protocols` rows to core-backend's `trials`/`trial_documents`
-- rows so uploads, queries, and status polling can route through the
-- existing FastAPI service without backend changes.

ALTER TABLE `trials` ADD COLUMN `coreBackendTrialId` varchar(36);
--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN `coreBackendDocumentId` varchar(36);
--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN `coreBackendJobId` varchar(36);
--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN `coreBackendIngestStatus` varchar(32);
