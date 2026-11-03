CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"opponent_team_id" integer NOT NULL,
	"seed" integer NOT NULL,
	"innings" integer NOT NULL,
	"user_side" text NOT NULL,
	"teams" jsonb NOT NULL,
	"user_score" integer NOT NULL,
	"opponent_score" integer NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_team_id_user_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."user_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_opponent_team_id_mlb_teams_id_fk" FOREIGN KEY ("opponent_team_id") REFERENCES "public"."mlb_teams"("id") ON DELETE no action ON UPDATE no action;