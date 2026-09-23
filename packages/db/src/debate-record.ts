import {
  debateSnapshotSchema,
  type DebatePhase,
  type DebateSnapshot,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type {
  debates,
  DebateMode,
  DebateOutcome,
  DebateVisibility,
} from './schema/debates';
export type DebateRecord = {
  readonly id: string;
  readonly createdBy: string | null;
  readonly resolution: string;
  readonly format: string;
  readonly snapshot: unknown;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mode: DebateMode;
  readonly phase: DebatePhase;
  readonly visibility: DebateVisibility;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly outcome: DebateOutcome | null;
};
/**
 * Rows carry timestamptz as Date; records expose UTC ISO strings. The
 * record keeps the domain's field names (`format`, `createdBy`); the
 * columns are named for what they reference (`format_id`,
 * `created_by_actor_id`), and this is the one place the two meet.
 */
export const toDebateRecord = ({
  formatId,
  createdByActorId,
  ...row
}: typeof debates.$inferSelect): DebateRecord => ({
  ...row,
  format: formatId,
  createdBy: createdByActorId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  startedAt: row.startedAt?.toISOString() ?? null,
  completedAt: row.completedAt?.toISOString() ?? null,
});
/**
 * The snapshot is the domain source of truth: it is parsed once here, and
 * every projection (`phase`, the participant seats) is read from the parsed
 * value, never supplied separately, so the two cannot disagree.
 */
export const parseSnapshot = (
  debateId: string,
  snapshot: unknown,
): DebateSnapshot => {
  const parsed = debateSnapshotSchema.safeParse(snapshot);
  if (!parsed.success)
    throw createAppError('VALIDATION', 'Invalid debate snapshot', parsed.error);
  if (parsed.data.id !== debateId)
    throw createAppError('VALIDATION', 'Snapshot belongs to another debate');
  return parsed.data;
};
export type NewDebate = {
  readonly id: string;
  readonly createdBy?: string | null;
  readonly resolution: string;
  readonly format: string;
  readonly snapshot: unknown;
  readonly mode: DebateMode;
  readonly visibility: DebateVisibility;
};
