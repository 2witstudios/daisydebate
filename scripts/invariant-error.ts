/** The invariant id a refused operation carries, when it carries one. */
export const invariantIdOf = (error: unknown): string | undefined => {
  if (error === null || typeof error !== 'object' || !('invariantId' in error))
    return undefined;
  const value = (error as { invariantId?: unknown }).invariantId;
  return typeof value === 'string' ? value : undefined;
};
