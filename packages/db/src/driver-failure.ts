import type { SQL } from 'bun';
import { causeChainMember } from './infrastructure-refusal';

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
  Pick<SQL.PostgresError, 'errno' | 'code' | 'constraint'>
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
