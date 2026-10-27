CREATE TABLE "app"."report_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"answer_id" uuid,
	"title" text NOT NULL,
	"cadence" text NOT NULL,
	"day" integer NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_period" text,
	"last_sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedule_kind_check" CHECK (kind in ('dashboard', 'question')),
	CONSTRAINT "report_schedule_cadence_check" CHECK (cadence in ('weekly', 'monthly')),
	CONSTRAINT "report_schedule_day_check" CHECK ("app"."report_schedule"."day" between 1 and 28),
	CONSTRAINT "report_schedule_answer_check" CHECK (("app"."report_schedule"."kind" = 'question') = ("app"."report_schedule"."answer_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."email_delivery" DROP CONSTRAINT "email_delivery_kind_check";--> statement-breakpoint
ALTER TABLE "app"."report_schedule" ADD CONSTRAINT "report_schedule_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_schedule" ADD CONSTRAINT "report_schedule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_schedule" ADD CONSTRAINT "report_schedule_answer_id_answer_id_fk" FOREIGN KEY ("answer_id") REFERENCES "app"."answer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_schedule_workspace_idx" ON "app"."report_schedule" USING btree ("workspace_id","user_id");--> statement-breakpoint
ALTER TABLE "app"."email_delivery" ADD CONSTRAINT "email_delivery_kind_check" CHECK (kind in ('weekly_summary', 'urgent_alert', 'report'));