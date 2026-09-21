import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase, type SinkEvent } from './index.test-support';

setupRitewayBun();

const at = '2026-09-20T00:00:00.000Z';
const event = {
  eventId: 'evt_1',
  providerMessageId: 'msg_1',
  status: 'bounced',
  rank: 5,
  at,
};

describe('email delivery ledger', () => {
  test('records a send idempotently with a status rank of 1', async () => {
    const { database, queries } = createTestDatabase([[]]);
    await database.recordEmailDelivery({
      providerMessageId: 'msg_1',
      recipientHash: 'hash',
      at,
    });
    assert({
      given: 'a provider message ID and recipient hash',
      should: 'insert once with conflict-do-nothing semantics',
      actual: {
        count: queries.length,
        idempotent: /on conflict do nothing/i.test(queries[0]?.query ?? ''),
        table: /"email_delivery"/.test(queries[0]?.query ?? ''),
      },
      expected: { count: 1, idempotent: true, table: true },
    });
  });

  test('reports suppression from the stored row', async () => {
    const yes = createTestDatabase([[['hash']]]);
    const no = createTestDatabase([[]]);
    assert({
      given: 'a stored and an absent suppression',
      should: 'answer true then false',
      actual: [
        await yes.database.isRecipientSuppressed('hash'),
        await no.database.isRecipientSuppressed('other'),
      ],
      expected: [true, false],
    });
  });

  test('applies a hard-bounce event: dedupe row, rank raise and suppression in one transaction', async () => {
    const { database, queries } = createTestDatabase([
      [['evt_1']],
      [['hash']],
      [],
      [],
    ]);
    const outcome = await database.applyEmailDeliveryEvent({
      ...event,
      suppress: 'bounce',
    });
    assert({
      given: 'a first-seen permanent bounce for a recorded message',
      should:
        'insert the event, raise the rank only upward and add a suppression',
      actual: {
        outcome,
        statements: queries.map(({ query }) =>
          query.split(' ').slice(0, 3).join(' '),
        ),
        monotonic: /"status_rank" < \$/.test(queries[2]?.query ?? ''),
      },
      expected: {
        outcome: 'applied',
        statements: [
          'insert into "email_delivery_event"',
          'select "recipient_hash" from',
          'update "email_delivery" set',
          'insert into "email_suppression"',
        ],
        monotonic: true,
      },
    });
  });

  test('a duplicate event ID stops after the dedupe insert', async () => {
    const { database, queries } = createTestDatabase([[]]);
    const outcome = await database.applyEmailDeliveryEvent({
      ...event,
      suppress: null,
    });
    assert({
      given: 'an event ID that already exists',
      should: 'report duplicate without touching delivery or suppression',
      actual: { outcome, statements: queries.length },
      expected: { outcome: 'duplicate', statements: 1 },
    });
  });

  test('an event for an unrecorded message reports unknown-message', async () => {
    const { database } = createTestDatabase([[['evt_1']], []]);
    assert({
      given: 'an event whose message was never recorded',
      should: 'roll back and report unknown-message',
      actual: await database.applyEmailDeliveryEvent({
        ...event,
        suppress: null,
      }),
      expected: 'unknown-message',
    });
  });

  test('driver failures reject and report only the operation name', async () => {
    const events: SinkEvent[] = [];
    const failing = () => createTestDatabase([new Error('sql text')], events);
    await expect(
      failing().database.recordEmailDelivery({
        providerMessageId: 'm',
        recipientHash: 'h',
        at,
      }),
    ).rejects.toThrow();
    await expect(
      failing().database.isRecipientSuppressed('h'),
    ).rejects.toThrow();
    await expect(
      failing().database.applyEmailDeliveryEvent({ ...event, suppress: null }),
    ).rejects.toThrow();
    assert({
      given: 'failing drivers',
      should: 'report exactly the three safe operation names, never SQL',
      actual: {
        operations: events.map(({ fields }) => fields.operation),
        leaksSql: JSON.stringify(events).includes('sql text'),
      },
      expected: {
        operations: [
          'recordEmailDelivery',
          'isRecipientSuppressed',
          'applyEmailDeliveryEvent',
        ],
        leaksSql: false,
      },
    });
  });
});
