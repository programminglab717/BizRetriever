CREATE TABLE "app"."account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "app"."user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "app"."verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."query_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"path" text NOT NULL,
	"mode" text NOT NULL,
	"sql_hash" text NOT NULL,
	"sql_text" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"row_count" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"error" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "query_run_origin_check" CHECK (origin in ('ask', 'dashboard', 'insight', 'records', 'system')),
	CONSTRAINT "query_run_path_check" CHECK (path in ('spec', 'sql_fallback', 'system'))
);
--> statement-breakpoint
CREATE TABLE "app"."workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"tenant_schema" text NOT NULL,
	"pack_id" text NOT NULL,
	"pack_version" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workspace_tenant_schema_unique" UNIQUE("tenant_schema"),
	CONSTRAINT "workspace_status_check" CHECK (status in ('provisioning', 'active', 'failed', 'deleting')),
	CONSTRAINT "workspace_tenant_schema_check" CHECK ("app"."workspace"."tenant_schema" ~ '^t_[a-z0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "app"."workspace_member" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_member_role_check" CHECK (role in ('owner', 'member')),
	CONSTRAINT "workspace_member_status_check" CHECK (status in ('active', 'invited'))
);
--> statement-breakpoint
CREATE TABLE "app"."workspace_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"currency" char(3) NOT NULL,
	"timezone" text NOT NULL,
	"date_order" text NOT NULL,
	"fiscal_year_start_month" smallint DEFAULT 1 NOT NULL,
	"week_start" smallint DEFAULT 1 NOT NULL,
	"pii_masking" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_settings_date_order_check" CHECK (date_order in ('DMY', 'MDY', 'YMD')),
	CONSTRAINT "workspace_settings_fy_check" CHECK ("app"."workspace_settings"."fiscal_year_start_month" between 1 and 12),
	CONSTRAINT "workspace_settings_week_check" CHECK ("app"."workspace_settings"."week_start" between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE "app"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_event" ADD CONSTRAINT "audit_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_event" ADD CONSTRAINT "audit_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."query_run" ADD CONSTRAINT "query_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspace" ADD CONSTRAINT "workspace_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspace_member" ADD CONSTRAINT "workspace_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "app"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "app"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "app"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "audit_event_workspace_idx" ON "app"."audit_event" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "query_run_workspace_idx" ON "app"."query_run" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_member_user_idx" ON "app"."workspace_member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "app"."job_run" ADD CONSTRAINT "job_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;