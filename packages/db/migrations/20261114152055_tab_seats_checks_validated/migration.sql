-- Validates the CHECKs the folder before added NOT VALID (TAB-6). A stored
-- row that breaks one must not refuse the deploy: that constraint stays NOT
-- VALID with a warning naming it, still refusing every new write, until the
-- row is repaired and a later migration validates it. A database with no
-- such row ends with every one validated.
DO $$
DECLARE
  pending record;
BEGIN
  FOR pending IN
    SELECT * FROM (VALUES
      ('ballots', 'ballots_decision_check'),
      ('ballots', 'ballots_ranking_check'),
      ('ballots', 'ballots_daisy_definition_check'),
      ('ballots', 'ballots_winner_check'),
      ('ballots', 'ballots_rubric_version_check'),
      ('fixture_entries', 'fixture_entries_side_key'),
      ('room_participants', 'room_participants_seat_kind_check'),
      ('room_participants', 'room_participants_side_check'),
      ('round_participants', 'round_participants_seat_kind_check'),
      ('round_participants', 'round_participants_side_check'),
      ('rooms', 'rooms_event_recording'),
      ('rounds', 'rounds_ranking_shape_check'),
      ('rounds', 'rounds_judging_is_object'),
      ('rounds', 'rounds_platform_ending_check'),
      ('rounds', 'rounds_outcome_check'),
      ('rounds', 'rounds_lifecycle_check'),
      ('content_reports', 'content_reports_feedback_side_check'),
      ('room_invitations', 'room_invitations_seat_check'),
      ('room_seat_holds', 'room_seat_holds_seat_check'),
      ('round_segments', 'round_segments_type_check')
    ) AS added(relation, constraint_name)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', pending.relation, pending.constraint_name);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'constraint % on % stays NOT VALID: stored rows violate it', pending.constraint_name, pending.relation;
    END;
  END LOOP;
END $$;
