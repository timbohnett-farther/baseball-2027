CREATE TABLE "user_custom_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" text NOT NULL,
	"number" integer NOT NULL,
	"position" text NOT NULL,
	"bats" text NOT NULL,
	"look" jsonb NOT NULL,
	"ratings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_custom_players_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
ALTER TABLE "user_custom_players" ADD CONSTRAINT "user_custom_players_team_id_user_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."user_teams"("id") ON DELETE cascade ON UPDATE no action;
