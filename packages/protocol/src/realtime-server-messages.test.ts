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
      actual: messages.map(
        (message) => serverMessageSchema.safeParse(message).success,
      ),
      expected: messages.map(() => true),
    });
  });

  test('rejects presence.changed naming a non-presence topic, and rejects presence.update as removed', () => {
    assert({
      given:
        "presence.changed naming the debate's own topic instead of its :presence topic, and the removed presence.update type",
      should:
        'fail safeParse both: presence.changed only rides :presence, and presence.update no longer exists',
      actual: [
        serverMessageSchema.safeParse({
          ...base,
          type: 'presence.changed',
          topic: buildDebateTopic(otherId),
        }).success,
        serverMessageSchema.safeParse({
          ...base,
          type: 'presence.update',
          topic: buildDebatePresenceTopic(otherId),
          actorId: id,
          status: 'online',
        }).success,
      ],
      expected: [false, false],
    });
  });

  test('presence.changed carries no outbox position, unlike event', () => {
    assert({
      given: 'a presence.changed message stamped with an outbox position',
      should: 'fail safeParse: presence is never in the outbox (ADR 0033 §1)',
      actual: serverMessageSchema.safeParse({
        ...base,
        type: 'presence.changed',
        topic: buildDebatePresenceTopic(otherId),
        position: '5:12',
      }).success,
      expected: false,
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
      actual: messages.map(
        (message) => serverMessageSchema.safeParse(message).success,
      ),
      expected: messages.map(() => true),
    });
  });

  test('rejects an event whose payload kind the topic family does not allow', () => {
    assert({
      given:
        'an event on a debate topic carrying the owner-only inbox delta kind',
      should:
        'fail safeParse: the event refinement is not just an internal helper, it runs on the wire',
      actual: serverMessageSchema.safeParse({
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
      }).success,
      expected: false,
    });
  });

  test('the error message has no requestId field', () => {
    assert({
      given:
        "an error message shaped like the HTTP error schema, with the HTTP schema's requestId",
      should:
        'fail safeParse: the socket error correlates only by the envelope id',
      actual: serverMessageSchema.safeParse({
        ...base,
        type: 'error',
        code: 'AUTHORIZATION',
        message: 'refused',
        requestId: 'req-1',
      }).success,
      expected: false,
    });
  });

  test('rejects unknown server message types and versions', () => {
    assert({
      given: 'an unrecognized type and a future version',
      should: 'fail safeParse for both',
      actual: [
        serverMessageSchema.safeParse({ ...base, type: 'debate.snapshot' })
          .success,
        serverMessageSchema.safeParse({ v: 2, type: 'ready' }).success,
      ],
      expected: [false, false],
    });
  });

  test('builds every server message from an independently injected envelope version (RT-2.1c AC1, continued: envelope)', () => {
    const injectedEnvelopeVersion = 44 as EnvelopeVersion;
    const schema = buildServerMessageSchema(injectedEnvelopeVersion);
    const pongMessage = { v: 44, type: 'pong', id };
    assert({
      given:
        'a server message schema built with envelope version 44, and a pong stamped v:44',
      should:
        "accept only v:44 and reject PROTOCOL_VERSION's and ENVELOPE_VERSION's value (both 1), proving event, presence.changed and every other server message share one un-hard-coded envelope",
      actual: [
        schema.safeParse(pongMessage).success,
        schema.safeParse({ ...pongMessage, v: PROTOCOL_VERSION }).success,
        schema.safeParse({ ...pongMessage, v: ENVELOPE_VERSION }).success,
      ],
      expected: [true, false, false],
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
