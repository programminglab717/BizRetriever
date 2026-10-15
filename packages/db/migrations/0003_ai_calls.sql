CREATE TABLE "app"."ai_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"task" text NOT NULL,
	"prompt_version" text NOT NULL,
	"tier" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"error" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."ai_call" ADD CONSTRAINT "ai_call_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_created_idx" ON "app"."ai_call" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_call_workspace_idx" ON "app"."ai_call" USING btree ("workspace_id","created_at");