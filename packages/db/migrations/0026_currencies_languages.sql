CREATE TABLE "app"."user_preference" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"language" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preference_language_check" CHECK ("app"."user_preference"."language" is null or language in ('en', 'es'))
);
--> statement-breakpoint
CREATE TABLE "app"."fx_rate" (
	"day" date NOT NULL,
	"currency" char(3) NOT NULL,
	"per_eur" numeric(18, 8) NOT NULL,
	CONSTRAINT "fx_rate_day_currency_pk" PRIMARY KEY("day","currency")
);
--> statement-breakpoint
ALTER TABLE "app"."workspace_settings" ADD COLUMN "converted_currencies" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."workspace_settings" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspace_settings" ADD CONSTRAINT "workspace_settings_language_check" CHECK (language in ('en', 'es'));