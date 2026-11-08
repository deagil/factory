ALTER TABLE "drafts" ADD COLUMN "auto_title" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "publish_action_id" uuid;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_publish_action_id_action_log_id_fk" FOREIGN KEY ("publish_action_id") REFERENCES "public"."action_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_created_by_idx" ON "drafts" USING btree ("created_by","status");