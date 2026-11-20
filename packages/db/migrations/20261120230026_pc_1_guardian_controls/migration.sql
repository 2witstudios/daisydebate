CREATE TABLE "child_account_requests" (
	"id" text PRIMARY KEY,
	"guardian_user_id" text NOT NULL,
	"guardian_consent_id" text NOT NULL,
	"guardian_role" text GENERATED ALWAYS AS ('guardian') STORED NOT NULL,
	"first_name" text,
	"birth_month" text,
	"email" text,
	"status" text NOT NULL,
	"claimed_user_id" text,
	"requested_link_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "child_requests_status_check" CHECK ("status" in ('open', 'claimed', 'linked', 'cancelled')),
	CONSTRAINT "child_requests_state_check" CHECK (("status" = 'open') = ("closed_at" is null)
        and ("status" = 'claimed') = ("claimed_user_id" is not null)
        and (("status" in ('open', 'linked')) = (num_nonnulls("first_name", "birth_month", "email") = 3))
        and (num_nonnulls("first_name", "birth_month", "email") in (0, 3))
        and ("requested_link_id" is null or "status" in ('linked', 'cancelled'))
        and "claimed_user_id" is distinct from "guardian_user_id"
        and "expires_at" > "created_at"
        and ("closed_at" is null or "closed_at" >= "created_at")),
	CONSTRAINT "child_requests_details_check" CHECK (char_length("first_name") between 1 and 40
        and "birth_month" ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
        and "email" = lower(btrim("email")))
);
--> statement-breakpoint
CREATE TABLE "guardian_consent_evidence" (
	"id" text PRIMARY KEY,
	"person_user_id" text NOT NULL,
	"role" text NOT NULL,
	"method" text NOT NULL,
	"notice_kind" text NOT NULL,
	"notice_version" text NOT NULL,
	"notice_digest" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guardian_evidence_signer_unique" UNIQUE("id","person_user_id","role"),
	CONSTRAINT "guardian_evidence_method_check" CHECK ("method" in ('created-account', 'requested-link', 'confirmed-link')),
	CONSTRAINT "guardian_evidence_notice_check" CHECK (("role" = 'guardian' and "notice_kind" = 'parental-consent' and "method" <> 'confirmed-link')
        or ("role" = 'child' and "notice_kind" = 'child-confirmation' and "method" = 'confirmed-link')),
	CONSTRAINT "guardian_evidence_version_check" CHECK (char_length("notice_version") between 1 and 40),
	CONSTRAINT "guardian_evidence_digest_check" CHECK ("notice_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "guardian_links" DROP CONSTRAINT "guardian_links_via_school_fk";--> statement-breakpoint
ALTER TABLE "restriction_lobbies" DROP CONSTRAINT "restriction_lobbies_restriction_fk";--> statement-breakpoint
DROP TABLE "restrictions";--> statement-breakpoint
ALTER TABLE "guardian_links" DROP CONSTRAINT "guardian_links_id_people_kind_unique";--> statement-breakpoint
ALTER TABLE "guardian_links" DROP CONSTRAINT "guardian_links_kind_check";--> statement-breakpoint
ALTER TABLE "guardian_links" DROP CONSTRAINT "guardian_links_coach_via_school";--> statement-breakpoint
ALTER TABLE "guardian_links" DROP CONSTRAINT "guardian_links_ended_consistent";--> statement-breakpoint
DROP INDEX "guardian_links_via_organization_idx";--> statement-breakpoint
DROP INDEX "restriction_lobbies_restriction_idx";--> statement-breakpoint
ALTER TABLE "guardian_links" ADD COLUMN "guardian_consent_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD COLUMN "guardian_role" text GENERATED ALWAYS AS ('guardian') STORED;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD COLUMN "child_confirmation_id" text;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD COLUMN "child_role" text GENERATED ALWAYS AS ('child') STORED;--> statement-breakpoint
ALTER TABLE "guardian_links" ALTER COLUMN "guardian_role" SET NOT NULL, ALTER COLUMN "child_role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD COLUMN "activation" text;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guardian_links" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "guardian_links" DROP COLUMN "via_organization_id";--> statement-breakpoint
ALTER TABLE "guardian_links" DROP COLUMN "via_organization_kind";--> statement-breakpoint
ALTER TABLE "guardian_links" DROP COLUMN "ended_at";--> statement-breakpoint
DROP INDEX "guardian_links_open_pair_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_links_open_pair_unique" ON "guardian_links" ("guardian_user_id","minor_user_id") WHERE "status" in ('requested', 'active');--> statement-breakpoint
DROP INDEX "reports_one_open_per_pair";--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_per_pair" ON "reports" ("reporter_actor_id","subject_actor_id") WHERE "closed_at" is null and "surface" <> 'guardian-link';--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_id_people_unique" UNIQUE("id","guardian_user_id","minor_user_id");--> statement-breakpoint
CREATE INDEX "child_requests_guardian_idx" ON "child_account_requests" ("guardian_user_id");--> statement-breakpoint
CREATE INDEX "child_requests_email_idx" ON "child_account_requests" ("email");--> statement-breakpoint
CREATE INDEX "child_requests_claimed_user_idx" ON "child_account_requests" ("claimed_user_id");--> statement-breakpoint
CREATE INDEX "child_requests_requested_link_idx" ON "child_account_requests" ("requested_link_id");--> statement-breakpoint
CREATE INDEX "child_requests_guardian_evidence_idx" ON "child_account_requests" ("guardian_consent_id","guardian_user_id","guardian_role");--> statement-breakpoint
CREATE INDEX "guardian_evidence_person_idx" ON "guardian_consent_evidence" ("person_user_id");--> statement-breakpoint
CREATE INDEX "guardian_links_guardian_evidence_idx" ON "guardian_links" ("guardian_consent_id","guardian_user_id","guardian_role");--> statement-breakpoint
CREATE INDEX "guardian_links_child_evidence_idx" ON "guardian_links" ("child_confirmation_id","minor_user_id","child_role");--> statement-breakpoint
CREATE INDEX "restriction_lobbies_link_idx" ON "restriction_lobbies" ("guardian_link_id","guardian_user_id","minor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_guardian_link_per_pair" ON "reports" ("reporter_actor_id","subject_actor_id") WHERE "closed_at" is null and "surface" = 'guardian-link';--> statement-breakpoint
ALTER TABLE "child_account_requests" ADD CONSTRAINT "child_account_requests_guardian_user_id_users_id_fkey" FOREIGN KEY ("guardian_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "child_account_requests" ADD CONSTRAINT "child_account_requests_claimed_user_id_users_id_fkey" FOREIGN KEY ("claimed_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "child_account_requests" ADD CONSTRAINT "child_account_requests_requested_link_id_guardian_links_id_fkey" FOREIGN KEY ("requested_link_id") REFERENCES "guardian_links"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "child_account_requests" ADD CONSTRAINT "child_requests_guardian_evidence_fk" FOREIGN KEY ("guardian_consent_id","guardian_user_id","guardian_role") REFERENCES "guardian_consent_evidence"("id","person_user_id","role") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "guardian_consent_evidence" ADD CONSTRAINT "guardian_consent_evidence_person_user_id_users_id_fkey" FOREIGN KEY ("person_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_guardian_evidence_fk" FOREIGN KEY ("guardian_consent_id","guardian_user_id","guardian_role") REFERENCES "guardian_consent_evidence"("id","person_user_id","role") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_child_evidence_fk" FOREIGN KEY ("child_confirmation_id","minor_user_id","child_role") REFERENCES "guardian_consent_evidence"("id","person_user_id","role") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "restriction_lobbies" ADD CONSTRAINT "restriction_lobbies_guardian_link_fk" FOREIGN KEY ("guardian_link_id","guardian_user_id","minor_user_id") REFERENCES "guardian_links"("id","guardian_user_id","minor_user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_activation_check" CHECK ("activation" in ('created-account', 'child-confirmed'));--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_state_check" CHECK (("status" in ('active', 'ended')) = ("activated_at" is not null)
        and ("activated_at" is null) = ("activation" is null)
        and (coalesce("activation" = 'child-confirmed', false)) = ("child_confirmation_id" is not null)
        and ("status" in ('refused', 'cancelled', 'ended')) = ("closed_at" is not null)
        and ("activated_at" is null or "activated_at" >= "created_at")
        and ("closed_at" is null or "closed_at" >= "created_at")
        and ("closed_at" is null or "closed_at" >= "activated_at"));--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_guardian_link_check" CHECK (("surface" = 'guardian-link') = ("reason" = 'not-my-parent'));--> statement-breakpoint
ALTER TABLE "guardian_links" DROP CONSTRAINT "guardian_links_status_check", ADD CONSTRAINT "guardian_links_status_check" CHECK ("status" in ('requested', 'active', 'refused', 'cancelled', 'ended'));--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_reason_check", ADD CONSTRAINT "reports_reason_check" CHECK ("reason" in ('harassment', 'hate', 'cheating', 'spam', 'other', 'not-my-parent'));--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_surface_check", ADD CONSTRAINT "reports_surface_check" CHECK ("surface" in ('people', 'profile', 'watch', 'guardian-link'));
--> statement-breakpoint
-- At most one invitation can claim an address at any instant.
-- An abandoned invitation stops reserving the address at its expiry.
ALTER TABLE "child_account_requests" ADD CONSTRAINT "child_requests_live_email_exclude"
  EXCLUDE USING gist (email WITH =, tstzrange(created_at, expires_at, '[)') WITH &&)
  WHERE (status = 'open');
--> statement-breakpoint
CREATE FUNCTION public.daisy_owns_guardian_request_email(candidate text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = public.daisy_subject_scope()
      AND email_verified AND email = candidate AND deleted_at IS NULL
  )
$$;
--> statement-breakpoint
CREATE FUNCTION public.daisy_owns_guardian_request_link(candidate text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.guardian_links
    WHERE id = candidate AND minor_user_id = public.daisy_subject_scope()
  )
$$;
--> statement-breakpoint
ALTER TABLE "guardian_consent_evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "child_account_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY "guardian_links_subject" ON "guardian_links";
--> statement-breakpoint
CREATE POLICY "guardian_links_subject" ON "guardian_links" FOR ALL
  USING ((guardian_user_id = daisy_subject_scope()) OR (minor_user_id = daisy_subject_scope()))
  WITH CHECK ((guardian_user_id = daisy_subject_scope()) OR (minor_user_id = daisy_subject_scope()));
--> statement-breakpoint
CREATE POLICY "guardian_consent_evidence_subject" ON "guardian_consent_evidence" FOR ALL
  USING (person_user_id = daisy_subject_scope())
  WITH CHECK (person_user_id = daisy_subject_scope());
--> statement-breakpoint
CREATE POLICY "child_account_requests_subject" ON "child_account_requests" FOR ALL
  USING ((guardian_user_id = daisy_subject_scope()) OR (claimed_user_id = daisy_subject_scope()) OR daisy_owns_guardian_request_email(email) OR daisy_owns_guardian_request_link(requested_link_id))
  WITH CHECK ((guardian_user_id = daisy_subject_scope()) OR (claimed_user_id = daisy_subject_scope()) OR daisy_owns_guardian_request_email(email) OR daisy_owns_guardian_request_link(requested_link_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "guardian_links", "child_account_requests" TO daisy_web;
--> statement-breakpoint
REVOKE DELETE ON "guardian_links", "child_account_requests" FROM daisy_web;
--> statement-breakpoint
GRANT SELECT, INSERT ON "guardian_consent_evidence" TO daisy_web;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "guardian_consent_evidence" FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_guardian_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514',
    CONSTRAINT = 'guardian_consent_evidence_immutable',
    MESSAGE = 'Guardian consent evidence cannot change';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guardian_consent_evidence_immutable
  BEFORE UPDATE OR DELETE ON "guardian_consent_evidence"
  FOR EACH ROW EXECUTE FUNCTION public.daisy_guardian_evidence_immutable();
--> statement-breakpoint
CREATE FUNCTION public.daisy_guardian_link_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  subject text := public.daisy_subject_scope();
BEGIN
  IF current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF (NEW.status = 'requested' AND NEW.guardian_user_id = subject AND NEW.version = 1)
      OR (NEW.status = 'active' AND NEW.activation = 'created-account' AND NEW.minor_user_id = subject
        AND NEW.version = 1 AND EXISTS (
          SELECT 1 FROM public.child_account_requests r
          WHERE r.status = 'claimed' AND r.claimed_user_id = subject
            AND r.guardian_user_id = NEW.guardian_user_id
            AND r.guardian_consent_id = NEW.guardian_consent_id
        )) THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.id = OLD.id AND NEW.guardian_user_id = OLD.guardian_user_id
    AND NEW.minor_user_id = OLD.minor_user_id
    AND NEW.guardian_consent_id = OLD.guardian_consent_id AND NEW.created_at = OLD.created_at
    AND NEW.version = OLD.version + 1 THEN
    IF (OLD.status = 'requested' AND (
        (NEW.status IN ('active', 'refused') AND OLD.minor_user_id = subject
          AND (NEW.status = 'refused' OR NEW.activation = 'child-confirmed'))
        OR (NEW.status = 'cancelled' AND OLD.guardian_user_id = subject)
      )) OR (OLD.status = 'active' AND NEW.status = 'ended'
        AND NEW.activation = OLD.activation
        AND NEW.activated_at = OLD.activated_at
        AND NEW.child_confirmation_id IS NOT DISTINCT FROM OLD.child_confirmation_id
        AND (OLD.guardian_user_id = subject OR EXISTS (
          SELECT 1 FROM public.users WHERE id = subject AND deleted_at IS NOT NULL
        )))
      OR (OLD.status = 'requested' AND NEW.status = 'cancelled' AND OLD.minor_user_id = subject
        AND EXISTS (SELECT 1 FROM public.users WHERE id = subject AND deleted_at IS NOT NULL)) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514',
    CONSTRAINT = 'guardian_link_authorized_transition',
    MESSAGE = 'Guardian link transition not allowed for this subject';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guardian_link_authorized_transition
  BEFORE INSERT OR UPDATE ON "guardian_links"
  FOR EACH ROW EXECUTE FUNCTION public.daisy_guardian_link_transition();
--> statement-breakpoint
CREATE FUNCTION public.daisy_child_account_request_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  subject text := public.daisy_subject_scope();
BEGIN
  IF current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.guardian_user_id = subject AND NEW.status IN ('open', 'linked')
      AND EXISTS (
        SELECT 1 FROM public.guardian_consent_evidence e
        WHERE e.id = NEW.guardian_consent_id AND
          e.method = CASE NEW.status WHEN 'open' THEN 'created-account' ELSE 'requested-link' END
      ) THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.id = OLD.id AND NEW.guardian_user_id = OLD.guardian_user_id
    AND NEW.guardian_consent_id = OLD.guardian_consent_id AND NEW.created_at = OLD.created_at
    AND NEW.expires_at = OLD.expires_at THEN
    IF (OLD.status IN ('open', 'linked') AND NEW.status = 'cancelled'
        AND NEW.requested_link_id IS NOT DISTINCT FROM OLD.requested_link_id
        AND (OLD.guardian_user_id = subject OR (
          public.daisy_owns_guardian_request_link(OLD.requested_link_id)
          AND EXISTS (SELECT 1 FROM public.users WHERE id = subject AND deleted_at IS NOT NULL)
        )))
      OR (OLD.status = 'open' AND NEW.status = 'claimed' AND NEW.claimed_user_id = subject
        AND NEW.closed_at < OLD.expires_at AND public.daisy_owns_guardian_request_email(OLD.email))
      OR (OLD.status = 'open' AND NEW.status = 'linked' AND OLD.guardian_user_id = subject
        AND NEW.closed_at < OLD.expires_at AND NEW.email = OLD.email AND NEW.first_name = OLD.first_name
        AND NEW.birth_month = OLD.birth_month AND (NEW.requested_link_id IS NULL OR EXISTS (
          SELECT 1 FROM public.guardian_links g WHERE g.id = NEW.requested_link_id
            AND g.guardian_user_id = subject AND g.guardian_consent_id = NEW.guardian_consent_id
            AND g.status = 'requested'
        ))) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514',
    CONSTRAINT = 'child_account_request_authorized_transition',
    MESSAGE = 'Child account request transition not allowed for this subject';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER child_account_request_authorized_transition
  BEFORE INSERT OR UPDATE ON "child_account_requests"
  FOR EACH ROW EXECUTE FUNCTION public.daisy_child_account_request_transition();
--> statement-breakpoint
CREATE FUNCTION public.daisy_expire_child_account_requests(batch_size integer)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH instant AS (
    SELECT clock_timestamp() AS at
  ), due AS (
    SELECT r.id, r.requested_link_id
    FROM public.child_account_requests r
    CROSS JOIN instant
    WHERE r.status IN ('open', 'linked') AND r.expires_at <= instant.at
    ORDER BY r.expires_at, r.id
    LIMIT LEAST(GREATEST(batch_size, 0), 200)
    FOR UPDATE OF r SKIP LOCKED
  ), closed_links AS (
    UPDATE public.guardian_links g
    SET status = 'cancelled', closed_at = instant.at, updated_at = instant.at, version = g.version + 1
    FROM due, instant
    WHERE g.id = due.requested_link_id AND g.status = 'requested'
  ), scrubbed AS (
    UPDATE public.child_account_requests r
    SET status = 'cancelled', closed_at = instant.at, first_name = null, birth_month = null, email = null
    FROM due, instant
    WHERE r.id = due.id
    RETURNING r.id
  )
  SELECT count(*)::integer FROM scrubbed
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_expire_child_account_requests(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_expire_child_account_requests(integer) TO daisy_web;
