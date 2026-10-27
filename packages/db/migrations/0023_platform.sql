CREATE TABLE "app"."api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"window_start" timestamp with time zone,
	"window_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"last_delivery_at" timestamp with time zone,
	"last_status" integer,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event" text NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_status" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "webhook_delivery_status_check" CHECK (status in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "app"."query_run" DROP CONSTRAINT "query_run_origin_check";--> statement-breakpoint
ALTER TABLE "app"."api_key" ADD CONSTRAINT "api_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."api_key" ADD CONSTRAINT "api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook" ADD CONSTRAINT "webhook_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook" ADD CONSTRAINT "webhook_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "app"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_delivery" ADD CONSTRAINT "webhook_delivery_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_hash_idx" ON "app"."api_key" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_key_workspace_idx" ON "app"."api_key" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "webhook_workspace_idx" ON "app"."webhook" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_event_idx" ON "app"."webhook_delivery" USING btree ("webhook_id","event_key");--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "app"."webhook_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "app"."query_run" ADD CONSTRAINT "query_run_origin_check" CHECK (origin in ('ask', 'dashboard', 'insight', 'records', 'system', 'api'));