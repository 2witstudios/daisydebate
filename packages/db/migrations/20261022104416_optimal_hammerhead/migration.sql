ALTER TABLE "utterances" DROP CONSTRAINT "utterances_generation_pair";--> statement-breakpoint
ALTER TABLE "utterances" DROP COLUMN "generation_token";--> statement-breakpoint
ALTER TABLE "utterances" DROP COLUMN "generation_expires_at";