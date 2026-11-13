ALTER TABLE "games" ADD COLUMN "client_game_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "games_user_client_game_idx" ON "games" USING btree ("user_id","client_game_id");