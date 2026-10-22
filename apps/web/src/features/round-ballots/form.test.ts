import { ballotFormFixture } from './ballot-form.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { submitRoundBallotForm } from './form';
setupRitewayBun();
test('unknown ballot acknowledgements retain the exact envelope while low-point confirmation stays current', async () => {
  const form = ballotFormFixture();
  const bodies: string[] = [];
  const send = async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    throw Error('lost response');
  };
  const first = await submitRoundBallotForm(send, 'r'.repeat(24), form);
  const retry = new FormData();
  for (const [key, value] of Object.entries(first.values))
    retry.set(key, value);
  await submitRoundBallotForm(send, 'r'.repeat(24), retry);
  assert({
    given: 'two unknown acknowledgements',
    should:
      'keep the exact ballot id, revision, vote and rubric across retries',
    actual: [
      first.unacknowledged,
      bodies.length,
      bodies[0] === bodies[1],
      first.values.commandId,
    ],
    expected: [true, 2, true, 'c'.repeat(24)],
  });
  retry.set('affirmative-thesis', '1');
  retry.set('low-point', 'affirmative:30:30');
  const stale = await submitRoundBallotForm(send, 'r'.repeat(24), retry);
  assert({
    given: 'changed scores with old low-point confirmation',
    should: 'refuse before transport and retain entered scores',
    actual: [bodies.length, stale.error, stale.values['affirmative-thesis']],
    expected: [2, 'Confirm the low-point win, or change the scores.', '1'],
  });
});
