CREATE TABLE "app"."data_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"file_name" text NOT NULL,
	"sheet_name" text NOT NULL,
	"signature" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"upload_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_source_signature_uq" UNIQUE("workspace_id","signature","sheet_name")
);
--> statement-breakpoint
CREATE TABLE "app"."merge_preview" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"preview" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."ingestion_run" DROP CONSTRAINT "ingestion_run_status_check";--> statement-breakpoint
ALTER TABLE "app"."ingestion_run" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."data_source" ADD CONSTRAINT "data_source_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."data_source" ADD CONSTRAINT "data_source_last_run_id_ingestion_run_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "app"."ingestion_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_preview" ADD CONSTRAINT "merge_preview_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_preview" ADD CONSTRAINT "merge_preview_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_source_workspace_idx" ON "app"."data_source" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "app"."ingestion_run" ADD CONSTRAINT "ingestion_run_status_check" CHECK (status in ('analyzing', 'review', 'revising', 'applying', 'merge_review', 'merging', 'done', 'failed', 'cancelled'));