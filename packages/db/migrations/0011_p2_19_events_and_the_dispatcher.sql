ALTER TABLE "runs" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_event_unique" ON "runs" USING btree ("endpoint","event_id") WHERE "runs"."event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_schedule_unique" ON "runs" USING btree ("endpoint","scheduled_for") WHERE "runs"."scheduled_for" is not null;