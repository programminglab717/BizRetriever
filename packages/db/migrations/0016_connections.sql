CREATE TABLE "app"."connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret" text,
	"status" text DEFAULT 'active' NOT NULL,
	"auto_update" boolean DEFAULT true NOT NULL,
	"last_fingerprint" text,
	"last_checked_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"last_run_id" uuid,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_external_unique" UNIQUE("workspace_id","kind","external_id"),
	CONSTRAINT "connection_kind_check" CHECK (kind in ('google_sheet', 'shopify')),
	CONSTRAINT "connection_status_check" CHECK (status in ('active', 'paused', 'needs_attention', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "app"."ingestion_run" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."connection" ADD CONSTRAINT "connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."connection" ADD CONSTRAINT "connection_last_run_id_ingestion_run_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "app"."ingestion_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."connection" ADD CONSTRAINT "connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ingestion_run" ADD CONSTRAINT "ingestion_run_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "app"."connection"("id") ON DELETE set null ON UPDATE no action;