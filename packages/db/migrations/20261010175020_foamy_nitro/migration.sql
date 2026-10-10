DROP INDEX "rooms_discovery_assembly_idx";--> statement-breakpoint
CREATE INDEX "rooms_discovery_assembly_idx" ON "rooms" ("id" collate "C") WHERE "status" in ('assembling', 'ready');--> statement-breakpoint
DROP INDEX "rounds_discovery_live_room_idx";--> statement-breakpoint
CREATE INDEX "rounds_discovery_live_room_idx" ON "rounds" ("room_id" collate "C") WHERE "status" in ('scheduled', 'active') and "room_id" is not null;