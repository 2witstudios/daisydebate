CREATE TABLE "necessary_evidence_round_fences" (
	"round_id" text PRIMARY KEY,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD COLUMN "execution_worker_id" text;--> statement-breakpoint
CREATE INDEX "necessary_evidence_original_round_idx" ON "necessary_evidence" ("original_round_id");--> statement-breakpoint
ALTER TABLE "necessary_evidence_round_fences" ADD CONSTRAINT "necessary_evidence_round_fences_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_execution_worker_check" CHECK ("execution_worker_id" is null or "execution_worker_id" ~ '^[a-z0-9]{24}$');