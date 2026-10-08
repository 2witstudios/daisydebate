import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { actors } from './actors';
import { oneOf } from './columns';

/** How hard a bot debates, until the bots are specified (Train epic). */
export const botDifficulties = [
  'beginner',
  'intermediate',
  'advanced',
] as const;

/**
 * The person behind a bot actor (ADR 0058 §8): name, persona and voice for
 * the seat a bot holds. Content rows ship with the bot roster; a bot is a
 * participant implementation, never a different kind of round.
 */
export const botProfiles = pgTable(
  'bot_profiles',
  {
    actorId: text('actor_id')
      .primaryKey()
      .references(() => actors.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    persona: text('persona').notNull(),
    voice: text('voice').notNull(),
    difficulty: text('difficulty').notNull().default('beginner'),
  },
  (table) => [
    check(
      'bot_profiles_difficulty_check',
      oneOf(table.difficulty, botDifficulties),
    ),
  ],
);
