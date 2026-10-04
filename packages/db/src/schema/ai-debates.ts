import { debateSides } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  jsonObjectSchema,
  oneOf,
  timestampColumn,
  versionColumn,
  versionPositive,
} from './columns';

export const aiDebateRoles = ['person', 'ai'] as const;
export const aiDebateCommandTypes = [
  'start',
  'startSpeech',
  'yield',
  'abort',
] as const;
export const aiDebateAbortReasons = ['person', 'vendor-failure'] as const;

/**
 * A practice debate between a person and an AI (AIDB, DEC-85): its own
 * record, not a `debates` row, with no outcome, rating or league. The
 * timeline is folded from `ai_debate_commands` by the engine; this row holds
 * the setup, the models it ran with, when it started counting against an
 * allowance, and its internal cost (never shown to the person).
 */
export const aiDebates = pgTable(
  'ai_debates',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    resolution: text('resolution').notNull(),
    personSide: text('person_side').notNull(),
    /** The Train bot the person debates; its persona and voice. */
    opponent: text('opponent').notNull(),
    voice: text('voice').notNull(),
    speechModel: text('speech_model').notNull(),
    cxModel: text('cx_model').notNull(),
    judgeModel: text('judge_model').notNull(),
    ttsModel: text('tts_model').notNull(),
    sttModel: text('stt_model').notNull(),
    createdAt: createdAtColumn(),
    /** The latest it can end; with `finished_at` unset it counts as live. */
    expectedEndAt: timestampColumn('expected_end_at').notNull(),
    /** Set at its first model call: from then it counts against an allowance. */
    countedAt: timestampColumn('counted_at'),
    finishedAt: timestampColumn('finished_at'),
    ttsCharacters: integer('tts_characters').notNull().default(0),
    sttRequests: integer('stt_requests').notNull().default(0),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    version: versionColumn(),
  },
  (table) => [
    index('ai_debates_actor_created_idx').on(table.actorId, table.createdAt),
    index('ai_debates_live_idx')
      .on(table.expectedEndAt)
      .where(sql`${table.finishedAt} is null`),
    check('ai_debates_person_side_check', oneOf(table.personSide, debateSides)),
    check(
      'ai_debates_resolution_length',
      sql`char_length(${table.resolution}) between 3 and 200`,
    ),
    check(
      'ai_debates_usage_nonnegative',
      sql`${table.ttsCharacters} >= 0 and ${table.sttRequests} >= 0 and ${table.promptTokens} >= 0 and ${table.completionTokens} >= 0`,
    ),
    versionPositive('ai_debates', table.version),
  ],
);

/** The append-only command log; `sequence` orders it and refuses races. */
export const aiDebateCommands = pgTable(
  'ai_debate_commands',
  {
    aiDebateId: text('ai_debate_id')
      .notNull()
      .references(() => aiDebates.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    at: timestampColumn('at').notNull(),
    turnIndex: integer('turn_index'),
    reason: text('reason'),
  },
  (table) => [
    primaryKey({ columns: [table.aiDebateId, table.sequence] }),
    check(
      'ai_debate_commands_type_check',
      oneOf(table.type, aiDebateCommandTypes),
    ),
    check(
      'ai_debate_commands_reason_check',
      sql`(${table.type} = 'abort') = (${table.reason} is not null) and (${table.reason} is null or ${oneOf(table.reason, aiDebateAbortReasons)})`,
    ),
    check(
      'ai_debate_commands_turn_check',
      sql`(${table.type} = 'yield') = (${table.turnIndex} is not null)`,
    ),
    check('ai_debate_commands_sequence_check', sql`${table.sequence} >= 0`),
  ],
);

/** What was said, in order: transcribed for the person, spoken for the AI. */
export const aiDebateUtterances = pgTable(
  'ai_debate_utterances',
  {
    id: text('id').primaryKey(),
    aiDebateId: text('ai_debate_id')
      .notNull()
      .references(() => aiDebates.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    turnIndex: integer('turn_index').notNull(),
    role: text('role').notNull(),
    text: text('text').notNull(),
    /** False while the AI is still writing it, or if writing it failed. */
    complete: boolean('complete').notNull().default(true),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('ai_debate_utterances_sequence_unique').on(
      table.aiDebateId,
      table.sequence,
    ),
    check('ai_debate_utterances_role_check', oneOf(table.role, aiDebateRoles)),
    check(
      'ai_debate_utterances_turn_check',
      sql`${table.turnIndex} >= 0 and ${table.sequence} >= 0`,
    ),
    check(
      'ai_debate_utterances_text_length',
      sql`char_length(${table.text}) <= 20000`,
    ),
  ],
);

/** The judge's ruling, once per AI debate. */
export const aiDebateBallots = pgTable(
  'ai_debate_ballots',
  {
    aiDebateId: text('ai_debate_id')
      .primaryKey()
      .references(() => aiDebates.id, { onDelete: 'cascade' }),
    winner: text('winner').notNull(),
    ballot: jsonbColumn('ballot', jsonObjectSchema).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check('ai_debate_ballots_winner_check', oneOf(table.winner, debateSides)),
    jsonbIsObject('ai_debate_ballots', table.ballot),
  ],
);
