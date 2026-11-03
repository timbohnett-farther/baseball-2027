CREATE TABLE "data_refreshes" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats_season" integer,
	"player_count" integer,
	"ok" boolean DEFAULT false NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "mlb_teams" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text NOT NULL,
	"league" text NOT NULL,
	"division" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_ratings" (
	"player_id" integer NOT NULL,
	"season" integer NOT NULL,
	"overall" integer NOT NULL,
	"role" text NOT NULL,
	"hitting" jsonb,
	"pitching" jsonb,
	"sample" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_ratings_player_id_season_pk" PRIMARY KEY("player_id","season")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"jersey" text,
	"position" text NOT NULL,
	"bats" text,
	"throws" text,
	"age" integer,
	"birth_date" text,
	"birth_country" text,
	"height" text,
	"weight" integer,
	"mlb_debut" text,
	"team_id" integer,
	"status" text NOT NULL,
	"in_pool" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_mlb_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."mlb_teams"("id") ON DELETE no action ON UPDATE no action;