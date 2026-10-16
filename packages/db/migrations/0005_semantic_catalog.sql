CREATE TABLE "app"."metric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"pack_metric" text,
	"label" text NOT NULL,
	"label_customized" boolean DEFAULT false NOT NULL,
	"description" text NOT NULL,
	"format" text NOT NULL,
	"good_direction" text DEFAULT 'up' NOT NULL,
	"snapshot" boolean DEFAULT false NOT NULL,
	"available" boolean DEFAULT false NOT NULL,
	"unavailable_reason" text,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_workspace_key_uq" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
ALTER TABLE "app"."entity" ADD COLUMN "record_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."field" ADD COLUMN "has_data" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."metric" ADD CONSTRAINT "metric_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;