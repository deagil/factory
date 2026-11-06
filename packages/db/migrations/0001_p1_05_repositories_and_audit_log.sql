ALTER TABLE "audit_log" ALTER COLUMN "field" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "before" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "after" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_after_idx" ON "audit_log" USING gin ("after");