-- Pre-ship rows from before opponents existed take the default bot.
ALTER TABLE "ai_debates" ADD COLUMN "opponent" text;--> statement-breakpoint
UPDATE "ai_debates" SET "opponent" = 'wren' WHERE "opponent" IS NULL;--> statement-breakpoint
ALTER TABLE "ai_debates" ALTER COLUMN "opponent" SET NOT NULL;
