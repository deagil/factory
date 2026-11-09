CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"segment" integer DEFAULT 0 NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" jsonb,
	"branch" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"endpoint" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"origin_user_id" uuid,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"status" text NOT NULL,
	"retry_key" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"config_sha" text,
	"parent_run_id" uuid,
	"event_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "action_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_log" ALTER COLUMN "action_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "step_id" uuid;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "publish_run_id" uuid;--> statement-breakpoint
ALTER TABLE "event_log" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "event_log" ADD COLUMN "step_id" uuid;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_origin_user_id_users_id_fk" FOREIGN KEY ("origin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_parent_run_id_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_steps_run_id_idx" ON "run_steps" USING btree ("run_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_actor_id_started_at_idx" ON "runs" USING btree ("actor_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_started_at_idx" ON "runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "runs_parent_run_id_idx" ON "runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_retry_key_unique" ON "runs" USING btree ("actor_id","retry_key") WHERE "runs"."retry_key" is not null and "runs"."status" = 'succeeded' and not "runs"."dry_run";--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_step_id_run_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_publish_run_id_runs_id_fk" FOREIGN KEY ("publish_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_step_id_run_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_run_id_idx" ON "audit_log" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "event_log_run_id_idx" ON "event_log" USING btree ("run_id");