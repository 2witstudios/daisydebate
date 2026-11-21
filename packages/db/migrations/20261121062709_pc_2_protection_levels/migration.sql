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
ALTER TABLE "friend_guardian_approvals" ADD CONSTRAINT "friend_guardian_approvals_low_actor_id_actors_id_fkey" FOREIGN KEY ("low_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "friend_guardian_approvals" ADD CONSTRAINT "friend_guardian_approvals_high_actor_id_actors_id_fkey" FOREIGN KEY ("high_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "friend_guardian_approvals" ADD CONSTRAINT "friend_guardian_approvals_friendship_fk" FOREIGN KEY ("low_actor_id","high_actor_id") REFERENCES "friendships"("low_actor_id","high_actor_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "protection_levels" ADD CONSTRAINT "protection_levels_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "friendships" DROP CONSTRAINT "friendships_state", ADD CONSTRAINT "friendships_state" CHECK ("state" in ('pending', 'waiting-for-guardian', 'accepted')) NOT VALID;--> statement-breakpoint
ALTER TABLE "friendships" DROP CONSTRAINT "friendships_time", ADD CONSTRAINT "friendships_time" CHECK (("state" in ('pending', 'waiting-for-guardian') and "accepted_at" is null) or ("state" = 'accepted' and "accepted_at" is not null and "accepted_at" >= "requested_at")) NOT VALID;--> statement-breakpoint
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
CREATE POLICY protection_levels_subject ON public.protection_levels FOR ALL
  USING (user_id = daisy_subject_scope())
  WITH CHECK (user_id = daisy_subject_scope());
--> statement-breakpoint
GRANT SELECT, DELETE ON public.protection_levels TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_protection_level(child_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.daisy_protection_guardians(child_id))
    THEN COALESCE((SELECT choice FROM public.protection_levels WHERE user_id = child_id), '{"level":"guided"}')
    ELSE '{"level":"independent"}'::jsonb END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_protection_level(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_protection_level(text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_set_protection_level(child_id text, selected jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.daisy_protection_guardians(child_id)
    WHERE user_id = public.daisy_subject_scope()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protection level cannot be changed';
  END IF;
  INSERT INTO public.protection_levels(user_id, choice) VALUES (child_id, selected)
    ON CONFLICT (user_id) DO UPDATE SET choice = EXCLUDED.choice;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_set_protection_level(text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_set_protection_level(text, jsonb) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_clear_unlinked_protection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.guardian_links
    WHERE minor_user_id = OLD.minor_user_id AND status = 'active') THEN
    DELETE FROM public.protection_levels WHERE user_id = OLD.minor_user_id;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_clear_unlinked_protection() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guardian_links_clear_unlinked_protection
  AFTER UPDATE OF status ON public.guardian_links
  FOR EACH ROW WHEN (OLD.status = 'active' AND NEW.status = 'ended')
  EXECUTE FUNCTION public.daisy_clear_unlinked_protection();
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
  USING ((low_actor_id = daisy_subject_actor_scope()) OR
    (high_actor_id = daisy_subject_actor_scope()) OR daisy_is_protection_guardian(child_actor_id));
--> statement-breakpoint
GRANT SELECT ON public.friend_guardian_approvals TO daisy_web;
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
CREATE FUNCTION public.daisy_friend_guardian_clearances(low_id text, high_id text)
RETURNS TABLE(child_actor_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT approval.child_actor_id FROM public.friend_guardian_approvals approval
  WHERE approval.low_actor_id = low_id AND approval.high_actor_id = high_id
    AND approval.cleared AND public.daisy_friend_approval_pair_scope(low_id, high_id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_friend_guardian_clearances(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_friend_guardian_clearances(text, text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_hold_friend_request(approval_id text, low_id text, high_id text, child_id text)
RETURNS TABLE(user_id text)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH held AS (
    INSERT INTO public.friend_guardian_approvals(id, low_actor_id, high_actor_id, child_actor_id)
    SELECT approval_id, low_id, high_id, child_id
    FROM public.friendships friendship
    WHERE public.daisy_friend_approval_pair_scope(low_id, high_id)
      AND friendship.low_actor_id = low_id AND friendship.high_actor_id = high_id
      AND friendship.state = 'waiting-for-guardian'
    ON CONFLICT DO NOTHING
    RETURNING child_actor_id
  )
  SELECT guardian.user_id FROM held
  JOIN public.actors child ON child.id = held.child_actor_id
  CROSS JOIN LATERAL public.daisy_protection_guardians(child.user_id) guardian
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_hold_friend_request(text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_hold_friend_request(text, text, text, text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_clear_friend_guardian_hold(approval_id text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH cleared AS (
    UPDATE public.friend_guardian_approvals approval SET cleared = true
    FROM public.friendships friendship
    WHERE approval.id = approval_id AND NOT approval.cleared
      AND friendship.low_actor_id = approval.low_actor_id
      AND friendship.high_actor_id = approval.high_actor_id
      AND friendship.state = 'waiting-for-guardian'
      AND public.daisy_is_protection_guardian(approval.child_actor_id)
    RETURNING approval.id
  )
  SELECT EXISTS (SELECT 1 FROM cleared)
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
