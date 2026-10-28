CREATE TABLE "app"."note_mention" (
	"note_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_mention_note_id_user_id_pk" PRIMARY KEY("note_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."ownership_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decision" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "ownership_transfer_decision_check" CHECK ("app"."ownership_transfer"."decision" is null or "app"."ownership_transfer"."decision" in ('accepted', 'declined', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "app"."email_delivery" DROP CONSTRAINT "email_delivery_kind_check";--> statement-breakpoint
ALTER TABLE "app"."email_preference" ADD COLUMN "mentions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."note_mention" ADD CONSTRAINT "note_mention_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "app"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."note_mention" ADD CONSTRAINT "note_mention_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."note_mention" ADD CONSTRAINT "note_mention_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ownership_transfer" ADD CONSTRAINT "ownership_transfer_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ownership_transfer" ADD CONSTRAINT "ownership_transfer_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ownership_transfer" ADD CONSTRAINT "ownership_transfer_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_mention_user_idx" ON "app"."note_mention" USING btree ("workspace_id","user_id","seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_transfer_waiting_idx" ON "app"."ownership_transfer" USING btree ("workspace_id") WHERE "app"."ownership_transfer"."decision" is null;--> statement-breakpoint
-- One owner per business (M19). Any business with more than one keeps its earliest owner; the
-- others become members, so the index below can be made.
UPDATE "app"."workspace_member" m SET "role" = 'member'
WHERE m."role" = 'owner' AND EXISTS (
  SELECT 1 FROM "app"."workspace_member" o
  WHERE o."workspace_id" = m."workspace_id" AND o."role" = 'owner'
    AND (o."created_at", o."user_id") < (m."created_at", m."user_id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_member_one_owner_idx" ON "app"."workspace_member" USING btree ("workspace_id") WHERE "app"."workspace_member"."role" = 'owner';--> statement-breakpoint
ALTER TABLE "app"."email_delivery" ADD CONSTRAINT "email_delivery_kind_check" CHECK (kind in ('weekly_summary', 'urgent_alert', 'report', 'mention', 'ownership'));