import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { agentRuns } from './schema/agent-runs';
import { ballots } from './schema/ballots';
import { botProfiles } from './schema/bot-profiles';
import { documents, roundDocumentRefs } from './schema/documents';
import { roundCommands } from './schema/round-commands';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import { usageReservations } from './schema/usage-reservations';
import { utterances } from './schema/utterances';
import { schemaRules as rules } from './schema.test-support';

setupRitewayBun();

describe('competitive schema child tables', () => {
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
          checks: [
            'utterances_generation_pair',
            'utterances_sequence_check',
            'utterances_text_length',
          ],
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
