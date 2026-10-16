CREATE TABLE "app"."dashboard_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"tiles" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_version_unique" UNIQUE("dashboard_id","version")
);
--> statement-breakpoint
ALTER TABLE "app"."workspace" ADD COLUMN "data_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."dashboard" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."dashboard" ADD COLUMN "generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."dashboard_tile" ADD COLUMN "pack_key" text;--> statement-breakpoint
ALTER TABLE "app"."dashboard_tile" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."dashboard_version" ADD CONSTRAINT "dashboard_version_dashboard_id_dashboard_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "app"."dashboard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dashboard_version" ADD CONSTRAINT "dashboard_version_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dashboard_version" ADD CONSTRAINT "dashboard_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;