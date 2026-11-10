import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Logger } from '@daisy/logger';
import { createUnsubscribeRoute } from './unsubscribe-handler';
import {
  oneClickUnsubscribeUrl,
  unsubscribeToken,
  type Unsubscribe,
} from './unsubscribe-token';

setupRitewayBun();

const SUBKEY = 'b'.repeat(64);
const APP = 'https://daisy.example.com';
const member: Unsubscribe = {
  userId: 'memberuser0000000000001a',
  kind: 'challenge_received',
};

const recordingLogger = (events: unknown[]): Logger => ({
  log: (event) => {
    events.push(event);
  },
  child: () => recordingLogger(events),
});

const route = () => {
  const turnedOff: Unsubscribe[] = [];
  const events: unknown[] = [];
  const handle = createUnsubscribeRoute({
    store: {
      unsubscribeNotificationEmail: async (input) => {
        turnedOff.push(input);
      },
    },
    subkey: () => SUBKEY,
    logger: recordingLogger(events),
  });
  return { handle, turnedOff, events };
};

const pageForm = (fields: Record<string, string>) => {
  const body = new URLSearchParams({ from: 'page', ...fields });
  return new Request(`${APP}/api/notifications/unsubscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
};

describe('POST /api/notifications/unsubscribe (ADR 0124)', () => {
  test('a mail client’s one-click post', async () => {
    const { handle, turnedOff, events } = route();
    const response = await handle(
      new Request(oneClickUnsubscribeUrl(APP, SUBKEY, member), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
    );
    assert({
      given: 'an RFC 8058 one-click post to the link an email named',
      should: 'turn off only that member’s kind of email and answer 200',
      actual: { status: response.status, turnedOff, events },
      expected: {
        status: 200,
        turnedOff: [member],
        events: ['notifications.unsubscribed'],
      },
    });
  });

  test('the unsubscribe page’s form', async () => {
    const { handle, turnedOff } = route();
    const response = await handle(
      pageForm({
        u: member.userId,
        k: member.kind,
        t: unsubscribeToken(SUBKEY, member.userId, member.kind),
      }),
    );
    assert({
      given: 'the page’s native form with a valid link',
      should: 'turn the kind off and send the page back to say so',
      actual: {
        status: response.status,
        location: response.headers.get('location'),
        turnedOff,
      },
      expected: {
        status: 303,
        location: '/unsubscribe?done=challenge_received',
        turnedOff: [member],
      },
    });
  });

  test('a link that is not valid', async () => {
    const forged = unsubscribeToken('c'.repeat(64), member.userId, member.kind);
    const results = [];
    for (const request of [
      pageForm({ u: member.userId, k: member.kind, t: forged }),
      pageForm({
        u: member.userId,
        k: 'followed_debater_live',
        t: unsubscribeToken(SUBKEY, member.userId, member.kind),
      }),
      new Request(
        `${APP}/api/notifications/unsubscribe?u=${member.userId}&k=${member.kind}&t=${forged}`,
        { method: 'POST' },
      ),
    ]) {
      const { handle, turnedOff, events } = route();
      const response = await handle(request);
      results.push({
        status: response.status,
        location: response.headers.get('location'),
        turnedOff: turnedOff.length,
        events,
      });
    }
    assert({
      given:
        'a token another key made, a kind sent on no email, or a forged one-click post',
      should:
        'change nothing, log the refusal, and say only that the link is not valid',
      actual: results,
      expected: [
        {
          status: 303,
          location: '/unsubscribe?invalid=1',
          turnedOff: 0,
          events: ['notifications.unsubscribe_refused'],
        },
        {
          status: 303,
          location: '/unsubscribe?invalid=1',
          turnedOff: 0,
          events: ['notifications.unsubscribe_refused'],
        },
        {
          status: 400,
          location: null,
          turnedOff: 0,
          events: ['notifications.unsubscribe_refused'],
        },
      ],
    });
  });

  test('an oversized body', async () => {
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 8; i += 1)
          controller.enqueue(new TextEncoder().encode('x'.repeat(512)));
        controller.close();
      },
    });
    const results = [];
    for (const init of [
      { headers: { 'content-length': '4096' }, body: 'x'.repeat(4096) },
      { body: chunked, duplex: 'half' },
    ] as RequestInit[]) {
      const { handle, turnedOff } = route();
      const response = await handle(
        new Request(`${APP}/api/notifications/unsubscribe`, {
          method: 'POST',
          ...init,
        }),
      );
      results.push({ status: response.status, turnedOff: turnedOff.length });
    }
    assert({
      given:
        'a body larger than any unsubscribe form, declared or streamed without a length',
      should: 'stop reading at the bound and refuse it',
      actual: results,
      expected: [
        { status: 413, turnedOff: 0 },
        { status: 413, turnedOff: 0 },
      ],
    });
  });
});
