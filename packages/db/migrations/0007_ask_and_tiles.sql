CREATE TABLE "app"."answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"question" text NOT NULL,
	"kind" text NOT NULL,
	"origin" text NOT NULL,
	"interpretation" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"feedback" smallint,
	"feedback_reason" text,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"ai_calls" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_feedback_check" CHECK ("app"."answer"."feedback" in (-1, 1))
);
--> statement-breakpoint
CREATE TABLE "app"."conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."dashboard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."dashboard_tile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"spec" jsonb NOT NULL,
	"chart" text NOT NULL,
	"layout" jsonb NOT NULL,
	"position" integer NOT NULL,
	"fixed_dates" boolean DEFAULT false NOT NULL,
	"source_answer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."answer" ADD CONSTRAINT "answer_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."answer" ADD CONSTRAINT "answer_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."answer" ADD CONSTRAINT "answer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversation" ADD CONSTRAINT "conversation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dashboard" ADD CONSTRAINT "dashboard_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dashboard_tile" ADD CONSTRAINT "dashboard_tile_dashboard_id_dashboard_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "app"."dashboard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dashboard_tile" ADD CONSTRAINT "dashboard_tile_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dashboard_tile" ADD CONSTRAINT "dashboard_tile_source_answer_id_answer_id_fk" FOREIGN KEY ("source_answer_id") REFERENCES "app"."answer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_conversation_idx" ON "app"."answer" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "answer_workspace_idx" ON "app"."answer" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_workspace_idx" ON "app"."conversation" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "dashboard_workspace_idx" ON "app"."dashboard" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "dashboard_tile_dashboard_idx" ON "app"."dashboard_tile" USING btree ("dashboard_id","position");