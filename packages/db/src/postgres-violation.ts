type ErrorLayer = {
  readonly errno?: unknown;
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly cause?: unknown;
};
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
