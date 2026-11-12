CREATE TABLE "user_items" (
	"user_id" integer NOT NULL,
	"item_id" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_items_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "coins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_teams" ADD COLUMN "gear" jsonb;--> statement-breakpoint
ALTER TABLE "user_items" ADD CONSTRAINT "user_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;