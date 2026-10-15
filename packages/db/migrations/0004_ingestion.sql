CREATE TABLE "app"."ingestion_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text DEFAULT 'initial' NOT NULL,
	"status" text DEFAULT 'analyzing' NOT NULL,
	"job_run_id" uuid,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ingestion_run_status_check" CHECK (status in ('analyzing', 'review', 'revising', 'applying', 'done', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "app"."load_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_key" text NOT NULL,
	"rows_in" integer NOT NULL,
	"inserted" integer NOT NULL,
	"merged" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"flagged" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "load_batch_run_entity_uq" UNIQUE("run_id","entity_key")
);
--> statement-breakpoint
CREATE TABLE "app"."model_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"origin" text NOT NULL,
	"base_proposal" jsonb NOT NULL,
	"corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposal" jsonb NOT NULL,
	"review" jsonb NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_proposal_run_version_uq" UNIQUE("run_id","version"),
	CONSTRAINT "model_proposal_status_check" CHECK (status in ('draft', 'approved', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "app"."quality_report" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."row_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_key" text,
	"field_key" text,
	"code" text NOT NULL,
	"file_name" text NOT NULL,
	"sheet_name" text NOT NULL,
	"sheet_row" integer NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sheet_profile" (
	"run_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"upload_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"sheet_name" text NOT NULL,
	"profile" jsonb NOT NULL,
	CONSTRAINT "sheet_profile_run_id_source_id_pk" PRIMARY KEY("run_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "app"."storage_blob" (
	"key" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"bytes" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime" text,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_run_position_uq" UNIQUE("run_id","position")
);
--> statement-breakpoint
ALTER TABLE "app"."ingestion_run" ADD CONSTRAINT "ingestion_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ingestion_run" ADD CONSTRAINT "ingestion_run_job_run_id_job_run_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "app"."job_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ingestion_run" ADD CONSTRAINT "ingestion_run_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."load_batch" ADD CONSTRAINT "load_batch_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."load_batch" ADD CONSTRAINT "load_batch_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."model_proposal" ADD CONSTRAINT "model_proposal_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."model_proposal" ADD CONSTRAINT "model_proposal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."model_proposal" ADD CONSTRAINT "model_proposal_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quality_report" ADD CONSTRAINT "quality_report_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quality_report" ADD CONSTRAINT "quality_report_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."row_issue" ADD CONSTRAINT "row_issue_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."row_issue" ADD CONSTRAINT "row_issue_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sheet_profile" ADD CONSTRAINT "sheet_profile_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sheet_profile" ADD CONSTRAINT "sheet_profile_upload_id_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "app"."upload"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."storage_blob" ADD CONSTRAINT "storage_blob_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."upload" ADD CONSTRAINT "upload_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."upload" ADD CONSTRAINT "upload_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."upload" ADD CONSTRAINT "upload_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_run_workspace_idx" ON "app"."ingestion_run" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "row_issue_run_idx" ON "app"."row_issue" USING btree ("run_id","code");--> statement-breakpoint
CREATE INDEX "upload_workspace_idx" ON "app"."upload" USING btree ("workspace_id","created_at");