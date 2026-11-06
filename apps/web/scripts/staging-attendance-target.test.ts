import { assert, setupRitewayBun, test } from 'riteway/bun';
import { stagingAttendanceConfiguration } from './staging-attendance-target';
setupRitewayBun();
test('staging attendance repair refuses production, wrong release and wrong database before writes', () => {
  const commit = 'a'.repeat(40);
  const env = {
    FLY_APP_NAME: 'daisy-debate-staging',
    PUBLIC_APP_URL: 'https://beta.daisydebate.com',
    GIT_COMMIT: commit,
    DATABASE_URL: 'postgres://fixture:secret@localhost/daisy_debate_staging',
    BETTER_AUTH_SECRET: 'fixture-secret',
  };
  assert({
    given: 'the exact authorized staging app, image and database',
    should: 'admit the staging repair target',
    actual:
      stagingAttendanceConfiguration(env, commit).origin === env.PUBLIC_APP_URL,
    expected: true,
  });
  for (const patch of [
    { FLY_APP_NAME: 'daisy-production' },
    { PUBLIC_APP_URL: 'https://daisydebate.com' },
    { GIT_COMMIT: 'b'.repeat(40) },
    { DATABASE_URL: 'postgres://fixture:secret@localhost/production' },
  ]) {
    let refused = false;
    try {
      stagingAttendanceConfiguration({ ...env, ...patch }, commit);
    } catch (error) {
      refused = error instanceof Error && !error.message.includes('secret');
    }
    assert({
      given: 'a target outside the authorized staging image/database',
      should: 'refuse without exposing any credential',
      actual: refused,
      expected: true,
    });
  }
});
