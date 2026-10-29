ALTER TABLE "round_finalization_ballots" DROP CONSTRAINT "round_finalization_ballots_uSPr4xzzw1qM_fkey";--> statement-breakpoint
ALTER TABLE "round_finalization_ballots" ADD COLUMN "freeze_revision" integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ballots_finalization_reference" ON "ballots" ("id","round_id","freeze_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "round_commands_finalization_reference" ON "round_commands" ("command_id","round_id","resulting_version");--> statement-breakpoint
CREATE INDEX "round_finalization_ballots_round_idx" ON "round_finalization_ballots" ("round_id","freeze_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "round_finalizations_round_freeze" ON "round_finalizations" ("round_id","freeze_revision");--> statement-breakpoint
CREATE INDEX "round_finalizations_command_idx" ON "round_finalizations" ("command_id","round_id","resulting_version");--> statement-breakpoint
ALTER TABLE "round_finalization_ballots" ADD CONSTRAINT "round_finalization_ballots_input_fk" FOREIGN KEY ("round_id","freeze_revision") REFERENCES "round_finalizations"("round_id","freeze_revision");--> statement-breakpoint
ALTER TABLE "round_finalization_ballots" ADD CONSTRAINT "round_finalization_ballots_membership_fk" FOREIGN KEY ("ballot_id","round_id","freeze_revision") REFERENCES "ballots"("id","round_id","freeze_revision");--> statement-breakpoint
ALTER TABLE "round_finalizations" DROP CONSTRAINT "round_finalizations_command_fk", ADD CONSTRAINT "round_finalizations_command_fk" FOREIGN KEY ("command_id","round_id","resulting_version") REFERENCES "round_commands"("command_id","round_id","resulting_version");--> statement-breakpoint
ALTER TABLE "round_finalizations" ADD CONSTRAINT "round_finalizations_version_positive" CHECK ("resulting_version" > 0);
--> statement-breakpoint
-- Finalization provenance is append-only to the runtime role. Test/migration
-- operators retain cleanup authority over their isolated databases.
REVOKE UPDATE, DELETE ON round_finalizations, round_finalization_ballots FROM daisy_web;
