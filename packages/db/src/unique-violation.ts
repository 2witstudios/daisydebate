import { postgresViolation } from './postgres-violation';

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
