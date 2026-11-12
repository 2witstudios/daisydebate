import { assert, setupRitewayBun, test } from 'riteway/bun';
import { remoteRead } from './remote';

setupRitewayBun();

test('the bench reads only the staging web app', async () => {
  const refusal = await remoteRead({ JB_PASSES: '1' }, 'daisy-debate').then(
    () => 'read',
    (error: Error) => error.message,
  );
  assert({
    given: 'any Fly app other than the staging web app',
    should:
      'refuse before connecting: production data leaves only with human sign-off',
    actual: refusal,
    expected:
      'judge:bench reads daisy-debate-staging only; production data needs human sign-off',
  });
});
