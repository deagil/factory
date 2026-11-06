CREATE TABLE "action_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"origin_user_id" uuid,
	"run_id" uuid,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"status" text NOT NULL,
	"retry_key" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"config_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "actor_roles" (
	"actor_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	CONSTRAINT "actor_roles_actor_id_role_key_pk" PRIMARY KEY("actor_id","role_key")
);
--> statement-breakpoint
CREATE TABLE "actors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actors_user_required" CHECK ("actors"."kind" not in ('staff', 'agent') or "actors"."user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"label" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"object" text NOT NULL,
	"record_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"action_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"action_id" uuid NOT NULL,
	"origin_user_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_log" ADD CONSTRAINT "action_log_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_log" ADD CONSTRAINT "action_log_origin_user_id_users_id_fk" FOREIGN KEY ("origin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_roles" ADD CONSTRAINT "actor_roles_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_id_action_log_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_action_id_action_log_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_origin_user_id_users_id_fk" FOREIGN KEY ("origin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_log_actor_id_created_at_idx" ON "action_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "action_log_run_id_idx" ON "action_log" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "actors_user_id_idx" ON "actors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_actor_id_idx" ON "api_keys" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_record_idx" ON "audit_log" USING btree ("object","record_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_action_id_idx" ON "audit_log" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "event_log_action_id_idx" ON "event_log" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "event_log_undispatched_idx" ON "event_log" USING btree ("created_at") WHERE "event_log"."dispatched_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));