import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { submitIssue } from './submit-issue';

setupRitewayBun();

const roundId = 'r1';
const url = 'https://daisy.example/watch/r1/link?token=t';
const answering = (status: number) => async () =>
  new Response(null, { status });

describe('submitIssue', () => {
  test('the link comes back from the route', async () => {
    assert({
      given: 'an issued link',
      should: 'answer it as it came',
      actual: await submitIssue(async () => Response.json({ url }), roundId),
      expected: { kind: 'issued', url },
    });
  });

  test('a refusal and an outage are told apart', async () => {
    const down = await submitIssue(async () => {
      throw new Error('down');
    }, roundId);
    assert({
      given: 'a 404, a 500 and a failed call',
      should: 'answer refused, then unavailable twice',
      actual: [
        await submitIssue(answering(404), roundId),
        await submitIssue(answering(500), roundId),
        down,
      ],
      expected: [
        { kind: 'refused' },
        { kind: 'unavailable' },
        { kind: 'unavailable' },
      ],
    });
  });
});
