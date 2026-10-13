CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."job_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"job_name" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"steps_completed" integer DEFAULT 0 NOT NULL,
	"progress" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_run_status_check" CHECK (status in ('queued', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "job_run_workspace_idx" ON "app"."job_run" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "job_run_status_idx" ON "app"."job_run" USING btree ("status");