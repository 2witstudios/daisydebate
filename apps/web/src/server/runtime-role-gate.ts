/**
 * ISSUE-39: production serves only as a DML-only database role (Fly's
 * DATABASE_URL is `daisy_web`; migrations run as the owner through
 * MIGRATION_DATABASE_URL). Read from validated config, so a development
 * server running as the local owner still starts.
 */
export async function refuseSchemaAlteringRole(app: {
  readonly config: { readonly NODE_ENV: string };
  readonly database: {
    readonly runtimeRoleProblems: () => Promise<readonly string[]>;
  };
}): Promise<void> {
  if (app.config.NODE_ENV !== 'production') return;
  const problems = await app.database.runtimeRoleProblems();
  if (problems.length > 0)
    throw new Error(
      `Production refuses a DATABASE_URL role that ${problems.join(', ')}; use the DML-only daisy_web role`,
    );
}
