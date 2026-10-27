import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { AuthEmailMessage } from '../auth/mail/mail-types';
import { createMailIntentDelivery } from './mail-delivery';

setupRitewayBun();

type Delivery = Awaited<
  ReturnType<
    Parameters<
      typeof createMailIntentDelivery
    >[0]['store']['readMailIntentDelivery']
  >
>;
type Settled = { id: string; token: string; outcome: unknown };

const scripted = (input: {
  delivery: Delivery;
  attempts?: number;
  deliver?: (message: AuthEmailMessage) => Promise<'sent' | 'suppressed'>;
  ownerAddress?: string;
}) => {
  const sent: AuthEmailMessage[] = [];
  const settled: Settled[] = [];
  const delivery = createMailIntentDelivery({
    store: {
      claimMailIntents: async () => [
        {
          id: 'intent-1',
          purpose: 'beta-approved',
          attempts: input.attempts ?? 1,
          token: 'tok',
        },
      ],
      readMailIntentDelivery: async () => input.delivery,
      settleMailIntent: async (settle) => {
        settled.push(settle);
        return true;
      },
    },
    deliver:
      input.deliver ??
      (async (message) => {
        sent.push(message);
        return 'sent';
      }),
    ownerAddress: input.ownerAddress,
    appUrl: 'https://daisy.example.com',
    nextToken: () => 'tok',
    now: () => '2026-10-26T00:00:00.000Z',
  });
  return { delivery, sent, settled };
};

describe('mail intent delivery (ADR 0075)', () => {
  test('an approval goes to the member under the intent id', async () => {
    const { delivery, sent, settled } = scripted({
      delivery: { kind: 'member', to: 'm@daisy.invalid', username: 'mia' },
    });
    const count = await delivery.run(10);
    assert({
      given: 'a due approval for an approved member',
      should:
        'send it to their current address, keyed by the intent, and settle it sent',
      actual: {
        count,
        to: sent[0]?.to,
        key: sent[0]?.idempotencyKey,
        play: sent[0]?.text.includes('https://daisy.example.com/play'),
        settled: settled.map(({ outcome }) => outcome),
      },
      expected: {
        count: 1,
        to: 'm@daisy.invalid',
        key: 'intent-1',
        play: true,
        settled: [{ kind: 'sent' }],
      },
    });
  });

  test('mail that is no longer owed, or has nowhere to go, is cancelled unsent', async () => {
    const outcomes = [];
    for (const input of [
      { delivery: { kind: 'recipient-gone' } as const },
      { delivery: { kind: 'not-owed' } as const },
      {
        delivery: { kind: 'owner-digest', newRequests: 2, waiting: 5 } as const,
      },
    ]) {
      const { delivery, sent, settled } = scripted(input);
      await delivery.run(10);
      outcomes.push([sent.length, settled[0]?.outcome]);
    }
    assert({
      given:
        'an erased recipient, a revoked approval and a digest with no owner address',
      should: 'send nothing and cancel each with its reason',
      actual: outcomes,
      expected: [
        [0, { kind: 'cancelled', errorCode: 'recipient-gone' }],
        [0, { kind: 'cancelled', errorCode: 'not-owed' }],
        [0, { kind: 'cancelled', errorCode: 'unconfigured' }],
      ],
    });
  });

  test('the owner digest goes to the configured address and links to the console', async () => {
    const { delivery, sent } = scripted({
      delivery: { kind: 'owner-digest', newRequests: 2, waiting: 5 },
      ownerAddress: 'owner@daisy.invalid',
    });
    await delivery.run(10);
    assert({
      given: 'a due digest and a configured owner address',
      should: 'send the counts to the owner with the pending accounts link',
      actual: [
        sent[0]?.to,
        sent[0]?.subject,
        sent[0]?.text.includes('http://localhost:4800/accounts?access=pending'),
      ],
      expected: [
        'owner@daisy.invalid',
        '2 accounts joined the beta list',
        true,
      ],
    });
  });

  test('a failed send retries with backoff, then fails for good', async () => {
    const failing = async () => {
      throw new Error('provider down');
    };
    const member = {
      kind: 'member',
      to: 'm@daisy.invalid',
      username: 'mia',
    } as const;
    const early = scripted({ delivery: member, deliver: failing, attempts: 2 });
    const last = scripted({ delivery: member, deliver: failing, attempts: 8 });
    const suppressed = scripted({
      delivery: member,
      deliver: async () => 'suppressed',
    });
    for (const { delivery } of [early, last, suppressed])
      await delivery.run(10);
    assert({
      given:
        'a provider failure on attempt 2, on the last attempt, and a suppressed recipient',
      should: 'retry a minute later, then fail, and cancel the suppressed send',
      actual: [early, last, suppressed].map(
        ({ settled }) => settled[0]?.outcome,
      ),
      expected: [
        {
          kind: 'retry',
          errorCode: 'delivery',
          nextAttemptAt: '2026-10-26T00:01:00.000Z',
        },
        { kind: 'failed', errorCode: 'delivery' },
        { kind: 'cancelled', errorCode: 'suppressed' },
      ],
    });
  });
});
