CREATE TABLE "challenges" (
	"id" text PRIMARY KEY,
	"challenger_actor_id" text NOT NULL,
	"challenged_actor_id" text NOT NULL,
	"mode" text NOT NULL,
	"format_id" text NOT NULL,
	"room_id" text UNIQUE,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "challenges_distinct" CHECK ("challenger_actor_id" <> "challenged_actor_id"),
	CONSTRAINT "challenges_mode_check" CHECK ("mode" in ('ranked', 'casual')),
	CONSTRAINT "challenges_format_check" CHECK ("format_id" in ('freestyle', 'policy', 'value'))
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"operator_ref" text NOT NULL,
	CONSTRAINT "moderation_actions_kind_check" CHECK ("kind" in ('warning', 'suspension', 'ban')),
	CONSTRAINT "moderation_actions_ends_check" CHECK (("kind" = 'suspension') = ("ends_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "rating_visibility" (
	"actor_id" text PRIMARY KEY,
	"show_policy" boolean NOT NULL,
	"show_value" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY,
	"reporter_actor_id" text NOT NULL,
	"subject_actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"surface" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"outcome" text,
	"operator_ref" text,
	"purge_after" timestamp with time zone,
	CONSTRAINT "reports_distinct" CHECK ("reporter_actor_id" <> "subject_actor_id"),
	CONSTRAINT "reports_reason_check" CHECK ("reason" in ('harassment', 'hate', 'cheating', 'spam', 'other')),
	CONSTRAINT "reports_surface_check" CHECK ("surface" in ('online', 'profile', 'watch')),
	CONSTRAINT "reports_outcome_check" CHECK ("outcome" is null or "outcome" in ('dismissed', 'warned', 'suspended', 'banned')),
	CONSTRAINT "reports_closed_check" CHECK (("closed_at" is null) = ("outcome" is null)
        and ("closed_at" is null) = ("operator_ref" is null)
        and ("closed_at" is null) = ("purge_after" is null))
);
--> statement-breakpoint
DROP TABLE "friend_challenges";--> statement-breakpoint
ALTER TABLE "presence_settings" ADD COLUMN "status" text;--> statement-breakpoint
-- Hiding was the only choice; it becomes appearing offline (ADR 0097).
UPDATE "presence_settings" SET "status" = CASE WHEN "hidden" THEN 'offline' ELSE 'online' END;--> statement-breakpoint
ALTER TABLE "presence_settings" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "presence_settings" DROP COLUMN "hidden";--> statement-breakpoint
CREATE INDEX "challenges_challenged_idx" ON "challenges" ("challenged_actor_id");--> statement-breakpoint
CREATE INDEX "challenges_challenger_idx" ON "challenges" ("challenger_actor_id");--> statement-breakpoint
CREATE INDEX "challenges_expiry_idx" ON "challenges" ("expires_at") WHERE "room_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "challenges_one_pending_per_direction" ON "challenges" ("challenger_actor_id","challenged_actor_id") WHERE "room_id" is null;--> statement-breakpoint
CREATE INDEX "moderation_actions_user_idx" ON "moderation_actions" ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "reports_queue_idx" ON "reports" ("closed_at","created_at","id");--> statement-breakpoint
CREATE INDEX "reports_reporter_idx" ON "reports" ("reporter_actor_id");--> statement-breakpoint
CREATE INDEX "reports_subject_idx" ON "reports" ("subject_actor_id");--> statement-breakpoint
CREATE INDEX "reports_purge_idx" ON "reports" ("purge_after") WHERE "purge_after" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_per_pair" ON "reports" ("reporter_actor_id","subject_actor_id") WHERE "closed_at" is null;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_challenger_actor_id_actors_id_fkey" FOREIGN KEY ("challenger_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_challenged_actor_id_actors_id_fkey" FOREIGN KEY ("challenged_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rating_visibility" ADD CONSTRAINT "rating_visibility_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_actor_id_actors_id_fkey" FOREIGN KEY ("reporter_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_subject_actor_id_actors_id_fkey" FOREIGN KEY ("subject_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "presence_settings" ADD CONSTRAINT "presence_settings_status_check" CHECK ("status" in ('online', 'busy', 'offline'));--> statement-breakpoint
-- ADR 0097: a suspension or ban in force withdraws participant access through
-- the one account producer, so web and realtime stop at the same check. The
-- added column is ignored by a release that still selects the old ones.
DROP FUNCTION public.daisy_authorization_read_accounts_v2(text[]);--> statement-breakpoint
DROP FUNCTION public.daisy_authorization_accounts_v2(text[], text, boolean);--> statement-breakpoint
CREATE FUNCTION public.daisy_authorization_accounts_v2(
  actor_ids text[], account_user_id text, take_fence boolean
) RETURNS TABLE ("userId" text, "actorId" text, "member" boolean, "erased" boolean, "revision" integer,
  "betaState" text, "betaRevision" integer, "ageBand" text, "restricted" boolean)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $authorization_accounts$
DECLARE
  checked timestamptz;
BEGIN
  IF take_fence IS NULL OR (actor_ids IS NULL) = (account_user_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid authorization account selector';
  END IF;
  IF actor_ids IS NOT NULL THEN
    IF take_fence IS NOT TRUE
      OR pg_catalog.array_ndims(actor_ids) IS DISTINCT FROM 1
      OR pg_catalog.array_lower(actor_ids, 1) IS DISTINCT FROM 1
      OR pg_catalog.cardinality(actor_ids) NOT BETWEEN 1 AND 65535
      OR EXISTS (SELECT 1 FROM pg_catalog.unnest(actor_ids) AS requested(id) WHERE requested.id IS NULL OR requested.id !~ '^[a-z0-9]{24}$')
      OR (SELECT pg_catalog.count(DISTINCT requested.id) FROM pg_catalog.unnest(actor_ids) AS requested(id)) <> pg_catalog.cardinality(actor_ids)
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid authorization account selector';
    END IF;
    -- The same user-row fence as erasure, correction and contact/channel commands.
    PERFORM u.id FROM public.users AS u JOIN public.actors AS a ON a.user_id = u.id
      WHERE a.id = ANY(actor_ids) ORDER BY u.id FOR UPDATE OF u;
  ELSE
    IF take_fence IS NOT FALSE OR account_user_id !~ '^[a-z0-9]{24}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid authorization account selector';
    END IF;
  END IF;
  -- A new statement after lock waits reevaluates membership and tombstone state,
  -- and the age band is classified at an instant sampled after those waits.
  checked := pg_catalog.clock_timestamp();
  RETURN QUERY SELECT u.id,
    CASE WHEN a.kind = 'human' AND a.user_id = u.id THEN a.id ELSE NULL::text END,
    COALESCE(a.kind = 'human' AND a.user_id = u.id AND a.id IS NOT NULL
      AND u.email_verified AND u.username IS NOT NULL AND pg_catalog.length(u.username) > 0
      AND u.deleted_at IS NULL, false),
    u.deleted_at IS NOT NULL, u.version,
    -- ADR 0075: the account's own beta access, under the same fence.
    b.state, b.revision,
    -- ADR 0075: the account's age band at a fresh post-wait instant, by the
    -- shared validity rule; never birth data. Null without a valid record
    -- or for an erased account.
    CASE WHEN u.deleted_at IS NOT NULL THEN NULL::text
      ELSE public.daisy_age_band(ag.birth_month, ag.version, ag.recorded_at, checked) END,
    -- ADR 0097: a suspension or ban in force at that same instant.
    EXISTS (SELECT 1 FROM public.moderation_actions AS m
      WHERE m.user_id = u.id AND m.kind IN ('suspension', 'ban') AND m.lifted_at IS NULL
        AND m.starts_at <= checked AND (m.ends_at IS NULL OR m.ends_at > checked))
    FROM public.users AS u LEFT JOIN public.actors AS a ON a.user_id = u.id
    LEFT JOIN public.account_beta_access AS b ON b.user_id = u.id
    LEFT JOIN public.account_age AS ag ON ag.user_id = u.id
    WHERE (account_user_id IS NOT NULL AND u.id = account_user_id)
      OR (actor_ids IS NOT NULL AND a.id = ANY(actor_ids))
    ORDER BY u.id;
END;
$authorization_accounts$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_authorization_accounts_v2(text[], text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_authorization_accounts_v2(text[], text, boolean) TO daisy_web, daisy_realtime;--> statement-breakpoint
CREATE FUNCTION public.daisy_authorization_read_accounts_v2(actor_ids text[])
RETURNS TABLE ("userId" text, "actorId" text, "member" boolean, "erased" boolean, "revision" integer,
  "betaState" text, "betaRevision" integer, "ageBand" text, "restricted" boolean)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $authorization_read_accounts$
BEGIN
  IF pg_catalog.array_ndims(actor_ids) IS DISTINCT FROM 1
    OR pg_catalog.array_lower(actor_ids, 1) IS DISTINCT FROM 1
    OR pg_catalog.cardinality(actor_ids) NOT BETWEEN 1 AND 65535
    OR EXISTS (SELECT 1 FROM pg_catalog.unnest(actor_ids) AS requested(id)
      WHERE requested.id IS NULL OR requested.id !~ '^[a-z0-9]{24}$')
    OR (SELECT pg_catalog.count(DISTINCT requested.id) FROM pg_catalog.unnest(actor_ids) AS requested(id)) <> pg_catalog.cardinality(actor_ids)
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid authorization read selector';
  END IF;
  -- The writer fence's rows and order, shared.
  PERFORM u.id FROM public.users AS u JOIN public.actors AS a ON a.user_id = u.id
    WHERE a.id = ANY(actor_ids) ORDER BY u.id FOR SHARE OF u;
  -- VOLATILE plus READ COMMITTED: a new statement rereads facts after the waits.
  RETURN QUERY SELECT account.* FROM public.actors AS a
    CROSS JOIN LATERAL public.daisy_authorization_accounts_v2(NULL::text[], a.user_id, false) AS account
    WHERE a.id = ANY(actor_ids) AND account."actorId" = a.id ORDER BY account."userId";
END;
$authorization_read_accounts$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_authorization_read_accounts_v2(text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_authorization_read_accounts_v2(text[]) TO daisy_web, daisy_realtime;--> statement-breakpoint
DROP FUNCTION public.daisy_room_read_account_v2(text, text);--> statement-breakpoint
-- Canonical standalone Room reader fence (v2, ADR 0075). Writers retain the exclusive account producer.
CREATE FUNCTION public.daisy_room_read_account_v2(requested_actor_id text, requested_user_id text)
RETURNS TABLE ("userId" text, "actorId" text, "member" boolean, "erased" boolean, "revision" integer,
  "betaState" text, "betaRevision" integer, "ageBand" text, "restricted" boolean)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $room_read_account$
BEGIN
  IF requested_actor_id IS NULL OR requested_user_id IS NULL
    OR requested_actor_id !~ '^[a-z0-9]{24}$' OR requested_user_id !~ '^[a-z0-9]{24}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid Room read account selector';
  END IF;
  -- SHARE permits peer readers but excludes UPDATE, DELETE and NO KEY UPDATE.
  -- One caller is the complete reader set; use the canonical user-id ordering.
  PERFORM u.id FROM public.users AS u JOIN public.actors AS a ON a.user_id = u.id
    WHERE a.id = requested_actor_id AND u.id = requested_user_id ORDER BY u.id FOR SHARE OF u;
  -- A fresh statement after the wait, never a pre-wait authorization snapshot.
  RETURN QUERY SELECT account.*
    FROM public.daisy_authorization_accounts_v2(NULL::text[], requested_user_id, false) AS account
    WHERE account."actorId" = requested_actor_id;
END;
$room_read_account$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_read_account_v2(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_read_account_v2(text, text) TO daisy_web, daisy_realtime;
