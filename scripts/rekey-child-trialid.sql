-- Phase C data migration: re-key the FE child tables' `trialId` from the
-- prefixed FE trial id (e.g. "building:cardiac-a2b3c") to the BE trial UUID.
--
-- Run order (Phase E cutover):
--   1. Run the trials backfill first  (scripts/backfill-trials-to-be.ts) so that
--      `trials.coreBackendTrialId` is populated for every FE trial.
--   2. Run THIS script against the FE MySQL/TiDB (it sets child.trialId = the BE
--      trial UUID by joining on the FE trials row).
--   3. THEN apply the schema (drizzle-kit push) so `trialId` becomes varchar(36).
--      Prefixed ids are < 36 chars, so any un-migrated (orphan) rows survive the
--      column shrink; they simply won't match BE-UUID queries.
--
-- Idempotent: re-running only touches rows whose trialId still equals a FE
-- trials.id (already-migrated UUID values won't join and are left alone).

UPDATE `taskScaffolds`         c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `execution_maps`        c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `map_telemetry_events`  c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `map_task_status_history` c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `protocolChunks`        c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `fileSearchStores`      c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `ai_feature_snapshots`  c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `ai_analytics_rollups`  c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `ai_training_examples`  c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `knowledge_graph_nodes` c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `knowledge_graph_edges` c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `conversations`         c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `threads`               c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `trial_inboxes`         c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
UPDATE `collab_telemetry_events` c JOIN `trials` t ON c.`trialId` = t.`id` SET c.`trialId` = t.`coreBackendTrialId` WHERE t.`coreBackendTrialId` IS NOT NULL;
