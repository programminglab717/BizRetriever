CREATE TABLE "app"."change_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"plan" jsonb NOT NULL,
	"impact" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_plan_status_check" CHECK (status in ('draft', 'confirmed', 'applied', 'rejected', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"table_name" text NOT NULL,
	"label_singular" text NOT NULL,
	"label_plural" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"pack_entity" text,
	"natural_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"time_field" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_workspace_key_uq" UNIQUE("workspace_id","key"),
	CONSTRAINT "entity_workspace_table_uq" UNIQUE("workspace_id","table_name")
);
--> statement-breakpoint
CREATE TABLE "app"."field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"semantic" text,
	"required" boolean DEFAULT false NOT NULL,
	"pii" boolean DEFAULT false NOT NULL,
	"description" text,
	"allowed_values" jsonb,
	"references_entity" text,
	"pack_field" text,
	"synonyms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_entity_key_uq" UNIQUE("entity_id","key")
);
--> statement-breakpoint
CREATE TABLE "app"."migration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"change_plan_id" uuid NOT NULL,
	"statements" jsonb NOT NULL,
	"inverse_plan" jsonb,
	"destructive" boolean DEFAULT false NOT NULL,
	"lossy_rollback" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone,
	CONSTRAINT "migration_workspace_version_uq" UNIQUE("workspace_id","version")
);
--> statement-breakpoint
ALTER TABLE "app"."change_plan" ADD CONSTRAINT "change_plan_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."change_plan" ADD CONSTRAINT "change_plan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."change_plan" ADD CONSTRAINT "change_plan_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entity" ADD CONSTRAINT "entity_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."field" ADD CONSTRAINT "field_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration" ADD CONSTRAINT "migration_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration" ADD CONSTRAINT "migration_change_plan_id_change_plan_id_fk" FOREIGN KEY ("change_plan_id") REFERENCES "app"."change_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_plan_workspace_idx" ON "app"."change_plan" USING btree ("workspace_id","created_at");