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
    foreignKeys: config.foreignKeys.map((key) => key.getName()).sort(),
  };
};

describe('competitive schema rules', () => {
  test('users and actors carry the tombstone and identity rules', () => {
    assert({
      given: 'the users and actors tables',
      should:
        'declare the tombstone CHECK, one actor per user and a human user requirement',
      actual: {
        users: rules(users).checks,
        actors: rules(actors),
      },
      expected: {
        users: ['users_tombstone_scrubbed'],
        actors: {
          checks: [
            'actors_human_has_user',
            'actors_kind_check',
            'actors_version_positive',
          ],
          indexes: ['unique actors_user_id_unique'],
          uniques: [],
          foreignKeys: ['actors_user_id_users_id_fk'],
        },
      },
    });
  });

  test('formats and debates carry the lifecycle and vocabulary rules', () => {
    assert({
      given: 'the formats and debates tables',
      should:
        'declare the rules shape CHECK, every debates vocabulary CHECK, the lifecycle CHECK, both indexes and the (id, format) key',
      actual: { formats: rules(formats), debates: rules(debates) },
      expected: {
        formats: {
          checks: ['formats_rules_shape', 'formats_version_positive'],
          indexes: [],
          uniques: [],
          foreignKeys: [],
        },
        debates: {
          checks: [
            'debates_lifecycle_check',
            'debates_mode_check',
            'debates_outcome_check',
            'debates_phase_check',
            'debates_version_positive',
            'debates_visibility_check',
          ],
          indexes: [
            'debates_created_by_idx',
            'debates_format_completed_idx',
            'debates_phase_mode_created_idx',
          ],
          uniques: ['debates_id_format_unique'],
          foreignKeys: [
            'debates_created_by_actors_id_fk',
            'debates_format_formats_id_fk',
          ],
        },
      },
    });
  });

  test('participants, commands and ballots are keyed to their debate', () => {
    assert({
      given: 'the debate children',
      should:
        'declare seat and actor uniqueness, one principal, the digest CHECK and the composite seat key on ballots',
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
          uniques: [
            'debate_participants_actor_unique',
            'debate_participants_debate_id_id_unique',
          ],
          foreignKeys: [
            'debate_participants_actor_id_actors_id_fk',
            'debate_participants_debate_id_debates_id_fk',
          ],
        },
        commands: {
          checks: [
            'debate_commands_digest_check',
            'debate_commands_one_principal',
          ],
          indexes: ['debate_commands_debate_version_idx'],
          uniques: [],
          foreignKeys: [
            'debate_commands_actor_id_actors_id_fk',
            'debate_commands_debate_id_debates_id_fk',
          ],
        },
        ballots: {
          checks: [
            'ballots_decision_check',
            'ballots_status_check',
            'ballots_version_positive',
            'ballots_voided_fields_check',
          ],
          indexes: ['unique ballots_participant_unique'],
          uniques: [],
          foreignKeys: [
            'ballots_debate_id_debates_id_fk',
            'ballots_participant_in_debate_fk',
            'ballots_voided_by_actor_id_actors_id_fk',
          ],
        },
      },
    });
  });

  test('seasons, ratings and the ledger carry the Glicko-2 rules', () => {
    assert({
      given: 'the rating tables',
      should:
        'declare one active season, finite bounded values, the leaderboard index and the ledger composite keys',
      actual: {
        seasons: rules(seasons),
        ratings: rules(ratings),
        changes: rules(ratingChanges),
      },
      expected: {
        seasons: {
          checks: ['seasons_status_check', 'seasons_version_positive'],
          indexes: ['unique seasons_single_active'],
          uniques: [],
          foreignKeys: [],
        },
        ratings: {
          checks: [
            'ratings_deviation_positive',
            'ratings_rating_range',
            'ratings_version_positive',
            'ratings_volatility_positive',
          ],
          indexes: ['ratings_leaderboard_idx'],
          uniques: [],
          foreignKeys: [
            'ratings_actor_id_actors_id_fk',
            'ratings_format_id_formats_id_fk',
            'ratings_season_id_seasons_id_fk',
          ],
        },
        changes: {
          checks: [
            'rating_changes_deviation_positive',
            'rating_changes_rating_range',
            'rating_changes_volatility_positive',
          ],
          indexes: [
            'rating_changes_actor_format_occurred_idx',
            'unique rating_changes_debate_actor_unique',
          ],
          uniques: [],
          foreignKeys: [
            'rating_changes_actor_id_actors_id_fk',
            'rating_changes_debate_format_fk',
            'rating_changes_debate_id_debates_id_fk',
            'rating_changes_format_id_formats_id_fk',
            'rating_changes_participant_fk',
            'rating_changes_season_id_seasons_id_fk',
          ],
        },
      },
    });
  });

  test('role grants allow one active grant per scope', () => {
    assert({
      given: 'the role_grants table',
      should:
        'declare the vocabulary CHECKs, the global scope rule and the partial active-grant index',
      actual: rules(roleGrants),
      expected: {
        checks: [
          'role_grants_global_scope_check',
          'role_grants_role_check',
          'role_grants_scope_type_check',
        ],
        indexes: ['unique role_grants_active_unique'],
        uniques: [],
        foreignKeys: [
          'role_grants_granted_by_user_id_users_id_fk',
          'role_grants_user_id_users_id_fk',
        ],
      },
    });
  });
});
