import { pgTable, text } from 'drizzle-orm/pg-core';
import { actors } from './actors';

/**
 * The AI judge behind a judge-seat bot actor (ISSUE-750): it judges only,
 * so it has a name and nothing a debater has (persona, voice, difficulty).
 * A bot debater lives in `bot_profiles`; no actor is in both.
 */
export const aiJudgeProfiles = pgTable('ai_judge_profiles', {
  actorId: text('actor_id')
    .primaryKey()
    .references(() => actors.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
});
