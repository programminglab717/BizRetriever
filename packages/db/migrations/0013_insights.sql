CREATE TABLE "app"."digest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"week_of" date NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "digest_week_unique" UNIQUE("workspace_id","week_of")
);
--> statement-breakpoint
CREATE TABLE "app"."insight" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"subject" text,
	"category" text NOT NULL,
	"level" text NOT NULL,
	"score" double precision NOT NULL,
	"impact" double precision DEFAULT 0 NOT NULL,
	"facts" jsonb NOT NULL,
	"headline" jsonb NOT NULL,
	"context" jsonb,
	"text" text NOT NULL,
	"action" jsonb,
	"phrased_by" text,
	"status" text DEFAULT 'new' NOT NULL,
	"feedback" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" uuid,
	"dismissed_level" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "insight_fingerprint_unique" UNIQUE("workspace_id","fingerprint"),
	CONSTRAINT "insight_level_check" CHECK (level in ('urgent', 'warn', 'info')),
	CONSTRAINT "insight_status_check" CHECK (status in ('new', 'seen', 'dismissed', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "app"."insight_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"today" date NOT NULL,
	"data_version" integer DEFAULT 0 NOT NULL,
	"history_days" integer,
	"rules" jsonb NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"resolved" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."insight_setting" (
	"workspace_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_setting_workspace_id_rule_id_pk" PRIMARY KEY("workspace_id","rule_id")
);
--> statement-breakpoint
ALTER TABLE "app"."digest" ADD CONSTRAINT "digest_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."insight" ADD CONSTRAINT "insight_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."insight" ADD CONSTRAINT "insight_dismissed_by_user_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."insight_run" ADD CONSTRAINT "insight_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."insight_setting" ADD CONSTRAINT "insight_setting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."insight_setting" ADD CONSTRAINT "insight_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insight_feed_idx" ON "app"."insight" USING btree ("workspace_id","status","score");--> statement-breakpoint
CREATE INDEX "insight_run_workspace_idx" ON "app"."insight_run" USING btree ("workspace_id","started_at");