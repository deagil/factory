ALTER TABLE "runs" ADD COLUMN "attention_role" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "checkpoint" jsonb;--> statement-breakpoint
CREATE INDEX "runs_attention_idx" ON "runs" USING btree ("attention_role") WHERE "runs"."status" = 'needs_attention';