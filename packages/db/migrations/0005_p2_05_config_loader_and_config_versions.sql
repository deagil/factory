CREATE TABLE "config_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sha" text NOT NULL,
	"status" text NOT NULL,
	"errors" jsonb,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "config_versions_loaded_at_idx" ON "config_versions" USING btree ("loaded_at");