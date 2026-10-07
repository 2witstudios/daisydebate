import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { actors } from './schema/actors';
import { ballots } from './schema/ballots';
import { botProfiles } from './schema/bot-profiles';
import { documents, roundDocumentRefs } from './schema/documents';
import { agentRuns } from './schema/agent-runs';
import { formatPresets } from './schema/format-presets';
import { formatRevisions } from './schema/format-revisions';
import { formats } from './schema/formats';
import { ratingChanges, ratings, seasons } from './schema/ratings';
import { roleGrants } from './schema/role-grants';
import { roundCommands } from './schema/round-commands';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';
import { rooms } from './schema/rooms';
import { usageReservations } from './schema/usage-reservations';
import { utterances } from './schema/utterances';
import { users } from './schema/users';

setupRitewayBun();

/**
 * The constraint and index names the integration suites and their negative
 * controls refer to (ADR 0029, ADR 0058). A renamed rule fails here before
 * it fails against PostgreSQL.
 */
const rules = (table: PgTable) => {
  const config = getTableConfig(table);
  return {
    checks: config.checks.map((check) => check.name).sort(),
    indexes: config.indexes
      .map(
        (index) =>
          `${index.config.unique ? 'unique ' : ''}${index.config.name}`,
      )
      .sort(),
    uniques: config.uniqueConstraints.map((unique) => unique.name).sort(),
    // Only explicitly named keys: drizzle-orm 1.0's `getName()` default
    // (`…_fk`) differs from the `…_fkey` name drizzle-kit 1.0 generates, so
    // default names are checked against PostgreSQL in
    // integration/baseline.integration.ts instead.
    namedKeys: config.foreignKeys
      .map((key) => key.reference().name)
      .filter((name): name is string => name !== undefined)
      .sort(),
  };
};

