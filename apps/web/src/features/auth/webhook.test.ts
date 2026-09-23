import { createHmac } from 'node:crypto';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { systemClock } from '@daisy/clock';
import {
  emailDeliveryStatusRank,
  emailDeliveryStatuses,
} from '@daisy/protocol';
import { classifyResendEvent, createResendWebhook } from './webhook';

setupRitewayBun();

const secret = `whsec_${Buffer.from('unit-test-signing-key-0123456789').toString('base64')}`;
const sign = (id: string, timestamp: string, body: string, key = secret) =>
  `v1,${createHmac('sha256', Buffer.from(key.slice(6), 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')}`;
const nowMs = () => Date.parse(systemClock.now());
const now = () => Math.floor(nowMs() / 1000);
const isoAgo = (ms: number) => new Date(nowMs() - ms).toISOString();

const applied: unknown[] = [];
const build = (
  outcome: 'applied' | 'duplicate' | 'unknown-message' = 'applied',
) => {
  applied.length = 0;
  return createResendWebhook({
    secret,
    apiKey: 're_unit',
    clock: systemClock,
    apply: async (input) => {
      applied.push(input);
      return outcome;
    },
  });
};
const delivery = (
  overrides: {
    id?: string;
    timestamp?: string;
    body?: string;
    signature?: string;
    omit?: string;
  } = {},
) => {
  const id = overrides.id ?? 'msg_evt_1';
  const timestamp = overrides.timestamp ?? String(now());
  const body =
    overrides.body ??
    JSON.stringify({
      type: 'email.delivered',
      created_at: systemClock.now(),
      data: { email_id: 'em_1', to: ['someone@example.test'] },
    });
  const headers: Record<string, string> = {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': overrides.signature ?? sign(id, timestamp, body),
    'content-type': 'application/json',
  };
  if (overrides.omit) delete headers[overrides.omit];
  return new Request('http://localhost:3000/api/webhooks/resend', {
    method: 'POST',
    headers,
    body,
  });
};

describe('classifyResendEvent', () => {
  test('maps provider events to monotonic ranks and suppression only for hard failures', () => {
    const event = (type: string, data: Record<string, unknown> = {}) =>
      classifyResendEvent({ type, data: { email_id: 'em', ...data } });
    assert({
      given: 'the Resend event types',
      should:
        'rank sent < delayed < delivered < failed < bounced < complained and suppress only hard bounces and complaints',
      actual: [
        event('email.sent'),
        event('email.delivery_delayed'),
        event('email.delivered'),
        event('email.failed'),
        event('email.bounced', { bounce: { type: 'Permanent' } }),
        event('email.bounced', { bounce: { type: 'Transient' } }),
        event('email.complained'),
        event('email.opened'),
      ],
      expected: [
        { status: 'sent', rank: 1, suppress: null, messageId: 'em' },
        { status: 'delayed', rank: 2, suppress: null, messageId: 'em' },
        { status: 'delivered', rank: 3, suppress: null, messageId: 'em' },
        { status: 'failed', rank: 4, suppress: null, messageId: 'em' },
        { status: 'bounced', rank: 5, suppress: 'bounce', messageId: 'em' },
        { status: 'delayed', rank: 2, suppress: null, messageId: 'em' },
        {
          status: 'complained',
          rank: 6,
          suppress: 'complaint',
          messageId: 'em',
        },
        null,
      ],
    });
  });

  test('classifies into exactly the protocol delivery statuses, at the protocol rank', () => {
    const classified = [
      { type: 'email.sent' },
      { type: 'email.delivery_delayed' },
      { type: 'email.delivered' },
      { type: 'email.failed' },
      { type: 'email.bounced', bounce: { type: 'Permanent' } },
      { type: 'email.bounced', bounce: { type: 'Transient' } },
      { type: 'email.complained' },
    ].map(({ type, ...data }) =>
      classifyResendEvent({ type, data: { email_id: 'em', ...data } }),
    );
    assert({
      given: 'every provider event the classifier handles',
      should:
        'reach every protocol delivery status and no other, so a status added in one place fails here before the database CHECK',
      actual: [...new Set(classified.map((event) => event?.status))].sort(),
      expected: [...emailDeliveryStatuses].sort(),
    });
    assert({
      given: 'each classified provider event',
      should: 'carry the rank the protocol assigns its status',
      actual: classified.map((event) => event?.rank),
      expected: classified.map((event) =>
        event ? emailDeliveryStatusRank(event.status) : undefined,
      ),
    });
  });

  test('ignores events without a usable message id', () => {
    assert({
      given: 'a delivered event lacking data.email_id',
      should: 'be ignored',
      actual: classifyResendEvent({ type: 'email.delivered', data: {} }),
      expected: null,
    });
  });
});

