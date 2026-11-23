import type { SQL as BunSQL } from 'bun';
import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import { tryInstantMs } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { WorkloadLane } from './workload';

type RawExecutor = {
  readonly execute: (statement: SQL) => PromiseLike<unknown>;
};

/** PostgreSQL int8 representations from Bun SQL and bounded writers. */
export const postgresInt8 = z.union([
  z.string().regex(/^-?\d+$/),
  z.bigint(),
  z.int(),
]);

/**
 * A timestamptz as epoch milliseconds. Bun SQL answers a Date; JSON built in
 * SQL answers ISO text; a `::text` cast answers PostgreSQL's own form
 * (`2026-11-22 10:00:00.5+00`), read here as the same instant. Anything else
 * is refused, never guessed.
 */
export const postgresInstantMs = z
  .union([z.date(), z.string()])
  .transform((value, context) => {
    const milliseconds =
      value instanceof Date
        ? value.getTime()
        : tryInstantMs(
            value
              .replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')
              .replace(/([+-]\d{2})$/, '$1:00'),
          );
    if (milliseconds === undefined || !Number.isFinite(milliseconds)) {
      context.addIssue({ code: 'custom', message: 'Expected an instant' });
      return z.NEVER;
    }
    return milliseconds;
  });

/**
 * The rows of one raw statement, each parsed by `rowSchema`. A row the schema
 * refuses is an invariant failure: the statement and its schema disagree.
 * Bun SQL answers int8 as a string (a bigint inside a bounded writer),
 * numeric as a string and timestamptz as a Date; the schema says which.
 * A Bun tagged statement carries its own connection, including a reservation.
 */
export async function query<Row extends z.ZodType>(
  ...read:
    | [tx: RawExecutor, rowSchema: Row, statement: SQL]
    | [statement: PromiseLike<unknown>, rowSchema: Row]
): Promise<z.output<Row>[]> {
  const rows = await (read.length === 2 ? read[0] : read[0].execute(read[2]));
  const parsed = z.array(read[1]).safeParse(rows);
  if (!parsed.success)
    throw createAppError(
      'INVARIANT',
      'A raw read returned a row its schema refuses',
      // Nested paths may include user-supplied object keys.
      parsed.error.issues.map(({ path: [index], code }) => ({
        row: typeof index === 'number' ? index : undefined,
        code,
      })),
    );
  return parsed.data;
}

/** Runs one raw statement whose rows nobody reads. */
export async function run(tx: RawExecutor, statement: SQL) {
  await tx.execute(statement);
}

/**
 * A selected SQL fragment whose value is parsed by `schema`, the typed form
 * of a column Drizzle cannot type itself. Drizzle passes a null past the
 * decoder, so a nullable fragment's schema says `.nullable()` for its type.
 * A value the schema refuses is an invariant failure, as in `query`.
 */
export function parsedColumn<Schema extends z.ZodType>(
  schema: Schema,
  fragment: SQL,
): SQL<z.output<Schema>> {
  return fragment.mapWith((value: unknown): z.output<Schema> => {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw createAppError(
        'INVARIANT',
        'A selected column returned a value its schema refuses',
        parsed.error.issues.map(({ code }) => ({ code })),
      );
    return parsed.data;
  });
}
/** Export values in plain JSON: ISO dates and numeric counters. */
export const exportRows = (rows: readonly Record<string, unknown>[]) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => [
        column,
        value instanceof Date
          ? value.toISOString()
          : typeof value === 'bigint'
            ? Number(value)
            : value,
      ]),
    ),
  );

/**
 * The member of `error`'s chain (itself or one of at most 16 native Error
 * causes) that `marked` recognises. Only own data-property causes are
 * followed; hostile links and execution recovery detail objects fail
 * closed to ordinary failure reporting.
 */
export function causeChainMember(
  marked: (error: Error) => boolean,
  error: unknown,
): Error | undefined {
  const seen = new WeakSet<Error>();
  let current = error;
  try {
    for (let depth = 0; depth < 16 && current instanceof Error; depth += 1) {
      if (marked(current)) return current;
      if (seen.has(current)) return undefined;
      seen.add(current);
      current = Object.getOwnPropertyDescriptor(current, 'cause')?.value;
    }
  } catch {
    // A proxy may refuse descriptor/prototype inspection; never hide its failure.
    return undefined;
  }
  return undefined;
}

/**
 * What PostgreSQL and its Bun driver said about a failure, read from the
 * error's cause chain without loading the driver: a type import only, so a
 * client-reachable caller classifies a failure without the driver or schema.
 */

/**
 * The driver's fields for a server error (`errno`) or a dropped connection
 * (`code`); any layer of a wrapped error may carry them, or none.
 */
type DriverFailure = Partial<
  Pick<BunSQL.PostgresError, 'errno' | 'code' | 'constraint'>
>;
const SQLSTATE_FAILURES: Readonly<Record<string, string>> = {
  '55P03': 'lock_timeout',
  '57014': 'statement_timeout',
};
const fromDriver = (error: Error) => {
  const { errno, code } = error as DriverFailure;
  return (
    typeof errno === 'string' ||
    (typeof code === 'string' && code.startsWith('ERR_POSTGRES'))
  );
};

/**
 * What the database said about a failed read, as a fixed loggable word, or
 * null for a failure from anywhere else. Never the raw error.
 */
