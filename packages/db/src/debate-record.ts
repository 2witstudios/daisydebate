import { phaseSchema, type DebatePhase } from '@daisy/protocol';
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
 * Rows carry timestamptz as Date; records expose UTC ISO strings. Drizzle's
 * string mode is not used because it relabels the driver's Date with the
 * host's local offset instead of converting it.
 */
export const toDebateRecord = (
  row: typeof debates.$inferSelect,
): DebateRecord => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  startedAt: row.startedAt?.toISOString() ?? null,
  completedAt: row.completedAt?.toISOString() ?? null,
});
/**
 * The snapshot is the domain source of truth; `phase` is its projection and
 * is read here, never supplied separately, so the two cannot disagree.
 */
export const snapshotPhase = (snapshot: unknown): DebatePhase => {
  const candidate =
    typeof snapshot === 'object' && snapshot !== null
      ? (snapshot as { phase?: unknown }).phase
      : undefined;
  const parsed = phaseSchema.safeParse(candidate);
  if (!parsed.success) throw new Error('Snapshot phase missing or invalid');
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
