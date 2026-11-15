ALTER TABLE "ballots" ADD COLUMN "speaker_ranks" jsonb;--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "rubric_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "reason" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_speaker_ranks_check" CHECK ("speaker_ranks" is null or (jsonb_typeof("speaker_ranks") = 'array' and jsonb_array_length("speaker_ranks") > 0 and not jsonb_path_exists("speaker_ranks", 'strict $[*] ? (@.type() != "array" || @.size() == 0)') and not jsonb_path_exists("speaker_ranks", 'strict $[*][*] ? (@.type() != "string")')));--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_daisy_definition_check", ADD CONSTRAINT "ballots_daisy_definition_check" CHECK ("ballot_definition_id" is not null or "rubric_version" in ('speaker-10@1', 'speaker-10@2', 'rank-sides@1', 'rank-speakers@1'));--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_rubric_version_check", ADD CONSTRAINT "ballots_rubric_version_check" CHECK ("rubric_version" ~ '^[a-z][a-z0-9-]{0,39}@[1-9][0-9]*$');--> statement-breakpoint
-- Existing submissions with no speaker ranks keep byte-identical version-1 digests.
-- An enabled speaker ranking is consumed content and uses digest version 2.
CREATE OR REPLACE FUNCTION daisy_ballot_content_digest(ballot ballots) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to((jsonb_build_object(
    'digest_version', 1,
    'ballot_id', (ballot).id,
    'judge_participant_id', (ballot).judge_participant_id,
    'round_id', (ballot).round_id,
    'freeze_revision', (ballot).freeze_revision,
    'rubric_version', (ballot).rubric_version,
    'decision', (ballot).decision,
    'winner', (ballot).winner,
    'ranking', (ballot).ranking,
    'scores', (ballot).scores,
    'reason', (ballot).reason,
    'feedback', (ballot).feedback,
    'citations', (ballot).citations,
    'ballot_definition_id', (ballot).ballot_definition_id,
    'ballot_definition_version', (ballot).ballot_definition_version,
    'submitted_at_epoch_us', floor(extract(epoch FROM (ballot).submitted_at) * 1000000)
  ) || CASE WHEN (ballot).speaker_ranks IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('digest_version', 2, 'speaker_ranks', (ballot).speaker_ranks) END)::text, 'UTF8')), 'hex')
$$;
