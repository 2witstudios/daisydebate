type ErrorLayer = {
  readonly errno?: unknown;
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly cause?: unknown;
};

/** The unique_violation layer of an error's cause chain, if it has one. */
const uniqueViolationLayer = (error: unknown): ErrorLayer | null => {
  for (
    let current: unknown = error, depth = 0;
    current && depth < 4;
    depth += 1, current = (current as ErrorLayer).cause
  ) {
    const layer = current as ErrorLayer;
    if (layer.errno === '23505' || layer.code === '23505') return layer;
  }
  return null;
};

/**
 * PostgreSQL unique_violation (SQLSTATE 23505). Bun SQL reports it as
 * `errno` (its `code` is `ERR_POSTGRES_SERVER_ERROR`) inside drizzle's
 * wrapper, so every layer of the cause chain is checked.
 */
export const isUniqueViolation = (error: unknown): boolean =>
  uniqueViolationLayer(error) !== null;

/** A unique_violation of one named constraint or index. */
export const isUniqueViolationOf = (
  error: unknown,
  constraint: string,
): boolean => uniqueViolationLayer(error)?.constraint === constraint;
