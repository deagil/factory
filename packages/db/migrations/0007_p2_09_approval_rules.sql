CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"subject" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"approver_role" text NOT NULL,
	"status" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_actors_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_actors_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_subject_idx" ON "approvals" USING btree ("subject","subject_id");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status","created_at");