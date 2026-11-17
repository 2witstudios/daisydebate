-- TAB-6: seats, sides, outcome kinds, ballot definitions and recording
-- policies. ADR 0023: every stored row is rewritten once into the one new
-- shape. Order: add the new columns, rewrite the rows, settle the deferred
-- checks the rewrite queued, then drop the old columns and add the CHECKs.
-- Every CHECK goes on NOT VALID; the next folder validates it (database
-- operations: a CHECK on a table that holds rows goes in two folders).
-- Proved against seeded old-shape rows by tab-seats-migration.integration.ts.
--
-- The triggers whose WHEN names a column this folder drops go first, so the
-- rewrite queues none of their events; they come back on the new columns.
DROP TRIGGER "round_participants_winnerless_completion_check" ON "round_participants";--> statement-breakpoint
DROP TRIGGER "rounds_winnerless_completion_check" ON "rounds";--> statement-breakpoint
ALTER TABLE "room_participants" ADD COLUMN "seat_kind" text;--> statement-breakpoint
ALTER TABLE "room_participants" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "round_participants" ADD COLUMN "seat_kind" text;--> statement-breakpoint
ALTER TABLE "round_participants" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "winning_side" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "ranking" jsonb;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "judging" jsonb;--> statement-breakpoint
ALTER TABLE "ballots" ADD COLUMN "decision" text DEFAULT 'win' NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ADD COLUMN "ranking" jsonb;--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "rubric_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "winner" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "scores" DROP NOT NULL;--> statement-breakpoint
-- The checkpoint a Round starts with is its sides' own (emptyRuntimeCheckpointFor);
-- its writer names it, so there is no two-sided default.
ALTER TABLE "rounds" ALTER COLUMN "runtime_state" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "room_invitations" DROP CONSTRAINT "room_invitations_seat_check";--> statement-breakpoint
ALTER TABLE "room_seat_holds" DROP CONSTRAINT "room_seat_holds_seat_check";--> statement-breakpoint
ALTER TABLE "fixture_entries" DROP CONSTRAINT "fixture_entries_side_nonempty";--> statement-breakpoint
-- A seat's role becomes its kind and, for a debater, its side: the two-sided
-- preset's keys are the old role words, so a side keeps its spelling.
UPDATE "room_participants" SET "seat_kind" = CASE WHEN "role" = 'judge' THEN 'judge' ELSE 'side' END, "side" = CASE WHEN "role" = 'judge' THEN NULL ELSE "role" END;--> statement-breakpoint
UPDATE "round_participants" SET "seat_kind" = CASE WHEN "role" = 'judge' THEN 'judge' ELSE 'side' END, "side" = CASE WHEN "role" = 'judge' THEN NULL ELSE "role" END;--> statement-breakpoint
-- A hold or an invitation for a debater's seat is for a side's seat.
UPDATE "room_seat_holds" SET "seat" = 'side' WHERE "seat" = 'debater';--> statement-breakpoint
UPDATE "room_invitations" SET "seat" = 'side' WHERE "seat" = 'debater';--> statement-breakpoint
-- A Round's outcome was its winning side; that side keeps its value.
UPDATE "rounds" SET "winning_side" = "outcome" WHERE "outcome" IS NOT NULL;--> statement-breakpoint
-- Every Round so far is a two-sided winner Round judged on Daisy's speaker
-- ballot: the revision its ballots were written on (speaker-10@1 where they
-- were, otherwise the current speaker-10@2), decided by majority, quorum one.
UPDATE "rounds" r SET "judging" = CASE WHEN EXISTS (SELECT 1 FROM "ballots" b WHERE b."round_id" = r."id" AND b."rubric_version" = 'speaker-10@1') THEN '{"ballot":{"key":"speaker-10","revision":1,"decision":{"kind":"winner","lowPointWin":true,"tie":false,"doubleLoss":false},"points":{"per":"side","scale":{"min":1,"max":5,"step":1},"default":3,"criteria":{"kind":"grid","groups":[{"id":"construction","name":"Construction","categories":[{"id":"thesis","name":"Thesis","rewards":"One clear claim carried through","anchors":["No central claim","Claim stated, drifts","Every speech serves one claim"]},{"id":"framework","name":"Framework","rewards":"Set the standard and won it","anchors":["No standard offered","Standard offered, not defended","Set the terms the round was judged on"]},{"id":"analysis","name":"Analysis","rewards":"Warranted why, not asserted","anchors":["Assertions only, or invented evidence","Some warrants and examples","Every claim warranted, examples accurate"]}]},{"id":"clash","name":"Clash","categories":[{"id":"refutation","name":"Refutation","rewards":"Answered theirs, dropped nothing","anchors":["Ignored the opponent","Answered some, dropped some","Answered every key argument, extended the answers"]},{"id":"impact","name":"Impact","rewards":"Said why each argument matters","anchors":["No stakes","Stakes stated, not developed","Clear magnitude, likelihood and timeframe"]},{"id":"weighing","name":"Weighing","rewards":"Compared: why mine outweighs","anchors":["No comparison","Asserted “we outweigh”","Explicit comparison on the opponent’s terms"]}]},{"id":"cross-ex","name":"Cross-ex","categories":[{"id":"questioning","name":"Questioning","rewards":"Questions that set up arguments","anchors":["Aimless, or speeches as questions","Some useful concessions","Won concessions used later"]},{"id":"answering","name":"Answering","rewards":"Direct, honest, no evasion","anchors":["Evasive or stalling","Mostly direct","Concise, honest, kept position"]}]},{"id":"presentation","name":"Presentation","categories":[{"id":"organization","name":"Organization","rewards":"Signposted, easy to flow","anchors":["Impossible to follow","Mostly followable","Roadmap, signposts, clean flow"]},{"id":"delivery","name":"Delivery","rewards":"Clear, paced, persuasive","anchors":["Unclear or rushed","Understandable","Clear, confident, used the time"]}]}]},"weights":null},"speakerRanks":false,"written":{"reason":{"required":true,"max":600},"feedback":{"required":false,"max":280}}},"panel":{"decision":"majority","quorum":1}}'::jsonb ELSE '{"ballot":{"key":"speaker-10","revision":2,"decision":{"kind":"winner","lowPointWin":true,"tie":false,"doubleLoss":false},"points":{"per":"side","scale":{"min":1,"max":5,"step":1},"default":3,"criteria":{"kind":"grid","groups":[{"id":"case","name":"Case","categories":[{"id":"thesis","name":"Thesis","rewards":"One clear answer to the resolution","anchors":["No clear answer to the resolution","Thesis stated, drifts","Every speech serves one thesis"]},{"id":"burdens","name":"Burdens","rewards":"Set what must be true, and won it","anchors":["No burdens set","Burdens set, not defended","Set the burdens the round was decided on, and won the dispute over them"]},{"id":"warrants","name":"Warrants","rewards":"Each burden backed by reasons","anchors":["Assertions only, or invented evidence","Some burdens warranted","Every burden warranted with reasons or accurate examples"]},{"id":"coherence","name":"Coherence","rewards":"Consistent with its own thesis","anchors":["The case contradicts itself","One damaging inconsistency or concession against its own thesis","Fully consistent with its own thesis and burdens"]}]},{"id":"clash","name":"Clash","categories":[{"id":"refutation","name":"Refutation","rewards":"Attacked what their case depends on","anchors":["Ignored the opponent","Answered surface arguments, left the premises they depend on standing","Defeated the premises the opponent’s case depends on, and answered attacks on its own"]},{"id":"weighing","name":"Weighing","rewards":"Compared what still stands","anchors":["No comparison","Asserted “we outweigh”","Explicit comparison of what still stands, with magnitude and likelihood, under the governing burdens"]}]},{"id":"cross-ex","name":"Cross-ex","categories":[{"id":"questioning","name":"Questioning","rewards":"Won concessions on their burdens","anchors":["Aimless, or speeches as questions","Useful concessions, not used","Won concessions on the opponent’s burdens and used them"]},{"id":"answering","name":"Answering","rewards":"Direct, and kept the case intact","anchors":["Evasive or stalling","Direct, but gave away part of its own case","Direct and honest, and kept its thesis and burdens intact"]}]},{"id":"presentation","name":"Presentation","categories":[{"id":"organization","name":"Organization","rewards":"Case structure easy to follow","anchors":["Impossible to follow","Mostly followable","The case structure (thesis, burdens, signposts) is easy to follow"]},{"id":"delivery","name":"Delivery","rewards":"Clear, paced, persuasive","anchors":["Unclear or rushed","Understandable","Clear, confident, used the time"]}]}]},"weights":null},"speakerRanks":false,"written":{"reason":{"required":true,"max":600},"feedback":{"required":false,"max":280}}},"panel":{"decision":"majority","quorum":1}}'::jsonb END;--> statement-breakpoint
-- Casual capture: a Recording that was made is released as Daisy releases one.
UPDATE "rooms" SET "capture" = ("capture" - 'recording') || jsonb_build_object('recordingPolicy', CASE WHEN ("capture"->>'recording')::boolean THEN 'released' ELSE 'off' END) WHERE "capture" ? 'recording';--> statement-breakpoint
UPDATE "rounds" SET "capture" = ("capture" - 'recording') || jsonb_build_object('recordingPolicy', CASE WHEN ("capture"->>'recording')::boolean THEN 'released' ELSE 'off' END) WHERE "capture" ? 'recording';--> statement-breakpoint
-- A stored receipt's outcome was the winning side; it is now that side's win.
UPDATE "round_commands" SET "result" = jsonb_set("result", '{outcome}', jsonb_build_object('kind', 'winner', 'side', "result"->'outcome')) WHERE jsonb_typeof("result"->'outcome') = 'string';--> statement-breakpoint
-- An evidence speaker's role and slot are its side's seat.
UPDATE "necessary_evidence" SET "original_speaker" = ("original_speaker" - 'role' - 'slot') || jsonb_build_object('seat', jsonb_build_object('kind', 'side', 'side', "original_speaker"->'role', 'slot', "original_speaker"->'slot')) WHERE "original_speaker" ? 'role';--> statement-breakpoint
-- Definitions to version 2 and resolved rules to version 3 (TAB-6.2): the
-- two-sided preset's sides, seats by kind, a winner outcome, and each
-- segment's speak rights: a speech is its seat's alone, a cross-examination
-- every seat's, led by the asker. This function lives only in this folder.
CREATE FUNCTION "tab6_two_sided"("format" jsonb, "version" int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $tab6$
  SELECT ("format" - 'seats' - 'segments' - 'version') || jsonb_build_object(
    'version', "version",
    'sides', '[{"key":"affirmative","label":"Affirmative","short":"Aff"},{"key":"negative","label":"Negative","short":"Neg"}]'::jsonb,
    'seats', jsonb_build_object(
      'sides', jsonb_build_object('affirmative', "format"->'seats'->'affirmative', 'negative', "format"->'seats'->'negative'),
      'speakers', 0, 'judges', "format"->'seats'->'judge', 'moderators', 0),
    'outcome', '{"kind":"winner"}'::jsonb,
    'segments', (
      SELECT jsonb_agg(("segment" - 'side' - 'slot') || jsonb_build_object('speak',
        CASE "segment"->>'type'
          WHEN 'speech' THEN jsonb_build_object('rights', 'one', 'seat', jsonb_build_object('kind', 'side', 'side', "segment"->'side', 'slot', "segment"->'slot'))
          ELSE jsonb_build_object('rights', 'all', 'lead', jsonb_build_object('kind', 'side', 'side', "segment"->'side', 'slot', "segment"->'slot'))
        END) ORDER BY "position")
      FROM jsonb_array_elements("format"->'segments') WITH ORDINALITY AS listed("segment", "position")))
$tab6$;--> statement-breakpoint
UPDATE "format_revisions" SET "definition" = "tab6_two_sided"("definition", 2) WHERE ("definition"->>'version')::int = 1;--> statement-breakpoint
UPDATE "rooms" SET "rules_snapshot" = "tab6_two_sided"("rules_snapshot", 3) WHERE ("rules_snapshot"->>'version')::int = 2;--> statement-breakpoint
UPDATE "rounds" SET "rules_snapshot" = "tab6_two_sided"("rules_snapshot", 3) WHERE ("rules_snapshot"->>'version')::int = 2;--> statement-breakpoint
DROP FUNCTION "tab6_two_sided"(jsonb, int);--> statement-breakpoint
-- The one active Room per user holds seated humans only: a host without a
-- seat is no longer held.
ALTER TABLE "room_active_memberships" RENAME TO "active_seats";--> statement-breakpoint
ALTER TABLE "active_seats" RENAME CONSTRAINT "room_active_memberships_pkey" TO "active_seats_pkey";--> statement-breakpoint
ALTER TABLE "active_seats" RENAME CONSTRAINT "room_active_memberships_actor_id_actors_id_fkey" TO "active_seats_actor_id_actors_id_fkey";--> statement-breakpoint
ALTER TABLE "active_seats" RENAME CONSTRAINT "room_active_memberships_room_id_rooms_id_fkey" TO "active_seats_room_id_rooms_id_fkey";--> statement-breakpoint
ALTER TABLE "active_seats" RENAME CONSTRAINT "room_active_memberships_actor_id_not_null" TO "active_seats_actor_id_not_null";--> statement-breakpoint
ALTER TABLE "active_seats" RENAME CONSTRAINT "room_active_memberships_room_id_not_null" TO "active_seats_room_id_not_null";--> statement-breakpoint
ALTER TABLE "active_seats" RENAME CONSTRAINT "room_active_memberships_created_at_not_null" TO "active_seats_created_at_not_null";--> statement-breakpoint
ALTER INDEX "room_active_memberships_room_idx" RENAME TO "active_seats_room_idx";--> statement-breakpoint
DELETE FROM "active_seats" s WHERE NOT EXISTS (SELECT 1 FROM "room_participants" p WHERE p."room_id" = s."room_id" AND p."actor_id" = s."actor_id");--> statement-breakpoint
-- The rewrite above queued deferred checks on the rewritten tables; they run
-- now, before any DDL on those tables.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "room_participants" ALTER COLUMN "seat_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "round_participants" ALTER COLUMN "seat_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "room_participants" DROP CONSTRAINT "room_participants_role_check";--> statement-breakpoint
ALTER TABLE "round_participants" DROP CONSTRAINT "round_participants_role_check";--> statement-breakpoint
DROP INDEX "room_participants_seat_unique";--> statement-breakpoint
DROP INDEX "round_participants_seat_unique";--> statement-breakpoint
ALTER TABLE "room_participants" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "round_participants" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_outcome_check";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_lifecycle_check";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_platform_ending_check";--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "outcome";--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_seat_unique" UNIQUE NULLS NOT DISTINCT("room_id","seat_kind","side","slot");--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_seat_unique" UNIQUE NULLS NOT DISTINCT("round_id","seat_kind","side","slot");--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_decision_check" CHECK ("decision" in ('win', 'tie', 'double_loss', 'ranking')) NOT VALID;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_ranking_check" CHECK (("ranking" is not null) = ("decision" = 'ranking') and ("ranking" is null or jsonb_typeof("ranking") = 'array')) NOT VALID;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_daisy_definition_check" CHECK (("ballot_definition_id" is null) = ("rubric_version" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "fixture_entries" ADD CONSTRAINT "fixture_entries_side_key" CHECK ("side" is null or ("side" ~ '^[a-z][a-z_]{0,23}$' and "side" not in ('side', 'speaker', 'judge', 'moderator'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_seat_kind_check" CHECK ("seat_kind" in ('side', 'speaker', 'judge', 'moderator')) NOT VALID;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_side_check" CHECK (("side" is not null) = ("seat_kind" = 'side') and ("side" is null or ("side" ~ '^[a-z][a-z_]{0,23}$' and "side" not in ('side', 'speaker', 'judge', 'moderator')))) NOT VALID;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_event_recording" CHECK ("lobby_kind" <> 'tournament' or ("capture" is not null and "capture"->>'recordingPolicy' in ('off', 'officials'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_seat_kind_check" CHECK ("seat_kind" in ('side', 'speaker', 'judge', 'moderator')) NOT VALID;--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_side_check" CHECK (("side" is not null) = ("seat_kind" = 'side') and ("side" is null or ("side" ~ '^[a-z][a-z_]{0,23}$' and "side" not in ('side', 'speaker', 'judge', 'moderator')))) NOT VALID;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_ranking_shape_check" CHECK ("ranking" is null or (jsonb_typeof("ranking") = 'array' and jsonb_array_length("ranking") > 0 and not jsonb_path_exists("ranking", 'strict $[*] ? (@.type() != "array" || @.size() == 0)') and not jsonb_path_exists("ranking", 'strict $[*][*] ? (@.type() != "string")'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_judging_is_object" CHECK (jsonb_typeof("judging") = 'object') NOT VALID;--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_winner_check", ADD CONSTRAINT "ballots_winner_check" CHECK (("winner" is not null) = ("decision" = 'win') and ("winner" is null or ("winner" ~ '^[a-z][a-z_]{0,23}$' and "winner" not in ('side', 'speaker', 'judge', 'moderator')))) NOT VALID;--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_rubric_version_check", ADD CONSTRAINT "ballots_rubric_version_check" CHECK ("rubric_version" is null or "rubric_version" in ('speaker-10@1', 'speaker-10@2', 'rank-sides@1', 'rank-speakers@1')) NOT VALID;--> statement-breakpoint
ALTER TABLE "content_reports" RENAME COLUMN "feedback_side" TO "feedback_subject";--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_feedback_side_check", ADD CONSTRAINT "content_reports_feedback_subject_check" CHECK (("target_kind" = 'ballot_feedback') = ("feedback_subject" is not null) and ("feedback_subject" is null or ("feedback_subject" ~ '^[a-z][a-z_]{0,23}$' and "feedback_subject" not in ('side', 'speaker', 'judge', 'moderator')) or "feedback_subject" ~ '^[a-z0-9]{24}$')) NOT VALID;--> statement-breakpoint
ALTER TABLE "round_commands" DROP CONSTRAINT "round_commands_type_check", ADD CONSTRAINT "round_commands_type_check" CHECK ("type" in ('start', 'strike_resolution', 'start_prep', 'start_speech', 'yield', 'interrupt', 'forfeit', 'leave', 'complete', 'submit_ballot', 'check_in', 'adjudicate')) NOT VALID;--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_seat_check" CHECK ("seat" in ('side', 'speaker', 'judge', 'moderator')) NOT VALID;--> statement-breakpoint
ALTER TABLE "room_seat_holds" ADD CONSTRAINT "room_seat_holds_seat_check" CHECK ("seat" in ('side', 'speaker', 'judge', 'moderator')) NOT VALID;--> statement-breakpoint
ALTER TABLE "round_segments" DROP CONSTRAINT "round_segments_type_check", ADD CONSTRAINT "round_segments_type_check" CHECK ("type" in ('speech', 'cross_ex', 'open')) NOT VALID;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_platform_ending_check" CHECK ("platform_ending" is null or ("platform_ending" = 'recovery_bound' and "status" = 'abandoned') or ("platform_ending" = 'capture_shortfall' and "status" = 'completed' and "winning_side" is null and "ranking" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_outcome_check" CHECK (("winning_side" is null or "ranking" is null) and ("winning_side" is null or ("winning_side" ~ '^[a-z][a-z_]{0,23}$' and "winning_side" not in ('side', 'speaker', 'judge', 'moderator')))) NOT VALID;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_lifecycle_check" CHECK (("status" = 'opening' and "current_stage" is null and "winning_side" is null and "ranking" is null and "started_at" is null and "completed_at" is null) or ("status" = 'active' and "resolution" is not null and "current_stage" is not null and "winning_side" is null and "ranking" is null and "started_at" is not null and "completed_at" is null) or ("status" = 'completed' and "current_stage" is null and "started_at" is not null and "completed_at" is not null) or ("status" = 'abandoned' and "current_stage" is null and "winning_side" is null and "ranking" is null and "completed_at" is not null)) NOT VALID;--> statement-breakpoint
-- A Round with a human judge completes without a result only once every
-- human judge has ruled or their deadline has passed: the same guard, read
-- from the seat's kind and the Round's winning side and ranking.
CREATE OR REPLACE FUNCTION public.guard_winnerless_round_completion() RETURNS trigger LANGUAGE plpgsql AS $guard$
DECLARE target_round text;
BEGIN
  IF TG_TABLE_NAME = 'rounds' THEN
    target_round := NEW.id;
  ELSE
    target_round := NEW.round_id;
  END IF;
  PERFORM id FROM rounds WHERE id = target_round FOR NO KEY UPDATE;
  IF EXISTS (
    SELECT 1 FROM rounds r
    WHERE r.id = target_round AND r.status = 'completed' AND r.winning_side IS NULL AND r.ranking IS NULL
      AND EXISTS (
        SELECT 1 FROM round_participants p JOIN actors a ON a.id = p.actor_id
        WHERE p.round_id = r.id AND p.seat_kind = 'judge' AND a.kind = 'human'
          AND NOT EXISTS (SELECT 1 FROM ballots b WHERE b.judge_participant_id = p.id)
      )
      AND (r.ballot_deadline_at IS NULL OR clock_timestamp() < r.ballot_deadline_at)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_winnerless_completion_check', MESSAGE = 'A Round with a human judge completes without a result only once every human judge has ruled or their deadline has passed';
  END IF;
  RETURN NEW;
END;
$guard$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "round_participants_winnerless_completion_check" AFTER INSERT OR UPDATE ON "round_participants" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.seat_kind = 'judge') EXECUTE FUNCTION public.guard_winnerless_round_completion();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "rounds_winnerless_completion_check" AFTER INSERT OR UPDATE ON "rounds" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.status = 'completed' AND NEW.winning_side IS NULL AND NEW.ranking IS NULL) EXECUTE FUNCTION public.guard_winnerless_round_completion();--> statement-breakpoint
-- Round floor chat: a competitor's seat (a side's or a speaker's) is a
-- debater's; any other seat holds no floor role; the creator unseated hosts.
CREATE OR REPLACE FUNCTION public.daisy_round_floor_fact(requested_round_id text, requested_actor_id text)
RETURNS TABLE(version bigint, status text, completed_at timestamp with time zone, audience text, channel_id text, authority_revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $round_floor_fact$
 SELECT r.version::bigint,r.status,r.completed_at,
 CASE WHEN p.seat_kind IN ('side','speaker') THEN 'debater' WHEN p.seat_kind IS NOT NULL THEN NULL
 WHEN r.created_by_actor_id=requested_actor_id THEN 'host' ELSE NULL END,
 c.id,c.authority_revision
 FROM public.rounds r LEFT JOIN public.round_participants p ON p.round_id=r.id AND p.actor_id=requested_actor_id
 LEFT JOIN public.messaging_channels c ON c.round_id=r.id AND c.kind='round_floor'
 WHERE r.id=requested_round_id AND (c.id IS NULL OR (c.policy_revision=1 AND c.lifecycle='active'));
$round_floor_fact$;--> statement-breakpoint
-- Room chat names the reader's seat by its kind. Its result columns change,
-- so the function is created again with the grants it had.
DROP FUNCTION public.daisy_room_community_fact(text,text);--> statement-breakpoint
CREATE FUNCTION public.daisy_room_community_fact(requested_room_id text, requested_actor_id text)
RETURNS TABLE(version bigint,status text,visibility text,ended_at timestamptz,host boolean,seat_kind text,channel_id text,authority_revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $room_community_fact$
 SELECT r.version::bigint+r.change_version::bigint,r.status,r.visibility,
 CASE WHEN r.status IN ('assembling','ready') THEN NULL ELSE r.updated_at END,
 r.host_actor_id=requested_actor_id,p.seat_kind,
 c.id,c.authority_revision
 FROM public.rooms r LEFT JOIN public.room_participants p ON p.room_id=r.id AND p.actor_id=requested_actor_id
 LEFT JOIN public.messaging_channels c ON c.room_id=r.id AND c.kind='room_community'
 WHERE r.id=requested_room_id AND (c.id IS NULL OR (c.policy_revision=1 AND c.lifecycle='active'));
$room_community_fact$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_community_fact(text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_community_fact(text,text) TO daisy_web, daisy_realtime;--> statement-breakpoint
-- The realtime service read a Room seat's role; it reads its kind and side.
GRANT SELECT ("seat_kind", "side") ON "room_participants" TO daisy_realtime;
