ALTER TABLE "season_games" ADD COLUMN "stars" jsonb;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "format" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "league" jsonb;