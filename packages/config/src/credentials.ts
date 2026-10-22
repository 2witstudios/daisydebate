import { z } from 'zod';

// Composition injects OS-CSPRNG entropy. Encoding/length validation cannot prove entropy.
export const mediaWorkerSecret = z
  .string()
  .refine(
    (value) =>
      /^[A-Za-z0-9_-]{43,}$/.test(value) &&
      Buffer.from(value, 'base64url').toString('base64url') === value,
  );

/** Drops the migration credential a runtime reads only to refuse it. */
export const withoutMigrationCredential = <Config extends object>(
  config: Config & { MIGRATION_DATABASE_URL?: string | undefined },
): Omit<Config, 'MIGRATION_DATABASE_URL'> => {
  const { MIGRATION_DATABASE_URL: refused, ...runtime } = config;
  void refused;
  return runtime;
};
