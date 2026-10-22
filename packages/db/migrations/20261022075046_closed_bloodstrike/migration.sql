CREATE TABLE "media_vendor_mutations" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"kind" text NOT NULL,
	"identity" text,
	"dispatched_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"settled_at" timestamp with time zone,
	"outcome" text,
	"payload" jsonb NOT NULL,
	CONSTRAINT "media_vendor_mutations_epoch_check" CHECK ("epoch" >= 0),
	CONSTRAINT "media_vendor_mutations_kind_check" CHECK ("kind" in ('create','permissions','remove','delete')),
	CONSTRAINT "media_vendor_mutations_identity_check" CHECK (("identity" is not null) = ("kind" in ('permissions','remove'))),
	CONSTRAINT "media_vendor_mutations_settlement_check" CHECK (("settled_at" is null) = ("outcome" is null) and ("outcome" is null or "outcome" in ('succeeded','failed')) and ("settled_at" is null or "settled_at" >= "dispatched_at")),
	CONSTRAINT "media_vendor_mutations_payload_check" CHECK (case when "kind" = 'permissions' then
    jsonb_typeof("payload") = 'object'
    and "payload" ?& array['publish','subscribe','hidden','capture']
    and ("payload" - 'publish' - 'subscribe' - 'hidden' - 'capture') = '{}'::jsonb
    and case when jsonb_typeof("payload"->'publish') = 'array' then
      jsonb_array_length("payload"->'publish') <= 2
      and ("payload"->'publish') <@ '["camera","microphone"]'::jsonb
      and (jsonb_array_length("payload"->'publish') < 2 or "payload"->'publish'->0 is distinct from "payload"->'publish'->1)
    else false end
    and jsonb_typeof("payload"->'subscribe') = 'boolean'
    and jsonb_typeof("payload"->'hidden') = 'boolean'
    and "payload"->'capture' = 'false'::jsonb
    else "payload" = '{}'::jsonb end)
);
--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "reconcile_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "reconcile_request_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "reconcile_running_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "reconcile_served_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "reconcile_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "reconcile_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "reconcile_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "reconcile_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "reconcile_owner" text;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "unsafe_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "media_vendor_mutations_session_settled_idx" ON "media_vendor_mutations" ("session_id","settled_at");--> statement-breakpoint
CREATE INDEX "media_vendor_mutations_pending_idx" ON "media_vendor_mutations" ("session_id","dispatched_at") WHERE "settled_at" is null;--> statement-breakpoint
ALTER TABLE "media_vendor_mutations" ADD CONSTRAINT "media_vendor_mutations_session_id_media_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "media_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD CONSTRAINT "media_sessions_reconcile_versions_check" CHECK ("reconcile_epoch" >= 0 and "reconcile_served_version" >= 0 and "reconcile_running_version" >= "reconcile_served_version" and "reconcile_request_version" >= "reconcile_running_version");--> statement-breakpoint
ALTER TABLE "media_sessions" ADD CONSTRAINT "media_sessions_reconcile_lease_check" CHECK (("reconcile_owner" is null) = ("reconcile_lease_until" is null));--> statement-breakpoint
CREATE FUNCTION guard_media_vendor_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.settled_at IS NULL AND EXISTS (SELECT 1 FROM media_sessions WHERE id=OLD.session_id) THEN
      RAISE EXCEPTION 'Pending vendor intent cannot be erased' USING ERRCODE='23514', CONSTRAINT='media_vendor_mutations_pending';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id,NEW.session_id,NEW.epoch,NEW.kind,NEW.identity,NEW.dispatched_at,NEW.payload)
    IS DISTINCT FROM ROW(OLD.id,OLD.session_id,OLD.epoch,OLD.kind,OLD.identity,OLD.dispatched_at,OLD.payload)
    OR OLD.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Vendor intent and known outcomes are immutable' USING ERRCODE='23514', CONSTRAINT='media_vendor_mutations_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_vendor_mutation_guard BEFORE UPDATE OR DELETE ON media_vendor_mutations FOR EACH ROW EXECUTE FUNCTION guard_media_vendor_mutation();
--> statement-breakpoint
CREATE FUNCTION guard_media_session_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reconcile_epoch < OLD.reconcile_epoch
    OR NEW.reconcile_request_version < OLD.reconcile_request_version
    OR NEW.reconcile_running_version < OLD.reconcile_running_version
    OR NEW.reconcile_served_version < OLD.reconcile_served_version THEN
    RAISE EXCEPTION 'Reconciliation fences cannot decrease' USING ERRCODE='23514', CONSTRAINT='media_sessions_reconcile_epoch_immutable';
  END IF;
  IF OLD.unsafe_at IS NOT NULL AND NEW.unsafe_at IS NULL
    AND EXISTS (SELECT 1 FROM media_vendor_mutations WHERE session_id=OLD.id AND settled_at IS NULL) THEN
    RAISE EXCEPTION 'Unresolved vendor intent blocks reopening' USING ERRCODE='23514', CONSTRAINT='media_sessions_pending_unsafe';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_session_reconciliation_guard BEFORE UPDATE ON media_sessions FOR EACH ROW EXECUTE FUNCTION guard_media_session_reconciliation();
