import {
  clubChoices,
  experienceChoices,
  interestCategoryChoices,
  wantChoices,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { users } from './users';

/**
 * What a member said they want to do on Daisy (onboarding's "I want to").
 * Personal and private (ADR 0036): deleted with the account.
 */
export const memberInterests = pgTable(
  'member_interests',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    interest: text('interest').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.interest] }),
    check(
      'member_interests_interest_check',
      oneOf(table.interest, wantChoices),
    ),
  ],
);

/** The debate topics a member picked in onboarding. Personal and private. */
export const memberTopics = pgTable(
  'member_topics',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.topic] }),
    check(
      'member_topics_topic_check',
      oneOf(table.topic, interestCategoryChoices),
    ),
  ],
);

/**
 * A member's single-choice onboarding answers and when they finished
 * (Finish or Skip). Personal and private: deleted with the account.
 */
export const memberOnboarding = pgTable(
  'member_onboarding',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    club: text('club'),
    /** The club a member has or is starting, as they named it. Personal and private. */
    clubName: text('club_name'),
    experience: text('experience'),
    completedAt: timestampColumn('completed_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    check(
      'member_onboarding_club_check',
      sql`${table.club} is null or ${oneOf(table.club, clubChoices)}`,
    ),
    check(
      'member_onboarding_experience_check',
      sql`${table.experience} is null or ${oneOf(table.experience, experienceChoices)}`,
    ),
    versionPositive('member_onboarding', table.version),
  ],
);

/**
 * The debate leagues a member has been affiliated with, as they named them
 * (onboarding's free-text answer). Personal and private: deleted with the
 * account.
 */
export const memberLeagues = pgTable(
  'member_leagues',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    league: text('league').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.league] }),
    check(
      'member_leagues_league_check',
      sql`char_length(${table.league}) between 1 and 60`,
    ),
  ],
);
