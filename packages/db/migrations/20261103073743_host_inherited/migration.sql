ALTER TABLE "rooms" ADD COLUMN "host_inherited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "host_inherited" boolean DEFAULT false NOT NULL;