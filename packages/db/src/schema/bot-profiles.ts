import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { actors } from './actors';
import { oneOf } from './columns';
import { botDifficulties } from '@daisy/protocol';

export { botDifficulties };

/**
 * The person behind a bot debater (ADR 0058 §8): name, persona and voice for
 * the side seat it holds. Content rows ship with the bot roster; a bot is a
 * participant implementation, never a different kind of round. The AI judge
 * is not a bot debater and has its own `ai_judge_profiles` row (ISSUE-750).
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