describe('Resend webhook authenticity', () => {
  test('accepts a correctly signed event and passes only ids and safe status on', async () => {
    const webhook = build();
    const response = await webhook.handle(delivery());
    assert({
      given: 'a valid raw-body signature within tolerance',
      should:
        'apply exactly the event ID, message ID, status and rank — no recipient data',
      actual: { status: response.status, applied },
      expected: {
        status: 200,
        applied: [
          {
            eventId: 'msg_evt_1',
            providerMessageId: 'em_1',
            status: 'delivered',
            rank: 3,
            suppress: null,
            at: applied[0] && (applied[0] as { at: string }).at,
          },
        ],
      },
    });
  });

  test('rejects tampered bodies, wrong secrets, missing headers and stale or future timestamps', async () => {
    const webhook = build();
    const stale = String(now() - 6 * 60);
    const future = String(now() + 6 * 60);
    const tolerated = String(now() - 4 * 60);
    const good = delivery();
    const tampered = delivery({
      signature:
        (await good.clone().text()) &&
        sign('msg_evt_1', String(now()), 'other'),
    });
    const results = await Promise.all([
      webhook.handle(tampered),
      webhook.handle(
        delivery({
          signature: sign(
            'msg_evt_1',
            String(now()),
            '{}',
            `whsec_${Buffer.from('another-secret-value-000000').toString('base64')}`,
          ),
        }),
      ),
      webhook.handle(delivery({ omit: 'svix-signature' })),
      webhook.handle(delivery({ omit: 'svix-id' })),
      webhook.handle(delivery({ omit: 'svix-timestamp' })),
      webhook.handle(delivery({ timestamp: stale })),
      webhook.handle(delivery({ timestamp: future })),
      webhook.handle(delivery({ timestamp: tolerated })),
    ]);
    assert({
      given: 'eight requests, seven of which fail authenticity',
      should:
        'reject the seven with 400 and accept only the one inside the five-minute tolerance',
      actual: {
        statuses: results.map((result) => result.status),
        applied: applied.length,
      },
      expected: {
        statuses: [400, 400, 400, 400, 400, 400, 400, 200],
        applied: 1,
      },
    });
  });

  test('a body altered after signing fails even with the original signature', async () => {
    const webhook = build();
    const request = delivery();
    const signature = request.headers.get('svix-signature') ?? '';
    const altered = delivery({
      body: JSON.stringify({
        type: 'email.complained',
        created_at: systemClock.now(),
        data: { email_id: 'em_1' },
      }),
      signature,
    });
    const response = await webhook.handle(altered);
    assert({
      given: 'a signed delivered event whose body is swapped for a complaint',
      should: 'be rejected without applying anything',
      actual: { status: response.status, applied: applied.length },
      expected: { status: 400, applied: 0 },
    });
  });

  test('rejects oversized bodies before verification', async () => {
    const webhook = build();
    const response = await webhook.handle(
      delivery({ body: JSON.stringify({ pad: 'x'.repeat(70_000) }) }),
    );
    assert({
      given: 'a body over the 64KB cap',
      should: 'be refused with 400 and apply nothing',
      actual: { status: response.status, applied: applied.length },
      expected: { status: 400, applied: 0 },
    });
  });

  test('duplicate events acknowledge 200; unknown recent messages ask for a retry, old ones are ignored', async () => {
    const duplicate = await build('duplicate').handle(delivery());
    const recent = await build('unknown-message').handle(delivery());
    const oldBody = JSON.stringify({
      type: 'email.delivered',
      created_at: isoAgo(3_600_000),
      data: { email_id: 'em_old' },
    });
    const old = await build('unknown-message').handle(
      delivery({ body: oldBody }),
    );
    assert({
      given: 'duplicate, racing-unknown and long-unknown events',
      should:
        '200 for duplicates, 503+Retry-After for a race, 200 for stale unknowns',
      actual: [
        duplicate.status,
        recent.status,
        recent.headers.get('retry-after'),
        old.status,
      ],
      expected: [200, 503, '5', 200],
    });
  });

  test('stops reading an endless chunked body at the cap instead of buffering it', async () => {
    const webhook = build();
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const request = new Request('http://localhost:3000/api/webhooks/resend', {
      method: 'POST',
      headers: {
        'svix-id': 'msg_evt_1',
        'svix-timestamp': String(now()),
        'svix-signature': 'v1,AAAA',
      },
      body: endless,
      // @ts-expect-error Bun/Node streaming request bodies need duplex.
      duplex: 'half',
    });
    const response = await webhook.handle(request);
    assert({
      given: 'a chunked body with no Content-Length that never ends',
      should: 'refuse with 400 after reading only about the 64 KiB cap',
      actual: {
        status: response.status,
        boundedRead: pulled < 200,
        applied: applied.length,
      },
      expected: { status: 400, boundedRead: true, applied: 0 },
    });
  });
});
