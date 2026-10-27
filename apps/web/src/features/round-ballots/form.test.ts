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

test('ballot responses keep entries on refusal and accept only the matching receipt', async () => {
  const roundId = 'r'.repeat(24);
  const form = ballotFormFixture();
  const reply =
    (status: number, body: unknown = {}) =>
    async () =>
      Response.json(body, { status });
  const receipt = {
    commandId: 'c'.repeat(24),
    roundId,
    ballotId: 'b'.repeat(24),
    judgeParticipantId: 'j'.repeat(24),
    freezeRevision: 1,
    resultingVersion: 4,
    outcome: 'affirmative',
  };
  const results = await Promise.all(
    [
      reply(503),
      reply(403),
      reply(409, { refusal: 'attendance-unsettled' }),
      reply(409, { refusal: 'stale-version' }),
      reply(200, { receipt: { ...receipt, roundId: 'x'.repeat(24) } }),
      reply(200, { receipt }),
    ].map((send) => submitRoundBallotForm(send, roundId, form)),
  );
  assert({
    given:
      'an outage, a refusal, two conflicts, a foreign receipt and the matching receipt',
    should:
      'keep entries with a specific message for each refusal, and clear them only on the matching receipt',
    actual: results.map((r) => [
      r.error?.split('.')[0] ?? null,
      Object.keys(r.values).length > 0,
      r.receipt?.ballotId ?? null,
    ]),
    expected: [
      ['The ballot is not acknowledged', true, null],
      ['The server refused this ballot', true, null],
      [
        'Not recorded yet: attendance for the last speeches is still being confirmed',
        true,
        null,
      ],
      ['The Round changed or a ballot is already recorded', true, null],
      ['The ballot is not acknowledged', true, null],
      [null, false, 'b'.repeat(24)],
    ],
  });
  const invalid = await submitRoundBallotForm(reply(200), 'not-a-round', form);
  assert({
    given: 'a malformed Round id',
    should: 'refuse before transport with the refresh guidance',
    actual: invalid.error,
    expected:
      'This Round is invalid. Return to Judge and refresh your assignments.',
  });
});
