/** No credentials or target values enter a refusal. Production cannot pass this staging-only guard. */
export function stagingAttendanceConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  expectedCommit: string | undefined,
) {
  if (
    env.FLY_APP_NAME !== 'daisy-debate-staging' ||
    env.PUBLIC_APP_URL !== 'https://beta.daisydebate.com' ||
    !/^[a-f0-9]{40}$/.test(expectedCommit ?? '') ||
    env.GIT_COMMIT !== expectedCommit ||
    !env.DATABASE_URL ||
    !env.BETTER_AUTH_SECRET
  )
    throw new Error('Staging attendance repair target mismatch');
  try {
    if (new URL(env.DATABASE_URL).pathname !== '/daisy_debate_staging')
      throw new Error();
  } catch {
    throw new Error('Staging attendance database mismatch');
  }
  return {
    url: env.DATABASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    origin: env.PUBLIC_APP_URL,
  };
}
