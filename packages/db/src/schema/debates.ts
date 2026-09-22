import { phaseSchema, type DebatePhase } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import {
  createdAtColumn,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { formats } from './formats';

export const debateModes = ['casual', 'ranked', 'practice'] as const;
export type DebateMode = (typeof debateModes)[number];
export const debateVisibilities = ['public', 'unlisted', 'private'] as const;
export type DebateVisibility = (typeof debateVisibilities)[number];
export const debateOutcomes = [
  'affirmative',
  'negative',
  'draw',
  'abandoned',
] as const;
export type DebateOutcome = (typeof debateOutcomes)[number];
/** The lifecycle vocabulary is the protocol's; the CHECK derives from it. */
const debatePhases = phaseSchema.options;

/**
 * The snapshot stays the domain source of truth. `phase`, `started_at`,
 * `completed_at` and `outcome` are projections written in the same statement
 * as the snapshot (ADR 0029); the lifecycle CHECK keeps them coherent.
 */
export const debates = pgTable(
  'debates',
  {
    id: text('id').primaryKey(),
    /** Nullable for service-created proof debates. */
    createdBy: text('created_by').references(() => actors.id, {
      onDelete: 'restrict',
    }),
    resolution: text('resolution').notNull(),
    format: text('format')
      .notNull()
      .references(() => formats.id, { onDelete: 'restrict' }),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
    mode: text('mode').$type<DebateMode>().notNull(),
    phase: text('phase').$type<DebatePhase>().notNull(),
    visibility: text('visibility').$type<DebateVisibility>().notNull(),
    startedAt: timestampColumn('started_at'),
    completedAt: timestampColumn('completed_at'),
    outcome: text('outcome').$type<DebateOutcome>(),
  },
  (table) => {
    /** One branch per phase: which lifecycle columns that phase allows. */
    const waiting = sql`${table.phase} = 'waiting' and ${table.startedAt} is null and ${table.completedAt} is null and ${table.outcome} is null`;
    const active = sql`${table.phase} = 'active' and ${table.startedAt} is not null and ${table.completedAt} is null and ${table.outcome} is null`;
    const completed = sql`${table.phase} = 'completed' and ${table.completedAt} is not null and ${table.outcome} is not null and (${table.startedAt} is not null or ${table.outcome} = 'abandoned')`;
    return [
      /** Lets `rating_changes` pin a change to the debate's own format. */
      unique('debates_id_format_unique').on(table.id, table.format),
      index('debates_created_by_idx').on(table.createdBy),
      index('debates_phase_mode_created_idx').on(
        table.phase,
        table.mode,
        table.createdAt,
      ),
      index('debates_format_completed_idx').on(table.format, table.completedAt),
      versionPositive('debates', table.version),
      check('debates_mode_check', oneOf(table.mode, debateModes)),
      check('debates_phase_check', oneOf(table.phase, debatePhases)),
      check(
        'debates_visibility_check',
        oneOf(table.visibility, debateVisibilities),
      ),
      check(
        'debates_outcome_check',
        sql`${table.outcome} is null or ${oneOf(table.outcome, debateOutcomes)}`,
      ),
      check(
        'debates_lifecycle_check',
        sql`(${waiting}) or (${active}) or (${completed})`,
      ),
    ];
  },
);
