CREATE TABLE "round_finalization_ballots" (
	"ballot_id" text PRIMARY KEY,
	"round_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_finalizations" (
	"round_id" text PRIMARY KEY,
	"command_id" text NOT NULL,
	"resulting_version" integer NOT NULL,
	"freeze_revision" integer
);
--> statement-breakpoint
ALTER TABLE "round_finalization_ballots" ADD CONSTRAINT "round_finalization_ballots_ballot_id_ballots_id_fkey" FOREIGN KEY ("ballot_id") REFERENCES "ballots"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_finalization_ballots" ADD CONSTRAINT "round_finalization_ballots_uSPr4xzzw1qM_fkey" FOREIGN KEY ("round_id") REFERENCES "round_finalizations"("round_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_finalizations" ADD CONSTRAINT "round_finalizations_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_finalizations" ADD CONSTRAINT "round_finalizations_command_fk" FOREIGN KEY ("command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_finalizations" ADD CONSTRAINT "round_finalizations_freeze_fk" FOREIGN KEY ("round_id","freeze_revision") REFERENCES "round_transcript_freezes"("round_id","revision");