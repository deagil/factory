CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch" text NOT NULL,
	"title" text NOT NULL,
	"files" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"base_sha" text NOT NULL,
	"published_sha" text,
	"synced_sha" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_created_by_actors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_branch_unique" ON "drafts" USING btree ("branch");--> statement-breakpoint
CREATE INDEX "drafts_status_idx" ON "drafts" USING btree ("status");