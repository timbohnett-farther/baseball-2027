CREATE TABLE "season_games" (
	"season_id" integer NOT NULL,
	"game_no" integer NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"opponent_team_id" integer NOT NULL,
	"game_id" integer,
	"result" text,
	CONSTRAINT "season_games_season_id_game_no_pk" PRIMARY KEY("season_id","game_no")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"number" integer NOT NULL,
	"seed" integer NOT NULL,
	"status" text DEFAULT 'regular' NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"ties" integer DEFAULT 0 NOT NULL,
	"playoff_round" integer DEFAULT 0 NOT NULL,
	"playoff_wins" integer DEFAULT 0 NOT NULL,
	"playoff_losses" integer DEFAULT 0 NOT NULL,
	"reward_coins" integer DEFAULT 0 NOT NULL,
	"champion" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "season_games" ADD CONSTRAINT "season_games_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_games" ADD CONSTRAINT "season_games_opponent_team_id_mlb_teams_id_fk" FOREIGN KEY ("opponent_team_id") REFERENCES "public"."mlb_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_games" ADD CONSTRAINT "season_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_team_id_user_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."user_teams"("id") ON DELETE cascade ON UPDATE no action;