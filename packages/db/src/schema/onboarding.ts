import {
  clubChoices,
  experienceChoices,
  formatPreferenceChoices,
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

const literalArray = (values: readonly string[]) =>
  sql.raw(`array[${values.map((value) => `'${value}'`).join(', ')}]::text[]`);

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
    experience: text('experience'),
    formats: text('formats')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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
    check(
      'member_onboarding_formats_check',
      sql`${table.formats} <@ ${literalArray(formatPreferenceChoices)}`,
    ),
    versionPositive('member_onboarding', table.version),
  ],
);
