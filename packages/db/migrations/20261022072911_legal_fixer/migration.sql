CREATE TABLE "round_attendance_adjudications" (
	"segment_id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"command_id" text NOT NULL,
	"decision" text NOT NULL,
	"effective_deadline" timestamp with time zone NOT NULL,
	"settled_horizon" timestamp with time zone NOT NULL,
	CONSTRAINT "round_attendance_adjudications_decision_check" CHECK ("decision" in ('attended', 'none', 'forfeit', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "round_check_in_attempts" (
	"attempt_id" text PRIMARY KEY,
	"command_id" text NOT NULL,
	"round_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"backend_pid" integer NOT NULL,
	"backend_started_at" timestamp with time zone NOT NULL,
	"payload_digest" text NOT NULL,
	"actor_id" text,
	"service_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "round_check_in_attempts_state_check" CHECK ("state" in ('pending', 'committed', 'aborted')),
	CONSTRAINT "round_check_in_attempts_resolved_check" CHECK (("state"='pending' and "resolved_at" is null) or ("state"<>'pending' and "resolved_at" is not null)),
	CONSTRAINT "round_check_in_attempts_resolved_after_received" CHECK ("resolved_at" is null or "resolved_at" >= "received_at"),
	CONSTRAINT "round_check_in_attempts_backend_check" CHECK ("backend_pid">0),
	CONSTRAINT "round_check_in_attempts_digest_check" CHECK ("payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "round_check_in_attempts_one_principal" CHECK (("actor_id" is null) <> ("service_id" is null))
);
--> statement-breakpoint
CREATE TABLE "round_check_ins" (
	"command_id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_samples" (
	"at" timestamp with time zone PRIMARY KEY DEFAULT statement_timestamp(),
	"healthy" boolean NOT NULL,
	"cause" text,
	CONSTRAINT "availability_samples_cause_check" CHECK (("healthy" and "cause" is null) or (not "healthy" and "cause" is not null and "cause" in ('web_stale', 'realtime_stale', 'delivery_lag', 'public_probe_failed', 'control_worker_unknown', 'check_in_pending')))
);
--> statement-breakpoint
CREATE TABLE "service_instances" (
	"instance_id" text PRIMARY KEY,
	"role" text NOT NULL,
	"renewed_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"delivered_through" bigint,
	"delivered_through_txid" xid8,
	CONSTRAINT "service_instances_role_check" CHECK ("role" in ('web', 'realtime')),
	CONSTRAINT "service_instances_cursor_check" CHECK (("role"='web' and "delivered_through" is null and "delivered_through_txid" is null) or ("role"='realtime' and "delivered_through" is not null and "delivered_through" >= 0 and "delivered_through_txid" is not null and "delivered_through_txid"::text ~ '^[0-9]+$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "round_attendance_adjudications_command_unique" ON "round_attendance_adjudications" ("command_id");--> statement-breakpoint
CREATE INDEX "round_attendance_adjudications_command_round_idx" ON "round_attendance_adjudications" ("command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_attendance_adjudications_segment_round_idx" ON "round_attendance_adjudications" ("segment_id","round_id");--> statement-breakpoint
CREATE INDEX "round_attendance_adjudications_round_idx" ON "round_attendance_adjudications" ("round_id");--> statement-breakpoint
CREATE INDEX "round_check_in_attempts_round_state_idx" ON "round_check_in_attempts" ("round_id","state");--> statement-breakpoint
CREATE INDEX "round_check_in_attempts_pending_idx" ON "round_check_in_attempts" ("round_id","received_at") WHERE "state"='pending';--> statement-breakpoint
CREATE INDEX "round_check_in_attempts_command_round_idx" ON "round_check_in_attempts" ("command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_check_in_attempts_actor_idx" ON "round_check_in_attempts" ("actor_id");--> statement-breakpoint
CREATE INDEX "round_check_in_attempts_resolved_idx" ON "round_check_in_attempts" ("resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "round_check_ins_first_stamp_unique" ON "round_check_ins" ("round_id","segment_id","participant_id");--> statement-breakpoint
CREATE INDEX "round_check_ins_command_round_idx" ON "round_check_ins" ("command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_check_ins_segment_round_idx" ON "round_check_ins" ("segment_id","round_id");--> statement-breakpoint
CREATE INDEX "round_check_ins_participant_round_idx" ON "round_check_ins" ("participant_id","round_id");--> statement-breakpoint
CREATE INDEX "service_instances_renewed_idx" ON "service_instances" ("renewed_at");--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD CONSTRAINT "round_attendance_adjudications_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD CONSTRAINT "round_attendance_adjudications_command_round_fk" FOREIGN KEY ("command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD CONSTRAINT "round_attendance_adjudications_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_check_in_attempts" ADD CONSTRAINT "round_check_in_attempts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_check_in_attempts" ADD CONSTRAINT "round_check_in_attempts_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id");--> statement-breakpoint
ALTER TABLE "round_check_ins" ADD CONSTRAINT "round_check_ins_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_check_ins" ADD CONSTRAINT "round_check_ins_command_round_fk" FOREIGN KEY ("command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_check_ins" ADD CONSTRAINT "round_check_ins_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_check_ins" ADD CONSTRAINT "round_check_ins_participant_round_fk" FOREIGN KEY ("participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_commands" ADD CONSTRAINT "round_commands_attendance_principal_check" CHECK ("type" <> 'adjudicate' or ("actor_id" is null and "service_id" ~ '^round-attendance:[a-z0-9]{24}$'));--> statement-breakpoint
ALTER TABLE "round_commands" DROP CONSTRAINT "round_commands_type_check", ADD CONSTRAINT "round_commands_type_check" CHECK ("type" in ('start', 'start_prep', 'end_prep', 'start_speech', 'yield', 'interrupt', 'forfeit', 'complete', 'submit_ballot', 'check_in', 'adjudicate'));
--> statement-breakpoint
ALTER TABLE round_attendance_adjudications ALTER CONSTRAINT round_attendance_adjudications_command_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_attendance_adjudications ALTER CONSTRAINT round_attendance_adjudications_segment_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_check_ins ALTER CONSTRAINT round_check_ins_command_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_check_ins ALTER CONSTRAINT round_check_ins_segment_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_check_ins ALTER CONSTRAINT round_check_ins_participant_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_check_in_attempts ALTER CONSTRAINT round_check_in_attempts_actor_id_actors_id_fkey DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION bind_service_instance_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     (NEW.instance_id IS DISTINCT FROM OLD.instance_id OR NEW.role IS DISTINCT FROM OLD.role) THEN
    RAISE EXCEPTION 'Service instance identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'service_instances_identity_immutable';
  END IF;
  IF (current_user = 'daisy_realtime' AND
        (NEW.role <> 'realtime' OR (TG_OP = 'UPDATE' AND OLD.role <> 'realtime'))) OR
     (current_user = 'daisy_web' AND
        (NEW.role <> 'web' OR (TG_OP = 'UPDATE' AND OLD.role <> 'web'))) THEN
    RAISE EXCEPTION 'Service role cannot impersonate a peer role' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER service_instances_role_binding BEFORE INSERT OR UPDATE ON service_instances
FOR EACH ROW EXECUTE FUNCTION bind_service_instance_role();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON service_instances TO daisy_realtime;
--> statement-breakpoint
CREATE FUNCTION guard_availability_sample() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Availability history is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'availability_samples_immutable';
  END IF;
  IF NOT pg_try_advisory_xact_lock(59003) THEN
    RAISE EXCEPTION 'Availability sampler is already elected' USING ERRCODE = '55P03';
  END IF;
  IF NEW.at <= (SELECT max(at) FROM availability_samples) THEN
    RAISE EXCEPTION 'Availability time must advance'
      USING ERRCODE = '23514', CONSTRAINT = 'availability_samples_monotone';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER availability_samples_order BEFORE INSERT OR UPDATE ON availability_samples
FOR EACH ROW EXECUTE FUNCTION guard_availability_sample();
--> statement-breakpoint
CREATE FUNCTION guard_round_attendance_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_type text;
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM rounds WHERE id=OLD.round_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Round attendance evidence is immutable'
      USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_immutable';
  END IF;
  expected_type := CASE WHEN TG_TABLE_NAME = 'round_check_ins' THEN 'check_in' ELSE 'adjudicate' END;
  IF NOT EXISTS (SELECT 1 FROM round_commands c WHERE c.command_id=NEW.command_id
    AND c.round_id=NEW.round_id AND c.type=expected_type) THEN
    RAISE EXCEPTION 'Attendance receipt type is not authoritative'
      USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_receipt_type';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_check_ins_immutable BEFORE INSERT OR UPDATE OR DELETE ON round_check_ins
FOR EACH ROW EXECUTE FUNCTION guard_round_attendance_fact();
--> statement-breakpoint
CREATE TRIGGER round_attendance_adjudications_immutable BEFORE INSERT OR UPDATE OR DELETE ON round_attendance_adjudications
FOR EACH ROW EXECUTE FUNCTION guard_round_attendance_fact();
--> statement-breakpoint
CREATE FUNCTION guard_round_check_in_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'pending' AND EXISTS (SELECT 1 FROM rounds WHERE id=OLD.round_id) THEN
      RAISE EXCEPTION 'An unresolved check-in attempt cannot be pruned'
        USING ERRCODE = '23514', CONSTRAINT = 'round_check_in_attempts_pending';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state <> 'pending' OR NEW.state = 'pending' OR
     ROW(NEW.attempt_id,NEW.command_id,NEW.round_id,NEW.received_at,NEW.backend_pid,
         NEW.backend_started_at,NEW.payload_digest,NEW.actor_id,NEW.service_id) IS DISTINCT FROM
     ROW(OLD.attempt_id,OLD.command_id,OLD.round_id,OLD.received_at,OLD.backend_pid,
         OLD.backend_started_at,OLD.payload_digest,OLD.actor_id,OLD.service_id) THEN
    RAISE EXCEPTION 'Check-in attempt identity and resolved outcome are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'round_check_in_attempts_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_check_in_attempts_resolution BEFORE UPDATE OR DELETE ON round_check_in_attempts
FOR EACH ROW EXECUTE FUNCTION guard_round_check_in_attempt();
