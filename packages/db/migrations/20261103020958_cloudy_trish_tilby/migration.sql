CREATE TABLE "spectator_fact_releases" (
	"round_id" text,
	"kind" text,
	"fact_id" text,
	"captured_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone NOT NULL,
	"watermark_at" timestamp with time zone,
	CONSTRAINT "spectator_fact_releases_pkey" PRIMARY KEY("round_id","kind","fact_id"),
	CONSTRAINT "spectator_fact_releases_kind_check" CHECK ("kind" in ('stage', 'result', 'ballot', 'rating', 'caption')),
	CONSTRAINT "spectator_fact_releases_after_capture_check" CHECK ("released_at" >= "captured_at")
);
--> statement-breakpoint
CREATE INDEX "spectator_fact_releases_round_idx" ON "spectator_fact_releases" ("round_id","released_at");--> statement-breakpoint
ALTER TABLE "spectator_fact_releases" ADD CONSTRAINT "spectator_fact_releases_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Hand-written part of the migration: add after the bun db:generate output for the table.
CREATE FUNCTION guard_spectator_fact_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The Round's own erasure cascades here after its row is gone.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM rounds WHERE id = OLD.round_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'The spectator fact log is append-only'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'spectator_fact_releases_append_only';
END $$;
CREATE TRIGGER spectator_fact_releases_append_only
  BEFORE UPDATE OR DELETE ON spectator_fact_releases
  FOR EACH ROW EXECUTE FUNCTION guard_spectator_fact_release();
