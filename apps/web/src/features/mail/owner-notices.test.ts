import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createOwnerNotices } from './owner-notices';
import { MAIL_MAX_ATTEMPTS } from './retry-policy';
import type { EmailMessage } from './types';

setupRitewayBun();

const id = 'k3v9q2w8e7r6t5y4u3i2o1pa';
const email = { subject: 'Hello', text: 'Hello owner', html: '<p>Hello</p>' };

const scripted = (input: {
  readonly composed?: typeof email | null | Error;
  readonly attempts?: number;
  readonly deliver?: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
}) => {
  const sent: EmailMessage[] = [];
  const settled: unknown[] = [];
  const failures: unknown[] = [];
  const lost: unknown[] = [];
  const notices = createOwnerNotices({
    purpose: 'sample',
    suppressedMessage: 'Sample owner address is suppressed',
    claim: async () => [{ id, attempts: input.attempts ?? 1, token: 'tok' }],
    compose: async () => {
      const composed = input.composed === undefined ? email : input.composed;
      if (composed instanceof Error) throw composed;
      return composed;
    },
    settle: async ({ outcome }) => {
      settled.push(outcome);
      return true;
    },
    deliver:
      input.deliver ??
      (async (message) => {
        sent.push(message);
        return 'sent';
      }),
    ownerAddress: 'owner@daisy.example',
    nextToken: () => 'tok',
    now: () => '2026-11-18T10:00:00.000Z',
    failed: (error) => failures.push(error),
    gaveUp: (error) => lost.push(error),
  });
  return { notices, sent, settled, failures, lost };
};

test('an owner notice', async () => {
  {
    const { notices, sent, settled } = scripted({});
    const count = await notices.run(10);
    assert({
      given: 'a due notice',
      should:
        'email the owner under the row id namespaced by purpose, and settle it sent',
      actual: { count, sent, settled },
      expected: {
        count: 1,
        sent: [
          {
            ...email,
            to: 'owner@daisy.example',
            idempotencyKey: `sample:${id}`,
          },
        ],
        settled: [{ kind: 'sent' }],
      },
    });
  }

  {
    const { notices, sent, settled } = scripted({ composed: null });
    await notices.run(10);
    assert({
      given: 'a row deleted before its notice went',
      should: 'cancel the notice and send nothing',
      actual: { sent: sent.length, settled },
      expected: {
        sent: 0,
        settled: [{ kind: 'cancelled', errorCode: 'not-owed' }],
      },
    });
  }

  {
    const { settled, lost, notices } = scripted({
      deliver: async () => 'suppressed',
    });
    await notices.run(10);
    assert({
      given: 'an owner address that is suppressed',
      should:
        'cancel as suppressed and report it, since every later notice would vanish the same way',
      actual: {
        settled,
        lost: lost.map((error) => (error as Error).message),
      },
      expected: {
        settled: [{ kind: 'cancelled', errorCode: 'suppressed' }],
        lost: ['Sample owner address is suppressed'],
      },
    });
  }

  {
    const { settled, failures, lost, notices } = scripted({
      deliver: async () => {
        throw new Error('provider down for owner@daisy.example');
      },
    });
    await notices.run(10);
    assert({
      given: 'a send that fails with attempts left',
      should: 'retry later with backoff and report nothing yet',
      actual: { settled, reported: failures.length + lost.length },
      expected: {
        settled: [
          {
            kind: 'retry',
            errorCode: 'delivery',
            nextAttemptAt: '2026-11-18T10:00:30.000Z',
          },
        ],
        reported: 0,
      },
    });
  }

  {
    const gaveUp = new Error('still down');
    const { settled, lost, notices } = scripted({
      attempts: MAIL_MAX_ATTEMPTS,
      deliver: async () => {
        throw gaveUp;
      },
    });
    await notices.run(10);
    assert({
      given: 'a send that fails on its last attempt',
      should: 'fail for good and report it as lost',
      actual: { settled, lost },
      expected: {
        settled: [{ kind: 'failed', errorCode: 'delivery' }],
        lost: [gaveUp],
      },
    });
  }

  {
    const unreadable = new Error('pool refused');
    const { settled, failures, lost, notices } = scripted({
      attempts: MAIL_MAX_ATTEMPTS,
      composed: unreadable,
    });
    await notices.run(10);
    assert({
      given: 'a read that fails on the last attempt',
      should: 'report it as lost and name the stored data, not the provider',
      actual: { settled, failures, lost },
      expected: {
        settled: [{ kind: 'failed', errorCode: 'unreadable' }],
        failures: [],
        lost: [unreadable],
      },
    });
  }

  {
    const unreadable = new Error('read failed');
    const { settled, failures, notices } = scripted({ composed: unreadable });
    await notices.run(10);
    assert({
      given: 'a row that cannot be read',
      should: 'report it and retry, without aborting the batch',
      actual: { failures, kind: (settled[0] as { kind: string }).kind },
      expected: { failures: [unreadable], kind: 'retry' },
    });
  }
});
