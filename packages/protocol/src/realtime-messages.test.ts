import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildDebatePresenceTopic,
  buildDebateTopic,
  clientMessageSchema,
  closeCodeTable,
  PROTOCOL_VERSION,
  serverMessageSchema,
} from './realtime';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const otherId = 'm8q3w1z7c5n6b4d2k2v9x0f4';

describe('client message schema', () => {
  const base = { v: PROTOCOL_VERSION } as const;

  test('accepts hello, subscribe, unsubscribe, presence.activity and ping', () => {
    const messages = [
      {
        ...base,
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ticket: 'ticket-value',
      },
      { ...base, type: 'subscribe', id, topic: buildDebateTopic(otherId) },
      { ...base, type: 'unsubscribe', id, topic: buildDebateTopic(otherId) },
      { ...base, type: 'presence.activity', activity: 'active' },
      { ...base, type: 'ping' },
    ];
    assert({
      given: 'one valid message of each client type',
      should: 'parse every one',
      actual: messages.map(
        (message) => clientMessageSchema.safeParse(message).success,
      ),
      expected: messages.map(() => true),
    });
  });

  test('rejects unknown message types', () => {
    assert({
      given: 'a message with a type outside the client union',
      should: 'fail safeParse',
      actual: clientMessageSchema.safeParse({
        ...base,
        type: 'debate.command',
      }).success,
      expected: false,
    });
  });

  test('rejects an unsupported envelope version', () => {
    assert({
      given: 'a ping stamped with a future protocol version',
      should: 'fail safeParse',
      actual: clientMessageSchema.safeParse({ v: 2, type: 'ping' }).success,
      expected: false,
    });
  });

  test('rejects a subscribe with a hand-built topic string', () => {
    assert({
      given: 'a subscribe naming an invalid topic string',
      should: 'fail safeParse',
      actual: clientMessageSchema.safeParse({
        ...base,
        type: 'subscribe',
        id,
        topic: 'debate:not-a-cuid2',
      }).success,
      expected: false,
    });
  });
});

describe('server message schema and close codes', () => {
  const base = { v: PROTOCOL_VERSION } as const;

  test('covers subscribed, resync_required, error, pong, delivered and presence updates', () => {
    const messages = [
      {
        ...base,
        type: 'subscribed',
        id,
        topic: buildDebateTopic(otherId),
        position: '5:12',
      },
      { ...base, type: 'resync_required', topic: buildDebateTopic(otherId) },
      {
        ...base,
        type: 'error',
        code: 'AUTHORIZATION',
        message: 'not authorized',
        requestId: 'req-1',
      },
      { ...base, type: 'pong' },
      {
        ...base,
        type: 'delivered',
        topic: buildDebateTopic(otherId),
        position: '5:13',
        payload: { version: 1, kind: 'debate.phase-changed', ids: [otherId] },
      },
      {
        ...base,
        type: 'presence.update',
        topic: buildDebatePresenceTopic(otherId),
        actorId: id,
        status: 'online',
      },
    ];
    assert({
      given: 'one valid message of each server type',
      should: 'parse every one',
      actual: messages.map(
        (message) => serverMessageSchema.safeParse(message).success,
      ),
      expected: messages.map(() => true),
    });
  });

  test('rejects unknown server message types and versions', () => {
    assert({
      given: 'an unrecognized type and a future version',
      should: 'fail safeParse for both',
      actual: [
        serverMessageSchema.safeParse({ ...base, type: 'debate.snapshot' })
          .success,
        serverMessageSchema.safeParse({ v: 2, type: 'pong' }).success,
      ],
      expected: [false, false],
    });
  });

  test('documents the close-code taxonomy', () => {
    assert({
      given: 'the close-code table',
      should:
        'name auth failed, rate limited, protocol unsupported, slow consumer, server restarting and revoked',
      actual: closeCodeTable.map((entry) => entry.reason).sort(),
      expected: [
        'auth_failed',
        'protocol_unsupported',
        'rate_limited',
        'revoked',
        'server_restarting',
        'slow_consumer',
      ].sort(),
    });
    assert({
      given: 'every close-code entry',
      should: 'carry a unique numeric code',
      actual: new Set(closeCodeTable.map((entry) => entry.code)).size,
      expected: closeCodeTable.length,
    });
  });
});