export function databaseFailure(error: unknown): string | null {
  const failure = causeChainMember(fromDriver, error);
  if (!failure) return null;
  const { errno } = failure as DriverFailure;
  return (typeof errno === 'string' && SQLSTATE_FAILURES[errno]) || 'database';
}
type ErrorLayer = DriverFailure & { readonly cause?: unknown };
/** Bun reports SQLSTATE in errno inside Drizzle's wrapper; inspect the bounded cause chain. */
export const postgresViolation = (
  error: unknown,
  sqlState: string,
): ErrorLayer | null => {
  for (
    let current: unknown = error, depth = 0;
    current && depth < 4;
    depth += 1, current = (current as ErrorLayer).cause
  ) {
    const layer = current as ErrorLayer;
    if (layer.errno === sqlState || layer.code === sqlState) return layer;
  }
  return null;
};

/**
 * PostgreSQL unique_violation (SQLSTATE 23505). Bun SQL reports it as
 * `errno` (its `code` is `ERR_POSTGRES_SERVER_ERROR`) inside drizzle's
 * wrapper, so every layer of the cause chain is checked.
 */
export const isUniqueViolation = (error: unknown): boolean =>
  postgresViolation(error, '23505') !== null;

/** A unique_violation of one named constraint or index. */
export const isUniqueViolationOf = (
  error: unknown,
  constraint: string,
): boolean => postgresViolation(error, '23505')?.constraint === constraint;

/** Why a lane refused work that never ran (ADR 0088). */
type CapacityRefusalReason = 'unconfigured' | 'saturated' | 'expired';
export type CapacityRefusalDetail = {
  /** The lane that refused; `unknown` only for a refusal minted without one. */
  readonly lane: WorkloadLane | 'unknown';
  readonly reason: CapacityRefusalReason;
  /**
   * The lane when it refused: waiters still queued, connections taken, and how
   * long the oldest running work had held its slot. One long hold with few
   * waiters is a stuck holder; many waiters behind short holds is a burst.
   */
  readonly pressure?: {
    readonly pending: number;
    readonly running: number;
    readonly oldestAgeMs: number;
  };
  /** Connections held when it refused, by the operation that asked for each. */
  readonly holders?: Readonly<Record<string, number>>;
};

const CAPACITY_UNAVAILABLE = 'Database capacity unavailable';
type RefusalRegistry = {
  readonly refusals: WeakMap<Error, CapacityRefusalDetail>;
  /** Errors whose capacity refusal the database boundary already logged. */
  readonly reportedRefusals: WeakSet<Error>;
};
/**
 * One registry per process, not per module copy: Next can bundle a page apart
 * from the process app, so the copy that reads a refusal may not be the one
 * that minted it (ISSUE-927). A table keeps each refusal's frozen detail and
 * reported mark off the error, which wrappers and reporters see.
 */
const registry = ((
  globalThis as { 'daisy.db.capacity-refusals'?: RefusalRegistry }
)['daisy.db.capacity-refusals'] ??= {
  refusals: new WeakMap(),
  reportedRefusals: new WeakSet(),
});
const { refusals, reportedRefusals } = registry;
const refusalIn = (error: unknown) =>
  causeChainMember((candidate) => refusals.has(candidate), error);

/** Refused-unrun admission identity, through bounded native cause wrappers. */
export const isCapacityRefusal = (error: unknown): boolean =>
  refusalIn(error) !== undefined;
/**
 * A refusal asking again can clear. `unconfigured` cannot: a lane missing from
 * the profile, or work heavier than the lane, is the same on every request.
 */
export const isTemporaryRefusal = (error: unknown): boolean => {
  const reason = capacityRefusalDetail(error)?.reason;
  return reason === 'saturated' || reason === 'expired';
};
/** The lane and reason of the refusal `error` carries, if it carries one. */
export function capacityRefusalDetail(
  error: unknown,
): CapacityRefusalDetail | undefined {
  const refusal = refusalIn(error);
  return refusal ? refusals.get(refusal) : undefined;
}
/** A refusal's loggable fields: which lane, why, and how that lane stood. */
export function capacityRefusalFields(error: unknown) {
  const detail = capacityRefusalDetail(error);
  return (
    detail && { cause: `${detail.lane}.${detail.reason}`, ...detail.pressure }
  );
}
/**
 * Records that `db.capacity.refused` was emitted for this rejection. The
 * refusal itself is marked, not the wrapper that carried it, so any other
 * wrapper of the same refusal is recognised as already reported.
 */
export function markCapacityRefusalReported(error: unknown) {
  const refusal = refusalIn(error);
  if (refusal) reportedRefusals.add(refusal);
}
/**
 * The one report of what held a refusing lane: one line per operation, largest
 * first. A refusal is reported once, by whichever boundary reaches it first.
 */
export function reportCapacityHolders(
  error: unknown,
  log: (
    event: 'db.capacity.holder',
    fields: {
      readonly operation: string;
      readonly cause: string;
      readonly running: number;
    },
    message: string,
  ) => void,
) {
  const detail = capacityRefusalDetail(error);
  if (!detail || isReportedCapacityRefusal(error)) return;
  markCapacityRefusalReported(error);
  for (const [operation, running] of Object.entries(detail.holders ?? {}).sort(
    ([, a], [, b]) => b - a,
  ))
    log(
      'db.capacity.holder',
      { operation, cause: detail.lane, running },
      'Operation holding the refusing lane',
    );
}
/**
 * A capacity refusal the database boundary already reported, so a caller
 * further out suppresses its duplicate rather than logging it again.
 */
export const isReportedCapacityRefusal = (error: unknown): boolean =>
  causeChainMember((candidate) => reportedRefusals.has(candidate), error) !==
  undefined;
/** The one admission refusal `isCapacityRefusal` recognises: retryable INFRASTRUCTURE. */
export function refuseCapacity(
  detail: CapacityRefusalDetail = { lane: 'unknown', reason: 'saturated' },
) {
  const refusal = createAppError('INFRASTRUCTURE', CAPACITY_UNAVAILABLE);
  refusals.set(refusal, Object.freeze({ ...detail }));
  return refusal;
}
