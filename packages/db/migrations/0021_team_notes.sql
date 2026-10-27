CREATE TABLE "app"."note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_subject_check" CHECK (subject_kind in ('insight', 'answer')),
	CONSTRAINT "note_body_check" CHECK (char_length("app"."note"."body") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "app"."insight" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "app"."insight" ADD COLUMN "assigned_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."insight" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."note" ADD CONSTRAINT "note_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."note" ADD CONSTRAINT "note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_subject_idx" ON "app"."note" USING btree ("workspace_id","subject_kind","subject_id","created_at");--> statement-breakpoint
ALTER TABLE "app"."insight" ADD CONSTRAINT "insight_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."insight" ADD CONSTRAINT "insight_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insight_assigned_idx" ON "app"."insight" USING btree ("workspace_id","assigned_to");