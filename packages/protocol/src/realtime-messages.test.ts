import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildDebatePresenceTopic,
  buildDebateTopic,
  clientMessageSchema,
  closeCodeTable,
  PROTOCOL_VERSION,
  serverMessageSchema,
  ticketSchema,
} from './realtime';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const otherId = 'm8q3w1z7c5n6b4d2k2v9x0f4';
const ticket = 'A'.repeat(43);

describe('client message schema', () => {
  const base = { v: PROTOCOL_VERSION } as const;

  test('accepts hello, subscribe, unsubscribe, presence.activity and ping{id}', () => {
    const messages = [
      { ...base, type: 'hello', protocolVersion: PROTOCOL_VERSION, ticket },
      { ...base, type: 'subscribe', id, topic: buildDebateTopic(otherId) },
      { ...base, type: 'unsubscribe', id, topic: buildDebateTopic(otherId) },
      { ...base, type: 'presence.activity', activity: 'active' },
      { ...base, type: 'ping', id },
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
      actual: clientMessageSchema.safeParse({ v: 2, type: 'ping', id }).success,
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

  test("rejects ping without id, per ADR 0031's ping{id}/pong{id} pairing", () => {
    assert({
      given: 'a ping with no id',
      should: 'fail safeParse',
      actual: clientMessageSchema.safeParse({ ...base, type: 'ping' }).success,
      expected: false,
    });
  });
});

describe('the connect ticket', () => {
  test('accepts exactly 43 base64url characters and rejects other shapes', () => {
    assert({
      given:
        'a 43-character base64url ticket, one 42 characters, and one with an invalid character',
      should: 'accept only the 43-character one',
      actual: [
        ticketSchema.safeParse(ticket).success,
        ticketSchema.safeParse(ticket.slice(1)).success,
        ticketSchema.safeParse(`${ticket.slice(1)}!`).success,
      ],
      expected: [true, false, false],
    });
  });
});

describe('server message schema and close codes', () => {
  const base = { v: PROTOCOL_VERSION } as const;

  test('covers subscribed, unsubscribed, resync_required, error, pong{id}, event and presence.update', () => {
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
        type: 'presence.update',
        topic: buildDebatePresenceTopic(otherId),
        actorId: id,
        status: 'online',
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

  test('documents the close-code taxonomy exactly as ADR 0031 §7 fixes it', () => {
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
