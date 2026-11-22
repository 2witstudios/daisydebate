CREATE FUNCTION public.daisy_lock_protection_accounts(child_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  guardian_ids text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.daisy_protection_guardians(child_id)
    WHERE user_id = public.daisy_subject_scope()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protection level cannot be changed';
  END IF;
  SELECT ARRAY(SELECT guardian_user_id FROM public.guardian_links
    WHERE minor_user_id = child_id AND status = 'active') INTO guardian_ids;
  -- Fence active link accounts, including anyone whose age band is about to change.
  -- Notice inserts need a key-share lock on each recipient. Fence the whole
  -- group in account order before taking the child-choice or request locks.
  PERFORM id FROM public.users WHERE id = child_id OR id = ANY(guardian_ids)
    ORDER BY id FOR SHARE;
  -- Link cleanup takes the same choice lock. Recheck authority and the
  -- fenced guardian accounts after any wait for that lock.
  PERFORM public.daisy_protection_choice_lock(child_id);
  IF NOT EXISTS (SELECT 1 FROM public.daisy_protection_guardians(child_id)
    WHERE user_id = public.daisy_subject_scope()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protection level cannot be changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_links
    WHERE minor_user_id = child_id AND status = 'active'
      AND NOT guardian_user_id = ANY(guardian_ids)) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Protection guardians changed';
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_lock_protection_accounts(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_lock_protection_accounts(text) TO daisy_web;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_set_protection_level(child_id text, selected jsonb,
  happened_at timestamptz DEFAULT statement_timestamp(), notice_ids text[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  previous_choice jsonb;
  newly_covered jsonb;
  new_holds integer;
  hold record;
  hold_id text;
  recipients integer;
  slots integer;
  first_slot integer := 1;
BEGIN
  PERFORM public.daisy_lock_protection_accounts(child_id);
  previous_choice := public.daisy_effective_protection_choice(child_id);
  -- Freeze the pending rows before planning IDs. The child account lock
  -- fences contact commands; the request lock also fences counterpart erasure.
  SELECT coalesce(jsonb_agg(to_jsonb(covered) ORDER BY covered.low_actor_id, covered.high_actor_id), '[]'),
    count(*) FILTER (WHERE covered.id IS NULL)::integer
    INTO newly_covered, new_holds
    FROM (
      SELECT request.low_actor_id, request.high_actor_id, child.id AS child_actor_id, approval.id
      FROM public.actors child
      JOIN public.friendships request ON child.id IN (request.low_actor_id, request.high_actor_id)
      JOIN public.contact_pairs pair USING (low_actor_id, high_actor_id)
      LEFT JOIN public.friend_guardian_approvals approval
        ON approval.low_actor_id = request.low_actor_id AND approval.high_actor_id = request.high_actor_id
        AND approval.child_actor_id = child.id
      CROSS JOIN LATERAL (SELECT CASE WHEN request.low_actor_id = child.id
        THEN request.high_actor_id ELSE request.low_actor_id END AS actor_id) other
      WHERE child.user_id = child_id AND approval.cleared IS NOT TRUE AND request.state = 'pending'
        AND NOT pair.low_blocks_high AND NOT pair.high_blocks_low
        AND NOT public.daisy_friend_approval_needed(child.id, other.actor_id,
          request.requester_actor_id, previous_choice)
        AND public.daisy_friend_approval_needed(child.id, other.actor_id,
          request.requester_actor_id, selected)
      ORDER BY request.low_actor_id, request.high_actor_id
      FOR NO KEY UPDATE OF request
    ) covered;
  SELECT count(*)::integer INTO recipients FROM public.daisy_protection_guardians(child_id);
  -- The application supplies one additional ID for each new approval row.
  slots := new_holds + jsonb_array_length(newly_covered) * recipients;
  -- Counterpart age can cross the policy threshold between the two calls.
  -- An undersized allocation replans without persisting the choice or holds.
  IF slots > coalesce(cardinality(notice_ids), 0) THEN
    PERFORM public.daisy_require_notice_ids(notice_ids, 0);
    RETURN slots;
  END IF;
  PERFORM public.daisy_require_notice_ids(notice_ids, slots);
  INSERT INTO public.protection_levels(user_id, choice) VALUES (child_id, selected)
    ON CONFLICT (user_id) DO UPDATE SET choice = EXCLUDED.choice
    WHERE protection_levels.choice IS DISTINCT FROM excluded.choice;
  FOR hold IN
    SELECT * FROM jsonb_to_recordset(newly_covered)
      AS candidate(low_actor_id text, high_actor_id text, child_actor_id text, id text)
    ORDER BY low_actor_id, high_actor_id
  LOOP
    hold_id := hold.id;
    IF hold_id IS NULL THEN
      INSERT INTO public.friend_guardian_approvals(id, low_actor_id, high_actor_id, child_actor_id)
      VALUES (notice_ids[first_slot], hold.low_actor_id, hold.high_actor_id, hold.child_actor_id)
      ON CONFLICT (low_actor_id, high_actor_id, child_actor_id) DO NOTHING
      RETURNING id INTO hold_id;
      first_slot := first_slot + 1;
    END IF;
    IF hold_id IS NOT NULL THEN
      PERFORM public.daisy_guardian_notice(hold_id, happened_at,
        notice_ids[first_slot:(first_slot + recipients - 1)]);
    END IF;
    first_slot := first_slot + recipients;
  END LOOP;
  RETURN 0;
END
$$;
