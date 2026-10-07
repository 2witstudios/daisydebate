import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { ratingChanges, ratings, seasons } from './schema/ratings';
import { roleGrants } from './schema/role-grants';
import {
  memberInterests,
  memberOnboarding,
  memberTopics,
} from './schema/onboarding';

setupRitewayBun();

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
    namedKeys: config.foreignKeys
      .map((key) => key.reference().name)
      .filter((name): name is string => name !== undefined)
      .sort(),
  };
};

describe('ratings schema rules', () => {
  test('ratings and role grants keep their ladder and scope rules', () => {
    assert({
      given: 'the ratings tables and role grants',
      should: 'declare the single-active season, the ledger bounds and grants',
      actual: {
        seasons: rules(seasons).checks,
        ratings: rules(ratings).checks,
        changes: rules(ratingChanges).checks,
        grants: rules(roleGrants).checks,
        onboarding: rules(memberOnboarding).checks,
        interests: rules(memberInterests).checks,
        topics: rules(memberTopics).checks,
      },
      expected: {
        seasons: [
          'seasons_ends_after_starts',
          'seasons_status_check',
          'seasons_version_positive',
        ],
        ratings: [
          'ratings_deviation_positive',
          'ratings_ladder_check',
          'ratings_rating_range',
          'ratings_version_positive',
          'ratings_volatility_positive',
        ],
        changes: [
          'rating_changes_deviation_positive',
          'rating_changes_ladder_check',
          'rating_changes_rating_range',
          'rating_changes_volatility_positive',
        ],
        grants: [
          'role_grants_global_scope_check',
          'role_grants_revoked_after_granted',
          'role_grants_role_check',
          'role_grants_scope_type_check',
        ],
        onboarding: [
          'member_onboarding_club_check',
          'member_onboarding_experience_check',
          'member_onboarding_formats_check',
          'member_onboarding_length_check',
          'member_onboarding_version_positive',
        ],
        interests: ['member_interests_interest_check'],
        topics: ['member_topics_topic_check'],
      },
    });
  });
});
