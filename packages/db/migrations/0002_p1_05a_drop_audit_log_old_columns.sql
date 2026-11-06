-- contract-step: audit_log is one row per change (decision 0018)
ALTER TABLE "audit_log" DROP COLUMN "field";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "old_value";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "new_value";