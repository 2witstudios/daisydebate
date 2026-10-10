import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { actors } from './schema/actors';
import { formatPresets } from './schema/format-presets';
import { formatRevisions } from './schema/format-revisions';
import { formats } from './schema/formats';
import { rounds } from './schema/rounds';
import { rooms } from './schema/rooms';
import { users } from './schema/users';
import { schemaRules as rules } from './schema.test-support';

setupRitewayBun();

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
          indexes: [
            'formats_created_by_actor_idx',
            'formats_current_revision_idx',
          ],
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
            'rooms_change_version_positive',
            'rooms_competition_type_check',
            'rooms_config_is_object',
            'rooms_execution_plan_is_object',
            'rooms_length_check',
            'rooms_ranked_has_preset_check',
            'rooms_rules_snapshot_is_object',
            'rooms_status_check',
            'rooms_title_nonempty',
            'rooms_topic_nonempty',
            'rooms_version_positive',
            'rooms_visibility_check',
          ],
          indexes: [
            'rooms_definition_revision_idx',
            'rooms_discovery_assembly_idx',
            'rooms_host_actor_idx',
            'rooms_lobby_idx',
            'rooms_preset_version_idx',
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
            'rounds_room_config_snapshot_is_object',
            'rounds_room_freeze_complete',
            'rounds_rules_snapshot_is_object',
            'rounds_runtime_state_is_object',
            'rounds_status_check',
            'rounds_version_positive',
            'rounds_visibility_check',
          ],
          indexes: [
            'rounds_created_by_actor_idx',
            'rounds_definition_revision_idx',
            'rounds_discovery_live_room_idx',
            'rounds_format_completed_idx',
            'rounds_preset_provenance_idx',
            'rounds_status_competition_created_idx',
          ],
          uniques: ['rounds_id_format_unique', 'rounds_room_unique'],
          namedKeys: [
            'rounds_definition_revision_fk',
            'rounds_preset_provenance_fk',
          ],
        },
      },
    });
  });
});
