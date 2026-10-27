import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { assertRejects } from '@daisy/errors/testing';
import { createEventRecorder } from '../../server/test-loggers.test-support';
import { createSendMail } from './send-mail';
import type { DeliveryLedger, EmailSender } from './types';

setupRitewayBun();

const message = {
  to: 'debater@example.com',
  subject: 'Subject',
  text: 'Text',
  html: '<p>Text</p>',
};

const transport = (input: {
  readonly suppressed?: boolean;
  readonly send?: EmailSender['send'];
}) => {
  const { logged, logger } = createEventRecorder();
  const recorded: unknown[] = [];
  const ledger: DeliveryLedger = {
    isSuppressed: async () => input.suppressed ?? false,
    record: async (receipt) => void recorded.push(receipt),
  };
  const send = createSendMail({
    recipientSubkey: 'k'.repeat(64),
    ledger,
    emailSender: {
      send: input.send ?? (async () => ({ providerMessageId: 'provider-1' })),
    },
    logger,
    clock: fixedClock('2026-10-27T12:00:00.000Z'),
  });
  return { send, logged, recorded };
};

describe('createSendMail', () => {
  test('a sent mail is logged under its purpose', async () => {
    const { send, logged, recorded } = transport({});
    const outcome = await send('beta-access')(message);
    assert({
      given: 'a beta access mail to an unsuppressed recipient',
      should:
        'send it, record its receipt and log mail.sent with its purpose and no recipient',
      actual: [outcome, recorded.length, logged],
      expected: [
        'sent',
        1,
        [
          {
            event: 'mail.sent',
            fields: { operation: 'mail.send', purpose: 'beta-access' },
          },
        ],
      ],
    });
  });

  test('a suppressed recipient is never sent to', async () => {
    let sends = 0;
    const { send, logged } = transport({
      suppressed: true,
      send: async () => {
        sends += 1;
      },
    });
    assert({
      given: 'an auth mail to a suppressed recipient',
      should: 'send nothing and log mail.suppressed under the auth purpose',
      actual: [await send('auth')(message), sends, logged],
      expected: [
        'suppressed',
        0,
        [
          {
            event: 'mail.suppressed',
            fields: { operation: 'mail.send', purpose: 'auth' },
          },
        ],
      ],
    });
  });

  test('a provider failure is a generic retryable failure', async () => {
    const { send, logged } = transport({
      send: async () => {
        throw new Error('provider said debater@example.com bounced');
      },
    });
    await assertRejects({
      given: 'a provider that throws',
      should: 'fail with INFRASTRUCTURE',
      actual: () => send('auth')(message),
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'the same failure',
      should:
        'log mail.failed with its purpose, never the provider exception or recipient',
      actual: logged,
      expected: [
        {
          event: 'mail.failed',
          fields: {
            operation: 'mail.send',
            purpose: 'auth',
            errorCode: 'INFRASTRUCTURE',
          },
        },
      ],
    });
  });
});
