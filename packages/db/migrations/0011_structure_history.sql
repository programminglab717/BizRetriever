CREATE TABLE "app"."snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"migration_id" uuid NOT NULL,
	"objects" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dropped_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."migration" ADD COLUMN "catalog_before" jsonb;--> statement-breakpoint
ALTER TABLE "app"."migration" ADD COLUMN "undoes_version" integer;--> statement-breakpoint
ALTER TABLE "app"."migration" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."snapshot" ADD CONSTRAINT "snapshot_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."snapshot" ADD CONSTRAINT "snapshot_migration_id_migration_id_fk" FOREIGN KEY ("migration_id") REFERENCES "app"."migration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshot_migration_idx" ON "app"."snapshot" USING btree ("migration_id");--> statement-breakpoint
CREATE INDEX "snapshot_expiry_idx" ON "app"."snapshot" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "app"."migration" ADD CONSTRAINT "migration_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;