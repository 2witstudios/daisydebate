DROP TABLE "round_bot_publication_windows";--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "bot_phrase_id" text;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "bot_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "interrupted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "utterances_bot_phrase_unique" ON "utterances" ("bot_phrase_id");--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_source_check" CHECK (("bot_phrase_id" is null or "clip_key" is null) and ("bot_phrase_id" is not null or not "interrupted"));--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_bot_phrase_check" CHECK (("bot_phrase_id" is null and "bot_duration_ms" is null) or (char_length("bot_phrase_id") between 1 and 64 and "bot_duration_ms" > 0 and "bot_duration_ms" <= 60000));