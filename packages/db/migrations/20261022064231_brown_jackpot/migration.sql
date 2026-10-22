CREATE TABLE "round_bot_publications" (
	"round_id" text,
	"round_participant_id" text,
	"segment_id" text NOT NULL,
	"agent_run_id" text NOT NULL,
	"service_id" text NOT NULL,
	"publication_epoch" integer NOT NULL,
	"lease_token_digest" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_bot_publications_pkey" PRIMARY KEY("round_id","round_participant_id"),
	CONSTRAINT "round_bot_publications_epoch_check" CHECK ("publication_epoch" > 0),
	CONSTRAINT "round_bot_publications_digest_check" CHECK ("lease_token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "round_bot_publications_service_check" CHECK ("service_id" = 'agent-run:' || "agent_run_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_id_participant_unique" ON "agent_runs" ("id","round_participant_id");--> statement-breakpoint
CREATE INDEX "round_bot_publications_seat_round_idx" ON "round_bot_publications" ("round_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "round_bot_publications_segment_round_idx" ON "round_bot_publications" ("segment_id","round_id");--> statement-breakpoint
CREATE INDEX "round_bot_publications_run_seat_idx" ON "round_bot_publications" ("agent_run_id","round_participant_id");--> statement-breakpoint
ALTER TABLE "round_bot_publications" ADD CONSTRAINT "round_bot_publications_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_bot_publications" ADD CONSTRAINT "round_bot_publications_seat_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_bot_publications" ADD CONSTRAINT "round_bot_publications_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_bot_publications" ADD CONSTRAINT "round_bot_publications_run_seat_fk" FOREIGN KEY ("agent_run_id","round_participant_id") REFERENCES "agent_runs"("id","round_participant_id");
--> statement-breakpoint
ALTER TABLE round_bot_publications ALTER CONSTRAINT round_bot_publications_seat_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_bot_publications ALTER CONSTRAINT round_bot_publications_segment_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_bot_publications ALTER CONSTRAINT round_bot_publications_run_seat_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION fence_bot_publication_epoch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.round_id IS DISTINCT FROM OLD.round_id OR
     NEW.round_participant_id IS DISTINCT FROM OLD.round_participant_id THEN
    RAISE EXCEPTION 'Publication seat identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'round_bot_publications_identity_immutable';
  END IF;
  IF NEW.publication_epoch < OLD.publication_epoch OR
     (NEW.publication_epoch = OLD.publication_epoch AND
       (NEW.segment_id IS DISTINCT FROM OLD.segment_id OR
        NEW.agent_run_id IS DISTINCT FROM OLD.agent_run_id OR
        NEW.service_id IS DISTINCT FROM OLD.service_id OR
        NEW.lease_token_digest IS DISTINCT FROM OLD.lease_token_digest)) OR
     (NEW.publication_epoch > OLD.publication_epoch AND
       (NEW.publication_epoch::bigint <> OLD.publication_epoch::bigint + 1 OR
        NEW.agent_run_id = OLD.agent_run_id OR
        NEW.lease_token_digest = OLD.lease_token_digest)) THEN
    RAISE EXCEPTION 'Publication epoch must preserve identity or advance once for a new run'
      USING ERRCODE = '23514', CONSTRAINT = 'round_bot_publications_epoch_immutable';
  END IF;
  IF NEW.publication_epoch = OLD.publication_epoch AND
     OLD.lease_expires_at <= clock_timestamp() AND
     NEW.lease_expires_at > OLD.lease_expires_at THEN
    RAISE EXCEPTION 'An expired publication lease cannot be renewed'
      USING ERRCODE = '23514', CONSTRAINT = 'round_bot_publications_lease_revoked';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_bot_publications_epoch_fence
BEFORE UPDATE ON round_bot_publications
FOR EACH ROW EXECUTE FUNCTION fence_bot_publication_epoch();
