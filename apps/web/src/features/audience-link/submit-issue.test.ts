import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { submitIssue } from './submit-issue';

setupRitewayBun();

const input = { roundId: 'r1', origin: 'https://daisy.example' };

describe('submitIssue', () => {
  test('a link comes back absolute, to share', async () => {
    assert({
      given: 'an issued link',
      should: 'answer it against the public origin',
      actual: await submitIssue(
        async () => Response.json({ href: '/watch/r1/link?token=t' }),
        input,
      ),
      expected: {
        kind: 'issued',
        url: 'https://daisy.example/watch/r1/link?token=t',
      },
    });
  });

  test('a refusal and an outage are told apart', async () => {
    const down = await submitIssue(async () => {
      throw new Error('down');
    }, input);
    assert({
      given: 'a 404, a 500 and a failed call',
      should: 'answer refused, then unavailable twice',
      actual: [
        await submitIssue(
          async () => new Response(null, { status: 404 }),
          input,
        ),
        await submitIssue(
          async () => new Response(null, { status: 500 }),
          input,
        ),
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
