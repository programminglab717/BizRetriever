CREATE TABLE "app"."goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"target" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_metric_unique" UNIQUE("workspace_id","metric_key")
);
--> statement-breakpoint
ALTER TABLE "app"."goal" ADD CONSTRAINT "goal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."goal" ADD CONSTRAINT "goal_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;