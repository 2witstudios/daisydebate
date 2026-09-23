import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildDebatePresenceTopic,
  buildDebateTopic,
  buildServerMessageSchema,
  closeCodeTable,
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  serverMessageSchema,
  type EnvelopeVersion,
} from './realtime';
import { parseOutcome } from './parse-outcome.test-support';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const otherId = 'm8q3w1z7c5n6b4d2k2v9x0f4';

describe('server message schema and close codes', () => {
  const base = { v: ENVELOPE_VERSION } as const;

  test('covers subscribed{position}, unsubscribed, resync_required, error, pong{id}, event and presence.changed', () => {
    const messages = [
      {
        ...base,
        type: 'subscribed',
        id,
        topic: buildDebateTopic(otherId),
        position: '5:12',
      },
      {
        ...base,
        type: 'unsubscribed',
        id,
        topic: buildDebateTopic(otherId),
      },
      {
        ...base,
        type: 'resync_required',
        id,
        topic: buildDebateTopic(otherId),
      },
      { ...base, type: 'error', code: 'AUTHORIZATION', message: 'refused' },
      { ...base, type: 'pong', id },
      {
        ...base,
        type: 'event',
        topic: buildDebateTopic(otherId),
        position: '5:13',
        payload: { version: 1, kind: 'debate.phase-changed', ids: [otherId] },
      },
      {
        ...base,
        type: 'presence.changed',
        topic: buildDebatePresenceTopic(otherId),
      },
    ];
    assert({
      given: 'one valid message of each subscription/heartbeat/delivery type',
      should: 'parse every one',
      actual: messages.map((message) =>
        parseOutcome(serverMessageSchema, message),
      ),
      expected: messages.map((message) => ({ data: message })),
    });
  });

  test('rejects presence.changed naming a non-presence topic, and rejects presence.update as removed', () => {
    assert({
      given:
        "presence.changed naming the debate's own topic instead of its :presence topic, and the removed presence.update type",
      should:
        'fail safeParse both: presence.changed only rides :presence, and presence.update no longer exists',
      actual: [
        parseOutcome(serverMessageSchema, {
          ...base,
          type: 'presence.changed',
          topic: buildDebateTopic(otherId),
        }),
        parseOutcome(serverMessageSchema, {
          ...base,
          type: 'presence.update',
          topic: buildDebatePresenceTopic(otherId),
          actorId: id,
          status: 'online',
        }),
      ],
      expected: [{ issues: ['topic'] }, { issues: ['type'] }],
    });
  });

  test('presence.changed carries no outbox position, unlike event', () => {
    assert({
      given: 'a presence.changed message stamped with an outbox position',
      should: 'reject: presence is never in the outbox (ADR 0033 §1)',
      actual: parseOutcome(serverMessageSchema, {
        ...base,
        type: 'presence.changed',
        topic: buildDebatePresenceTopic(otherId),
        position: '5:12',
      }),
      expected: { issues: ['(root)'] },
    });
  });

  test('covers the server-initiated messages: ready, revoked and server.restarting', () => {
    const messages = [
      { ...base, type: 'ready' },
      { ...base, type: 'revoked' },
      { ...base, type: 'server.restarting' },
    ];
    assert({
      given: 'each server-initiated message, carrying no id',
      should: 'parse every one',
      actual: messages.map((message) =>
        parseOutcome(serverMessageSchema, message),
      ),
      expected: messages.map((message) => ({ data: message })),
    });
  });

  test('rejects an event whose payload kind the topic family does not allow', () => {
    assert({
      given:
        'an event on a debate topic carrying the owner-only inbox delta kind',
      should:
        'fail safeParse: the event refinement is not just an internal helper, it runs on the wire',
      actual: parseOutcome(serverMessageSchema, {
        ...base,
        type: 'event',
        topic: buildDebateTopic(otherId),
        position: '5:14',
        payload: {
          version: 1,
          kind: 'user.notification-delivered',
          ids: [otherId],
          notificationType: 'debate.forfeit',
          occurredAt: '2026-01-01T00:00:00.000Z',
        },
      }),
      expected: { issues: ['payload.kind'] },
    });
  });

  test('the error message has no requestId field', () => {
    assert({
      given:
        "an error message shaped like the HTTP error schema, with the HTTP schema's requestId",
      should:
        'fail safeParse: the socket error correlates only by the envelope id',
      actual: parseOutcome(serverMessageSchema, {
        ...base,
        type: 'error',
        code: 'AUTHORIZATION',
        message: 'refused',
        requestId: 'req-1',
      }),
      expected: { issues: ['(root)'] },
    });
  });

  test('rejects unknown server message types and versions', () => {
    assert({
      given: 'an unrecognized type and a future version',
      should: 'reject for both',
      actual: [
        parseOutcome(serverMessageSchema, { ...base, type: 'debate.snapshot' }),
        parseOutcome(serverMessageSchema, { v: 2, type: 'ready' }),
      ],
      expected: [{ issues: ['type'] }, { issues: ['v'] }],
    });
  });

  test('builds every server message from an independently injected envelope version (RT-2.1c AC1, continued: envelope)', () => {
    const injectedEnvelopeVersion = 44 as EnvelopeVersion;
    const schema = buildServerMessageSchema(injectedEnvelopeVersion);
    const topic = buildDebateTopic(otherId);
    const messagesAtV44 = [
      { v: 44, type: 'subscribed', id, topic, position: '5:12' },
      { v: 44, type: 'unsubscribed', id, topic },
      { v: 44, type: 'resync_required', id, topic },
      { v: 44, type: 'error', code: 'AUTHORIZATION', message: 'refused' },
      { v: 44, type: 'pong', id },
      {
        v: 44,
        type: 'event',
        topic,
        position: '5:13',
        payload: { version: 1, kind: 'debate.phase-changed', ids: [otherId] },
      },
      {
        v: 44,
        type: 'presence.changed',
        topic: buildDebatePresenceTopic(otherId),
      },
      { v: 44, type: 'ready' },
      { v: 44, type: 'revoked' },
      { v: 44, type: 'server.restarting' },
    ];
    assert({
      given:
        'a server message schema built with envelope version 44, and one message of every server type stamped v:44',
      should:
        "accept v:44 on every one of them, and reject each when restamped with PROTOCOL_VERSION's or ENVELOPE_VERSION's value (both 1), proving no member's envelope is hard-coded to either constant",
      actual: [
        ...messagesAtV44.map((message) => parseOutcome(schema, message)),
        ...messagesAtV44.map((message) =>
          parseOutcome(schema, { ...message, v: PROTOCOL_VERSION }),
        ),
        ...messagesAtV44.map((message) =>
          parseOutcome(schema, { ...message, v: ENVELOPE_VERSION }),
        ),
      ],
      expected: [
        ...messagesAtV44.map((message) => ({ data: message })),
        ...messagesAtV44.map(() => ({ issues: ['v'] })),
        ...messagesAtV44.map(() => ({ issues: ['v'] })),
      ],
    });
  });

  test('documents the close-code taxonomy exactly as ADR 0031 §8 fixes it', () => {
    assert({
      given: 'the close-code table',
      should: 'assign the ADR-fixed code to each reason',
      actual: closeCodeTable.map(({ code, reason }) => [reason, code]),
      expected: [
        ['auth_failed', 4001],
        ['revoked', 4002],
        ['protocol_unsupported', 4003],
        ['rate_limited', 4004],
        ['slow_consumer', 4005],
        ['server_restarting', 4006],
      ],
    });
  });
});
