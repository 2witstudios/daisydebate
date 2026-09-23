import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { actors } from './schema/actors';
import { ballots } from './schema/ballots';
import { debateCommands } from './schema/debate-commands';
import { debateParticipants } from './schema/debate-participants';
import { debates } from './schema/debates';
import { formats } from './schema/formats';
import { ratingChanges, ratings, seasons } from './schema/ratings';
import { roleGrants } from './schema/role-grants';
import { users } from './schema/users';

setupRitewayBun();

/**
 * The constraint and index names the integration suites and their negative
 * controls refer to (ADR 0029). A renamed rule fails here before it fails
 * against PostgreSQL.
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

  test('formats and debates carry the lifecycle and vocabulary rules', () => {
    assert({
      given: 'the formats and debates tables',
      should:
        'declare the object and rules shape CHECKs, every debates vocabulary CHECK, the lifecycle and ordering CHECKs, the indexes and the (id, format_id) key',
      actual: { formats: rules(formats), debates: rules(debates) },
      expected: {
        formats: {
          checks: [
            'formats_rules_is_object',
            'formats_rules_shape',
            'formats_version_positive',
          ],
          indexes: [],
          uniques: [],
          namedKeys: [],
        },
        debates: {
          checks: [
            'debates_completed_after_started',
            'debates_lifecycle_check',
            'debates_mode_check',
            'debates_outcome_check',
            'debates_phase_check',
            'debates_snapshot_is_object',
            'debates_version_positive',
            'debates_visibility_check',
          ],
          indexes: [
            'debates_created_by_actor_idx',
            'debates_format_completed_idx',
            'debates_phase_mode_created_idx',
          ],
          uniques: ['debates_id_format_unique'],
          namedKeys: [],
        },
      },
    });
  });

  test('participants, commands and ballots are keyed to their debate', () => {
    assert({
      given: 'the debate children',
      should:
        'declare seat uniqueness, one principal, the digest and object CHECKs and the composite judge-seat key on ballots',
      actual: {
        participants: rules(debateParticipants),
        commands: rules(debateCommands),
        ballots: rules(ballots),
      },
      expected: {
        participants: {
          checks: [
            'debate_participants_role_check',
            'debate_participants_slot_check',
            'debate_participants_status_check',
            'debate_participants_version_positive',
          ],
          indexes: [
            'debate_participants_actor_joined_idx',
            'unique debate_participants_seat_unique',
          ],
          uniques: [],
          namedKeys: [],
        },
        commands: {
          checks: [
            'debate_commands_digest_check',
            'debate_commands_one_principal',
            'debate_commands_result_is_object',
          ],
          indexes: [
            'debate_commands_actor_idx',
            'debate_commands_debate_version_idx',
          ],
          uniques: [],
          namedKeys: [],
        },
        ballots: {
          checks: [
            'ballots_decision_check',
            'ballots_scores_is_object',
            'ballots_status_check',
            'ballots_version_positive',
            'ballots_voided_after_submitted',
            'ballots_voided_fields_check',
          ],
          indexes: [
            'ballots_voided_by_actor_idx',
            'unique ballots_judge_seat_unique',
          ],
          uniques: [],
          namedKeys: ['ballots_judge_seat_fk'],
        },
      },
    });
  });

  test('seasons, ratings and the ledger carry the Glicko-2 rules', () => {
    assert({
      given: 'the rating tables',
      should:
        'declare one active season ending after it starts, finite bounded values, the leaderboard and key indexes and the ledger composite keys',
      actual: {
        seasons: rules(seasons),
        ratings: rules(ratings),
        changes: rules(ratingChanges),
      },
      expected: {
        seasons: {
          checks: [
            'seasons_ends_after_starts',
            'seasons_status_check',
            'seasons_version_positive',
          ],
          indexes: ['unique seasons_single_active'],
          uniques: [],
          namedKeys: [],
        },
        ratings: {
          checks: [
            'ratings_deviation_positive',
            'ratings_rating_range',
            'ratings_version_positive',
            'ratings_volatility_positive',
          ],
          indexes: ['ratings_leaderboard_idx', 'ratings_season_idx'],
          uniques: [],
          namedKeys: [],
        },
        changes: {
          checks: [
            'rating_changes_deviation_positive',
            'rating_changes_rating_range',
            'rating_changes_volatility_positive',
          ],
          indexes: [
            'rating_changes_actor_format_occurred_idx',
            'rating_changes_debate_format_idx',
            'rating_changes_format_idx',
            'rating_changes_season_idx',
            'unique rating_changes_debate_actor_unique',
          ],
          uniques: [],
          namedKeys: [
            'rating_changes_debate_format_fk',
            'rating_changes_participant_fk',
          ],
        },
      },
    });
  });

  test('role grants allow one active grant per scope', () => {
    assert({
      given: 'the role_grants table',
      should:
        'declare the vocabulary CHECKs, the global scope and ordering rules, the key indexes and the partial active-grant index',
      actual: rules(roleGrants),
      expected: {
        checks: [
          'role_grants_global_scope_check',
          'role_grants_revoked_after_granted',
          'role_grants_role_check',
          'role_grants_scope_type_check',
        ],
        indexes: [
          'role_grants_granted_by_user_idx',
          'role_grants_user_idx',
          'unique role_grants_active_unique',
        ],
        uniques: [],
        namedKeys: [],
      },
    });
  });
});