describe('competitive schema rules', () => {
  test('users and actors carry the tombstone and identity rules', () => {
    assert({
      given: 'the users and actors tables',
      should:
        'declare the tombstone and version CHECKs, one actor per user and a human user requirement',
      actual: { users: rules(users).checks, actors: rules(actors) },
      expected: {
        users: ['users_tombstone_scrubbed', 'users_version_positive'],
        actors: {
          checks: [
            'actors_human_has_user',
            'actors_kind_check',
            'actors_version_positive',
          ],
          indexes: ['unique actors_user_id_unique'],
          uniques: [],
          namedKeys: [],
        },
      },
    });
  });

  test('formats, revisions and presets carry the provenance rules', () => {
    assert({
      given: 'the format identity, its revisions and the presets',
      should:
        'declare the pointer positivity CHECK, the revision key, and the presets single-current and provenance keys',
      actual: {
        formats: rules(formats),
        revisions: rules(formatRevisions),
        presets: rules(formatPresets),
      },
      expected: {
        formats: {
          checks: ['formats_current_version_positive'],
          indexes: ['formats_current_revision_idx'],
          uniques: [],
          namedKeys: ['formats_current_revision_fk'],
        },
        revisions: {
          checks: [
            'format_revisions_definition_is_object',
            'format_revisions_version_positive',
          ],
          indexes: [],
          uniques: [],
          namedKeys: [],
        },
        presets: {
          checks: [
            'format_presets_config_is_object',
            'format_presets_format_version_positive',
            'format_presets_length_check',
            'format_presets_version_positive',
          ],
          indexes: [
            'format_presets_revision_idx',
            'unique format_presets_provenance_unique',
            'unique format_presets_single_current',
          ],
          uniques: [],
          namedKeys: ['format_presets_revision_fk'],
        },
      },
    });
  });

  test('rooms and rounds carry the lifecycle and provenance rules', () => {
    assert({
      given: 'the rooms and rounds tables',
      should:
        'declare the room assembly CHECKs, every round vocabulary CHECK, the lifecycle, ladder and preset CHECKs, the indexes and the (id, format_id) key',
      actual: { rooms: rules(rooms), rounds: rules(rounds) },
      expected: {
        rooms: {
          checks: [
            'rooms_competition_type_check',
            'rooms_config_is_object',
            'rooms_execution_plan_is_object',
            'rooms_length_check',
            'rooms_ranked_has_preset_check',
            'rooms_rules_snapshot_is_object',
            'rooms_status_check',
          ],
          indexes: [
            'rooms_definition_revision_idx',
            'unique rooms_single_preset_version',
          ],
          uniques: ['rooms_id_format_unique'],
          namedKeys: [
            'rooms_definition_revision_fk',
            'rooms_preset_provenance_fk',
          ],
        },
        rounds: {
          checks: [
            'rounds_competition_type_check',
            'rounds_completed_after_started',
            'rounds_current_stage_check',
            'rounds_ladder_check',
            'rounds_ladder_derivation_check',
            'rounds_length_check',
            'rounds_lifecycle_check',
            'rounds_outcome_check',
            'rounds_ranked_has_preset_check',
            'rounds_rated_ladder_check',
            'rounds_rules_snapshot_is_object',
            'rounds_runtime_state_is_object',
            'rounds_status_check',
            'rounds_version_positive',
          ],
          indexes: [
            'rounds_created_by_actor_idx',
            'rounds_definition_revision_idx',
            'rounds_format_completed_idx',
            'rounds_preset_provenance_idx',
            'rounds_room_idx',
            'rounds_status_competition_created_idx',
          ],
          uniques: ['rounds_id_format_unique'],
          namedKeys: [
            'rounds_definition_revision_fk',
            'rounds_preset_provenance_fk',
          ],
        },
      },
    });
  });

  test('seats, segments, commands and ballots are keyed to their round', () => {
    assert({
      given: 'the round children',
      should:
        'declare seat uniqueness, the live-interval index, one principal, the digest CHECK and the RESTRICT judge-seat key on ballots',
      actual: {
        participants: rules(roundParticipants),
        segments: rules(roundSegments),
        commands: rules(roundCommands),
        ballots: rules(ballots),
      },
      expected: {
        participants: {
          checks: [
            'round_participants_role_check',
            'round_participants_slot_check',
          ],
          indexes: [
            'round_participants_actor_idx',
            'unique round_participants_actor_unique',
            'unique round_participants_id_round_unique',
            'unique round_participants_seat_unique',
          ],
          uniques: [],
          namedKeys: [],
        },
        segments: {
          checks: [
            'round_segments_duration_positive',
            'round_segments_sequence_check',
            'round_segments_type_check',
          ],
          indexes: [
            'round_segments_started_idx',
            'unique round_segments_id_round_unique',
            'unique round_segments_key_unique',
            'unique round_segments_sequence_unique',
            'unique round_segments_single_open',
          ],
          uniques: [],
          namedKeys: [],
        },
        commands: {
          checks: [
            'round_commands_digest_check',
            'round_commands_one_principal',
            'round_commands_result_is_object',
            'round_commands_type_check',
          ],
          indexes: [
            'round_commands_actor_idx',
            'round_commands_round_version_idx',
          ],
          uniques: [],
          namedKeys: [],
        },
        ballots: {
          checks: [
            'ballots_citations_is_object',
            'ballots_feedback_is_object',
            'ballots_rubric_version_check',
            'ballots_scores_is_object',
            'ballots_status_check',
            'ballots_voided_after_submitted',
            'ballots_voided_fields_check',
            'ballots_winner_check',
          ],
          indexes: [
            'ballots_voided_by_actor_idx',
            'unique ballots_judge_seat_unique',
          ],
          uniques: [],
          namedKeys: ['ballots_judge_seat_fk', 'ballots_voided_by_actor_fk'],
        },
      },
    });
  });

  test('utterances, agent runs, reservations and documents carry the shared-model rules', () => {
    assert({
      given: 'the AI-on-the-model and document tables',
      should:
        'declare the witness keys, the run kind and usage CHECKs, the reservation uniqueness and the document owner rules',
      actual: {
        utterances: rules(utterances),
        runs: rules(agentRuns),
        reservations: rules(usageReservations),
        documents: rules(documents),
        refs: rules(roundDocumentRefs),
        bots: rules(botProfiles),
      },
      expected: {
        utterances: {
          checks: ['utterances_sequence_check', 'utterances_text_length'],
          indexes: [
            'unique utterances_segment_sequence_unique',
            'utterances_participant_idx',
            'utterances_participant_round_idx',
            'utterances_segment_round_idx',
          ],
          uniques: [],
          namedKeys: [
            'utterances_participant_round_fk',
            'utterances_segment_round_fk',
          ],
        },
        runs: {
          checks: [
            'agent_runs_configuration_snapshot_is_object',
            'agent_runs_kind_check',
            'agent_runs_usage_nonnegative',
          ],
          indexes: [
            'agent_runs_participant_kind_idx',
            'agent_runs_started_idx',
          ],
          uniques: [],
          namedKeys: [],
        },
        reservations: {
          checks: ['usage_reservations_kind_check'],
          indexes: [
            'unique usage_reservations_actor_round_kind_unique',
            'usage_reservations_counted_idx',
            'usage_reservations_round_idx',
          ],
          uniques: [],
          namedKeys: [],
        },
        documents: {
          checks: [
            'documents_folder_check',
            'documents_revision_positive',
            'documents_template_check',
            'documents_title_length',
          ],
          indexes: [
            'documents_owner_created_idx',
            'documents_owner_folder_idx',
          ],
          uniques: [],
          namedKeys: [],
        },
        refs: {
          checks: ['round_document_refs_role_check'],
          indexes: ['round_document_refs_document_idx'],
          uniques: [],
          namedKeys: [
            'round_document_refs_document_fk',
            'round_document_refs_round_fk',
          ],
        },
        bots: {
          checks: ['bot_profiles_difficulty_check'],
          indexes: [],
          uniques: [],
          namedKeys: [],
        },
      },
    });
  });
});
