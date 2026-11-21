CREATE TABLE "friend_guardian_approvals" (
	"id" text PRIMARY KEY,
	"low_actor_id" text NOT NULL,
	"high_actor_id" text NOT NULL,
	"child_actor_id" text NOT NULL,
	"cleared" boolean DEFAULT false NOT NULL,
	CONSTRAINT "friend_guardian_approvals_pair_child" UNIQUE("low_actor_id","high_actor_id","child_actor_id"),
	CONSTRAINT "friend_guardian_approvals_child" CHECK ("child_actor_id" in ("low_actor_id", "high_actor_id"))
);
--> statement-breakpoint
CREATE TABLE "protection_levels" (
	"user_id" text PRIMARY KEY,
	"choice" jsonb NOT NULL,
	CONSTRAINT "protection_levels_choice_is_object" CHECK (jsonb_typeof("choice") = 'object'),
	CONSTRAINT "protection_levels_choice" CHECK (case when "choice"->>'level' = 'custom' then
        ("choice"->>'friendApproval' in ('none', 'inbound-adult', 'all')
          and jsonb_typeof("choice"->'friendsOnlyMessages') = 'boolean'
          and jsonb_typeof("choice"->'rankedAllowed') = 'boolean'
          and "choice" - array['level','friendApproval','friendsOnlyMessages','rankedAllowed'] = '{}'::jsonb) is true
        else "choice" in ('{"level":"independent"}'::jsonb,
          '{"level":"guided"}'::jsonb, '{"level":"supervised"}'::jsonb) end)
);
--> statement-breakpoint
CREATE INDEX "friend_guardian_approvals_child_idx" ON "friend_guardian_approvals" ("child_actor_id");--> statement-breakpoint
ALTER TABLE "friend_guardian_approvals" ADD CONSTRAINT "friend_guardian_approvals_friendship_fk" FOREIGN KEY ("low_actor_id","high_actor_id") REFERENCES "friendships"("low_actor_id","high_actor_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "protection_levels" ADD CONSTRAINT "protection_levels_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_pair_check", ADD CONSTRAINT "notification_preferences_pair_check" CHECK (("kind", "channel") in (('followed_debater_live', 'in_app'), ('recording_ready', 'in_app'), ('round_started', 'in_app'), ('round_decision_released', 'in_app'), ('round_decision_released', 'email'), ('room_invitation', 'in_app'), ('room_invitation', 'email'), ('challenge_received', 'in_app'), ('challenge_accepted', 'in_app'), ('friend_request_received', 'in_app'), ('friend_request_received', 'email'), ('friend_request_accepted', 'in_app'), ('friend_guardian_approval', 'in_app'), ('dm_request', 'in_app'), ('dm_request', 'email'), ('judge_assigned', 'in_app'), ('judge_replaced', 'in_app'), ('judge_unassigned', 'in_app'), ('tournament_draw_changed', 'in_app'), ('tournament_room_ready', 'in_app'), ('tournament_results_released', 'in_app'), ('media_release_requested', 'in_app'), ('media_release_declined', 'in_app'), ('media_release_signed', 'in_app'), ('media_release_club_confirmed', 'in_app'), ('media_release_withdrawn', 'in_app'), ('media_release_club_asked', 'in_app'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check", ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" in ('followed_debater_live', 'recording_ready', 'round_started', 'round_decision_released', 'room_invitation', 'challenge_received', 'challenge_accepted', 'friend_request_received', 'friend_request_accepted', 'friend_guardian_approval', 'dm_request', 'judge_assigned', 'judge_replaced', 'judge_unassigned', 'tournament_draw_changed', 'tournament_room_ready', 'tournament_results_released', 'media_release_requested', 'media_release_declined', 'media_release_signed', 'media_release_club_confirmed', 'media_release_withdrawn', 'media_release_club_asked')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_check", ADD CONSTRAINT "notifications_subject_check" CHECK (("kind" in ('followed_debater_live', 'recording_ready', 'round_started', 'round_decision_released')) = ("round_id" is not null) and ("kind" in ('room_invitation')) = ("room_invitation_id" is not null) and ("kind" in ('challenge_received', 'challenge_accepted')) = ("challenge_id" is not null) and ("kind" in ('friend_request_received', 'friend_request_accepted', 'friend_guardian_approval')) = ("friendship_low_actor_id" is not null) and ("kind" in ('friend_request_received', 'friend_request_accepted', 'friend_guardian_approval')) = ("friendship_high_actor_id" is not null) and ("kind" in ('judge_assigned', 'judge_replaced', 'judge_unassigned', 'tournament_draw_changed', 'tournament_room_ready', 'tournament_results_released')) = ("fixture_id" is not null) and ("kind" in ('judge_assigned', 'judge_replaced', 'judge_unassigned', 'tournament_draw_changed', 'tournament_room_ready', 'tournament_results_released')) = ("notification_lobby_id" is not null) and ("kind" in ('judge_assigned', 'judge_replaced', 'judge_unassigned', 'tournament_draw_changed', 'tournament_room_ready', 'tournament_results_released')) = ("tab_command_id" is not null) and ("kind" in ('media_release_requested', 'media_release_declined')) = ("media_release_request_id" is not null) and ("kind" in ('media_release_signed', 'media_release_club_confirmed', 'media_release_withdrawn')) = ("media_release_id" is not null) and ("kind" in ('media_release_club_asked')) = ("media_release_club_ask_id" is not null) and ("kind" in ('dm_request')) = ("dm_channel_id" is not null)) NOT VALID;
--> statement-breakpoint
CREATE FUNCTION public.daisy_protection_guardians(child_id text)
RETURNS TABLE(user_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT l.guardian_user_id
    FROM public.guardian_links l
    JOIN public.users child ON child.id = l.minor_user_id AND child.deleted_at IS NULL
    JOIN public.account_age age ON age.user_id = child.id
    JOIN public.users parent ON parent.id = l.guardian_user_id AND parent.deleted_at IS NULL
    JOIN public.account_age parent_age ON parent_age.user_id = parent.id
  WHERE l.minor_user_id = child_id AND l.status = 'active'
    AND public.daisy_age_band(age.birth_month, age.version, age.recorded_at, statement_timestamp()) IN ('13-15', '16-17')
    AND public.daisy_age_band(parent_age.birth_month, parent_age.version, parent_age.recorded_at, statement_timestamp()) = 'adult'
  ORDER BY l.guardian_user_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_protection_guardians(text) FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE public.protection_levels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY protection_levels_subject ON public.protection_levels FOR SELECT
  USING (user_id = daisy_subject_scope());
--> statement-breakpoint
GRANT SELECT ON public.protection_levels TO daisy_web;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.protection_levels FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_erase_protection_choice()
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  DELETE FROM public.protection_levels level
  USING public.users child
  WHERE level.user_id = public.daisy_subject_scope()
    AND child.id = level.user_id AND child.deleted_at IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_erase_protection_choice() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_erase_protection_choice() TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_effective_protection_choice(child_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.daisy_protection_guardians(child_id))
    THEN COALESCE((SELECT choice FROM public.protection_levels WHERE user_id = child_id), '{"level":"guided"}')
    ELSE '{"level":"independent"}'::jsonb END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_effective_protection_choice(text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.daisy_expand_protection(choice jsonb)
RETURNS TABLE(friend_approval text, friends_only boolean, ranked_allowed boolean)
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  -- Generated by bun packages/db/scripts/protection-policy-sql.ts.
  SELECT p.friend_approval, p.friends_only, p.ranked_allowed
  FROM (VALUES
    ('{"level":"independent"}'::jsonb, 'none', false, true),
    ('{"level":"guided"}'::jsonb, 'inbound-adult', false, true),
    ('{"level":"supervised"}'::jsonb, 'all', true, false),
    ('{"level":"custom","friendApproval":"none","friendsOnlyMessages":false,"rankedAllowed":false}'::jsonb, 'none', false, false),
    ('{"level":"custom","friendApproval":"none","friendsOnlyMessages":false,"rankedAllowed":true}'::jsonb, 'none', false, true),
    ('{"level":"custom","friendApproval":"none","friendsOnlyMessages":true,"rankedAllowed":false}'::jsonb, 'none', true, false),
    ('{"level":"custom","friendApproval":"none","friendsOnlyMessages":true,"rankedAllowed":true}'::jsonb, 'none', true, true),
    ('{"level":"custom","friendApproval":"inbound-adult","friendsOnlyMessages":false,"rankedAllowed":false}'::jsonb, 'inbound-adult', false, false),
    ('{"level":"custom","friendApproval":"inbound-adult","friendsOnlyMessages":false,"rankedAllowed":true}'::jsonb, 'inbound-adult', false, true),
    ('{"level":"custom","friendApproval":"inbound-adult","friendsOnlyMessages":true,"rankedAllowed":false}'::jsonb, 'inbound-adult', true, false),
    ('{"level":"custom","friendApproval":"inbound-adult","friendsOnlyMessages":true,"rankedAllowed":true}'::jsonb, 'inbound-adult', true, true),
    ('{"level":"custom","friendApproval":"all","friendsOnlyMessages":false,"rankedAllowed":false}'::jsonb, 'all', false, false),
    ('{"level":"custom","friendApproval":"all","friendsOnlyMessages":false,"rankedAllowed":true}'::jsonb, 'all', false, true),
    ('{"level":"custom","friendApproval":"all","friendsOnlyMessages":true,"rankedAllowed":false}'::jsonb, 'all', true, false),
    ('{"level":"custom","friendApproval":"all","friendsOnlyMessages":true,"rankedAllowed":true}'::jsonb, 'all', true, true)
  ) p(choice, friend_approval, friends_only, ranked_allowed)
  WHERE p.choice = $1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_expand_protection(jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.daisy_protection_level(child_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.daisy_effective_protection_choice(child_id)
  WHERE public.daisy_subject_scope() = child_id
    OR EXISTS (SELECT 1 FROM public.daisy_protection_guardians(child_id)
      WHERE user_id = public.daisy_subject_scope())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_protection_level(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_protection_level(text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_ranked_protection_allows(entrant_ids text[], room_id text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.actors entrant
    CROSS JOIN LATERAL public.daisy_expand_protection(
      public.daisy_effective_protection_choice(entrant.user_id)) limits
    WHERE entrant.id = ANY(entrant_ids) AND entrant.user_id IS NOT NULL
      AND NOT limits.ranked_allowed
  )
  WHERE (cardinality(entrant_ids) = 1 AND public.daisy_subject_actor_scope() = entrant_ids[1])
    OR (room_id IS NULL AND cardinality(entrant_ids) = 2
      AND public.daisy_subject_actor_scope() = ANY(entrant_ids)
      AND EXISTS (SELECT 1 FROM public.contact_pairs pair
        WHERE pair.low_actor_id = least(entrant_ids[1], entrant_ids[2])
          AND pair.high_actor_id = greatest(entrant_ids[1], entrant_ids[2])
          AND NOT pair.low_blocks_high AND NOT pair.high_blocks_low))
    OR EXISTS (SELECT 1 FROM public.rooms room
      WHERE room.id = room_id AND
        (room.host_actor_id = public.daisy_subject_actor_scope()
          OR (room.host_actor_id IS NULL AND room.lobby_id = public.daisy_lobby_scope()
            AND public.daisy_subject_actor_scope() IS NOT NULL)))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_ranked_protection_allows(text[], text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_ranked_protection_allows(text[], text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_message_requests_friends_only(recipient_id text, requester_actor_id text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT friends_only FROM public.daisy_expand_protection(
    public.daisy_effective_protection_choice(recipient_id))
  WHERE (requester_actor_id IS NULL AND recipient_id = public.daisy_subject_scope())
    OR (requester_actor_id = public.daisy_subject_actor_scope() AND EXISTS (
      SELECT 1 FROM public.actors recipient
      JOIN public.users account ON account.id = recipient.user_id AND account.deleted_at IS NULL
      LEFT JOIN public.contact_pairs pair ON pair.low_actor_id = least(requester_actor_id, recipient.id)
        AND pair.high_actor_id = greatest(requester_actor_id, recipient.id)
      WHERE recipient.user_id = recipient_id AND recipient.id <> requester_actor_id
        AND NOT coalesce(pair.low_blocks_high OR pair.high_blocks_low, false)
    ))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_message_requests_friends_only(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_message_requests_friends_only(text, text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_protection_choice_lock(child_id text)
RETURNS void
LANGUAGE sql VOLATILE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('guardian-protection:' || child_id, 0))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_protection_choice_lock(text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.daisy_friend_approval_needed(
  protected_actor text, other_actor text, requester text, previous_choice jsonb DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.actors child
    JOIN public.actors counterpart ON counterpart.id = other_actor
    JOIN public.users counterpart_user ON counterpart_user.id = counterpart.user_id
      AND counterpart_user.deleted_at IS NULL
    LEFT JOIN public.account_age age ON age.user_id = counterpart.user_id
    CROSS JOIN LATERAL public.daisy_expand_protection(coalesce(previous_choice,
      public.daisy_effective_protection_choice(child.user_id))) limits
    -- Generated by bun packages/db/scripts/protection-policy-sql.ts --holds.
    JOIN (VALUES
      ('inbound-adult', 'incoming', 'adult'),
      ('inbound-adult', 'incoming', ''),
      ('all', 'incoming', 'under-13'),
      ('all', 'incoming', '13-15'),
      ('all', 'incoming', '16-17'),
      ('all', 'incoming', 'adult'),
      ('all', 'incoming', ''),
      ('all', 'outgoing', 'under-13'),
      ('all', 'outgoing', '13-15'),
      ('all', 'outgoing', '16-17'),
      ('all', 'outgoing', 'adult'),
      ('all', 'outgoing', '')
    ) rule(approval, direction, age)
      ON rule.approval = limits.friend_approval
      AND rule.direction = CASE WHEN requester = protected_actor THEN 'outgoing' ELSE 'incoming' END
      AND rule.age = coalesce(public.daisy_age_band(age.birth_month, age.version, age.recorded_at,
        statement_timestamp()), '')
    WHERE child.id = protected_actor AND requester IN (protected_actor, other_actor)
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_friend_approval_needed(text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
-- Ordinary notices retain their existing readers. Guardian notices are private at storage.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_standard_access ON public.notifications AS PERMISSIVE FOR ALL
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY notifications_guardian_recipient ON public.notifications AS RESTRICTIVE FOR ALL
  USING (kind <> 'friend_guardian_approval' OR user_id = public.daisy_subject_scope())
  WITH CHECK (kind <> 'friend_guardian_approval' OR user_id = public.daisy_subject_scope());
--> statement-breakpoint
CREATE FUNCTION public.daisy_guardian_notice(hold_id text, happened_at timestamptz, notice_ids text[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  cursor_stamp text;
BEGIN
  WITH recipients AS (
    SELECT guardian.user_id, approval.low_actor_id, approval.high_actor_id,
      approval.child_actor_id, existing.id AS existing_id,
      (row_number() OVER (ORDER BY guardian.user_id))::integer AS slot
    FROM public.friend_guardian_approvals approval
    JOIN public.actors child ON child.id = approval.child_actor_id
    CROSS JOIN LATERAL public.daisy_protection_guardians(child.user_id) guardian
    LEFT JOIN public.notifications existing ON existing.user_id = guardian.user_id
      AND existing.kind = 'friend_guardian_approval'
      AND existing.friendship_low_actor_id = approval.low_actor_id
      AND existing.friendship_high_actor_id = approval.high_actor_id
    WHERE approval.id = hold_id
  ), written AS (
    INSERT INTO public.notifications(id, user_id, kind, friendship_low_actor_id,
      friendship_high_actor_id, actor_id, created_at, surfaced_at)
    SELECT coalesce(existing_id, notice_ids[slot]), user_id, 'friend_guardian_approval',
      low_actor_id, high_actor_id, child_actor_id, happened_at, happened_at
    FROM recipients WHERE existing_id IS NOT NULL OR notice_ids[slot] IS NOT NULL
    ON CONFLICT (user_id, kind, friendship_low_actor_id, friendship_high_actor_id)
      WHERE friendship_low_actor_id IS NOT NULL
      DO UPDATE SET surfaced_at = excluded.surfaced_at, read_at = NULL
    RETURNING id, user_id
  ), inbox_signals AS (
    INSERT INTO public.outbox(topic, kind, version, payload)
    SELECT 'user:' || actor.id || ':inbox', 'user.notification-delivered', 1,
      jsonb_build_object('entityVersion', 1, 'kind', 'user.notification-delivered',
        'ids', jsonb_build_array(written.id), 'notificationType', 'friend_guardian_approval',
        'occurredAt', to_char(happened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    FROM written JOIN public.actors actor ON actor.user_id = written.user_id
    RETURNING txid, seq
  )
  SELECT txid::text || ':' || seq::text INTO cursor_stamp
  FROM inbox_signals ORDER BY seq DESC LIMIT 1;
  IF cursor_stamp IS NOT NULL THEN
    PERFORM pg_notify('outbox', cursor_stamp);
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guardian_notice(text, timestamptz, text[]) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.daisy_require_notice_ids(notice_ids text[], slots integer)
RETURNS void
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF coalesce(cardinality(notice_ids), 0) < slots OR EXISTS (
    SELECT 1 FROM unnest(notice_ids) notice(id) WHERE id IS NULL OR id !~ '^[a-z0-9]{24}$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid notification identifiers';
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_require_notice_ids(text[], integer) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.daisy_set_protection_level(child_id text, selected jsonb,
  happened_at timestamptz DEFAULT statement_timestamp(), notice_ids text[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  previous_choice jsonb;
  live_holds text[];
  became_live text;
  recipients integer;
  slots integer;
  first_slot integer := 1;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.daisy_protection_guardians(child_id)
    WHERE user_id = public.daisy_subject_scope()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protection level cannot be changed';
  END IF;
  -- Match the authorization account fence's user-id order.
  PERFORM id FROM public.users WHERE id IN (child_id, public.daisy_subject_scope())
    ORDER BY id FOR UPDATE;
  PERFORM public.daisy_protection_choice_lock(child_id);
  IF NOT EXISTS (SELECT 1 FROM public.daisy_protection_guardians(child_id)
    WHERE user_id = public.daisy_subject_scope()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protection level cannot be changed';
  END IF;
  previous_choice := public.daisy_effective_protection_choice(child_id);
  SELECT coalesce(array_agg(approval.id ORDER BY approval.low_actor_id, approval.high_actor_id), '{}')
    INTO live_holds
    FROM public.friend_guardian_approvals approval
    JOIN public.actors child ON child.id = approval.child_actor_id
    JOIN public.friendships request USING (low_actor_id, high_actor_id)
    JOIN public.contact_pairs pair USING (low_actor_id, high_actor_id)
    CROSS JOIN LATERAL (SELECT CASE WHEN approval.low_actor_id = child.id
      THEN approval.high_actor_id ELSE approval.low_actor_id END AS actor_id) other
    WHERE child.user_id = child_id AND NOT approval.cleared AND request.state = 'pending'
      AND NOT pair.low_blocks_high AND NOT pair.high_blocks_low
      AND NOT public.daisy_friend_approval_needed(child.id, other.actor_id,
        request.requester_actor_id, previous_choice)
      AND public.daisy_friend_approval_needed(child.id, other.actor_id,
        request.requester_actor_id, selected);
  SELECT count(*)::integer INTO recipients FROM public.daisy_protection_guardians(child_id);
  slots := cardinality(live_holds) * recipients;
  IF slots > 0 AND notice_ids IS NULL THEN
    RETURN slots;
  END IF;
  PERFORM public.daisy_require_notice_ids(notice_ids, slots);
  INSERT INTO public.protection_levels(user_id, choice) VALUES (child_id, selected)
    ON CONFLICT (user_id) DO UPDATE SET choice = EXCLUDED.choice
    WHERE protection_levels.choice IS DISTINCT FROM excluded.choice;
  FOREACH became_live IN ARRAY live_holds
  LOOP
    PERFORM public.daisy_guardian_notice(became_live, happened_at,
      notice_ids[first_slot:(first_slot + recipients - 1)]);
    first_slot := first_slot + recipients;
  END LOOP;
  RETURN 0;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_set_protection_level(text, jsonb, timestamptz, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_set_protection_level(text, jsonb, timestamptz, text[]) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_clear_unlinked_protection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  child_id text;
BEGIN
  FOR child_id IN
    SELECT DISTINCT old_link.minor_user_id
    FROM previous_guardian_links old_link JOIN updated_guardian_links new_link USING (id)
    WHERE old_link.status = 'active' AND new_link.status = 'ended'
    ORDER BY old_link.minor_user_id
  LOOP
    PERFORM public.daisy_protection_choice_lock(child_id);
    DELETE FROM public.protection_levels level WHERE level.user_id = child_id
      AND NOT EXISTS (SELECT 1 FROM public.guardian_links
        WHERE minor_user_id = child_id AND status = 'active');
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_clear_unlinked_protection() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guardian_links_clear_unlinked_protection
  AFTER UPDATE ON public.guardian_links
  REFERENCING OLD TABLE AS previous_guardian_links NEW TABLE AS updated_guardian_links
  FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_clear_unlinked_protection();
--> statement-breakpoint
CREATE FUNCTION public.daisy_is_protection_guardian(child_actor_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.actors child
    CROSS JOIN LATERAL public.daisy_protection_guardians(child.user_id) guardian
    WHERE child.id = child_actor_id AND guardian.user_id = public.daisy_subject_scope()
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_is_protection_guardian(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_is_protection_guardian(text) TO daisy_web;
--> statement-breakpoint
ALTER TABLE public.friend_guardian_approvals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY friend_guardian_approvals_subject ON public.friend_guardian_approvals FOR SELECT
  USING ((child_actor_id = daisy_subject_actor_scope()) OR daisy_is_protection_guardian(child_actor_id));
--> statement-breakpoint
GRANT SELECT ON public.friend_guardian_approvals TO daisy_web;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.friend_guardian_approvals FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_friend_approval_pair_scope(low_id text, high_id text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce(public.daisy_subject_actor_scope() IN (low_id, high_id), false)
    OR public.daisy_is_protection_guardian(low_id)
    OR public.daisy_is_protection_guardian(high_id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_friend_approval_pair_scope(text, text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.daisy_friend_guardian_holds(low_id text, high_id text, requester text)
RETURNS TABLE(child_actor_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT endpoint.child_id FROM (VALUES (low_id, high_id), (high_id, low_id)) endpoint(child_id, other_id)
  JOIN public.contact_pairs pair ON pair.low_actor_id = low_id AND pair.high_actor_id = high_id
  LEFT JOIN public.friendships request ON request.low_actor_id = low_id AND request.high_actor_id = high_id
  WHERE public.daisy_friend_approval_pair_scope(low_id, high_id)
    AND NOT pair.low_blocks_high AND NOT pair.high_blocks_low
    AND (request.state IS NULL OR request.state <> 'accepted')
    AND (request.requester_actor_id = requester OR
      (request.state IS NULL AND requester = public.daisy_subject_actor_scope()))
    AND public.daisy_friend_approval_needed(endpoint.child_id, endpoint.other_id, requester)
    AND NOT EXISTS (SELECT 1 FROM public.friend_guardian_approvals approval
      WHERE approval.low_actor_id = low_id AND approval.high_actor_id = high_id
        AND approval.child_actor_id = endpoint.child_id AND approval.cleared)
  ORDER BY endpoint.child_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_friend_guardian_holds(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_friend_guardian_holds(text, text, text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_friend_guardian_hold_live(hold_id text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friend_guardian_approvals approval
    JOIN public.friendships request USING (low_actor_id, high_actor_id)
    JOIN public.contact_pairs pair USING (low_actor_id, high_actor_id)
    WHERE approval.id = hold_id AND NOT approval.cleared AND request.state = 'pending'
      AND NOT pair.low_blocks_high AND NOT pair.high_blocks_low
      AND public.daisy_friend_approval_needed(approval.child_actor_id,
        CASE WHEN approval.child_actor_id = approval.low_actor_id
          THEN approval.high_actor_id ELSE approval.low_actor_id END, request.requester_actor_id)
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_friend_guardian_hold_live(text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.daisy_own_friend_guardian_hold_live(hold_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friend_guardian_approvals approval
    WHERE approval.id = hold_id
      AND (approval.child_actor_id = public.daisy_subject_actor_scope()
        OR public.daisy_is_protection_guardian(approval.child_actor_id))
      AND public.daisy_friend_guardian_hold_live(hold_id)
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_own_friend_guardian_hold_live(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_own_friend_guardian_hold_live(text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_friend_guardian_waiting(low_id text, high_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN bool_or(approval.child_actor_id = public.daisy_subject_actor_scope()) THEN 'waiting-for-guardian'
    WHEN count(*) > 0 THEN 'waiting'
  END
  FROM public.friend_guardian_approvals approval
  WHERE public.daisy_subject_actor_scope() IN (low_id, high_id)
    AND approval.low_actor_id = low_id AND approval.high_actor_id = high_id
    AND public.daisy_friend_guardian_hold_live(approval.id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_friend_guardian_waiting(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_friend_guardian_waiting(text, text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_hold_friend_request(
  approval_id text, low_id text, high_id text, child_id text, happened_at timestamptz,
  notice_ids text[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  created text;
  child_user text;
  slots integer;
BEGIN
  IF child_id NOT IN (low_id, high_id) OR NOT public.daisy_friend_approval_pair_scope(low_id, high_id) THEN
    RETURN 0;
  END IF;
  PERFORM account.id FROM public.users account JOIN public.actors member ON member.user_id = account.id
    WHERE member.id IN (low_id, high_id) ORDER BY account.id FOR UPDATE OF account;
  PERFORM 1 FROM public.contact_pairs
    WHERE low_actor_id = low_id AND high_actor_id = high_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  SELECT user_id INTO child_user FROM public.actors WHERE id = child_id;
  PERFORM public.daisy_protection_choice_lock(child_user);

  PERFORM 1 FROM public.friendships request
  WHERE request.low_actor_id = low_id AND request.high_actor_id = high_id
    AND request.state = 'pending'
    AND EXISTS (SELECT 1 FROM public.daisy_friend_guardian_holds(low_id, high_id,
      request.requester_actor_id) needed WHERE needed.child_actor_id = child_id)
    AND NOT EXISTS (SELECT 1 FROM public.friend_guardian_approvals existing
      WHERE existing.low_actor_id = low_id AND existing.high_actor_id = high_id
        AND existing.child_actor_id = child_id);
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  SELECT count(*)::integer INTO slots FROM public.daisy_protection_guardians(child_user);
  -- The application mints the CUIDs. A planning call reveals no recipient identity.
  IF notice_ids IS NULL THEN
    RETURN slots;
  END IF;
  PERFORM public.daisy_require_notice_ids(notice_ids, slots);
  INSERT INTO public.friend_guardian_approvals(id, low_actor_id, high_actor_id, child_actor_id)
  VALUES (approval_id, low_id, high_id, child_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO created;
  IF created IS NOT NULL THEN
    PERFORM public.daisy_guardian_notice(created, happened_at, notice_ids);
  END IF;
  RETURN 0;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_hold_friend_request(text, text, text, text, timestamptz, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_hold_friend_request(text, text, text, text, timestamptz, text[]) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_clear_friend_guardian_hold(approval_id text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  child_id text;
  low_id text;
  high_id text;
BEGIN
  SELECT child.user_id, approval.low_actor_id, approval.high_actor_id
    INTO child_id, low_id, high_id
  FROM public.friend_guardian_approvals approval
  JOIN public.actors child ON child.id = approval.child_actor_id
  WHERE approval.id = approval_id AND public.daisy_is_protection_guardian(approval.child_actor_id);
  IF child_id IS NULL THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.contact_pairs
    WHERE low_actor_id = low_id AND high_actor_id = high_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM public.daisy_protection_choice_lock(child_id);
  UPDATE public.friend_guardian_approvals approval SET cleared = true
  WHERE approval.id = approval_id AND public.daisy_is_protection_guardian(approval.child_actor_id)
    AND public.daisy_friend_guardian_hold_live(approval.id);
  RETURN FOUND;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_clear_friend_guardian_hold(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_clear_friend_guardian_hold(text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_retire_friend_guardian_holds()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  DELETE FROM public.friend_guardian_approvals
  WHERE low_actor_id = NEW.low_actor_id AND high_actor_id = NEW.high_actor_id;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_retire_friend_guardian_holds() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER friendships_retire_guardian_holds
  AFTER UPDATE OF state ON public.friendships
  FOR EACH ROW WHEN (OLD.state <> 'accepted' AND NEW.state = 'accepted')
  EXECUTE FUNCTION public.daisy_retire_friend_guardian_holds();
