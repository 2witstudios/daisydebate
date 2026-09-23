import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildDebateTopic,
  buildHelloMessageSchema,
  clientMessageSchema,
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  ticketSchema,
  type EnvelopeVersion,
  type ProtocolVersion,
} from './realtime';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const otherId = 'm8q3w1z7c5n6b4d2k2v9x0f4';
const ticket = 'A'.repeat(43);

describe('client message schema', () => {
  const base = { v: ENVELOPE_VERSION } as const;

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
      given: 'a ping stamped with a future envelope version',
      should: 'fail safeParse',
      actual: clientMessageSchema.safeParse({ v: 2, type: 'ping', id }).success,
      expected: false,
    });
  });

  test('validates the envelope v and hello.protocolVersion independently, as distinct values (ADR 0031 §6)', () => {
    assert({
      given:
        'a hello with a supported envelope v but an unsupported protocolVersion, and one the other way round',
      should:
        'fail safeParse both times: neither field stands in for the other',
      actual: [
        clientMessageSchema.safeParse({
          v: ENVELOPE_VERSION,
          type: 'hello',
          protocolVersion: 2,
          ticket,
        }).success,
        clientMessageSchema.safeParse({
          v: 2,
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          ticket,
        }).success,
      ],
      expected: [false, false],
    });
  });

  test('builds the composed hello message schema from independently injected envelope and protocol versions (RT-2.1c AC1)', () => {
    const injectedEnvelopeVersion = 11 as EnvelopeVersion;
    const injectedProtocolVersion = 22 as ProtocolVersion;
    const helloSchema = buildHelloMessageSchema(
      injectedEnvelopeVersion,
      injectedProtocolVersion,
    );
    const validMessage = {
      v: 11,
      type: 'hello',
      protocolVersion: 22,
      ticket,
    };
    assert({
      given:
        'the hello schema built from distinct injected envelope (11) and protocol (22) versions',
      should:
        "accept only its own pairing and reject each field taking the other field's value, proving neither the schema composition nor a hard-coded field can stand in for the other",
      actual: [
        helloSchema.safeParse(validMessage).success,
        helloSchema.safeParse({ ...validMessage, v: 22 }).success,
        helloSchema.safeParse({ ...validMessage, protocolVersion: 11 }).success,
      ],
      expected: [true, false, false],
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

  test('accepts a subscribe carrying a well-formed since cursor and rejects a malformed one', () => {
    const subscribeWith = (since: unknown) => ({
      ...base,
      type: 'subscribe',
      id,
      topic: buildDebateTopic(otherId),
      since,
    });
    assert({
      given:
        'subscribe with no since, a well-formed since, and a malformed since',
      should: 'accept the first two and reject the third',
      actual: [
        clientMessageSchema.safeParse({
          ...base,
          type: 'subscribe',
          id,
          topic: buildDebateTopic(otherId),
        }).success,
        clientMessageSchema.safeParse(subscribeWith('12:34')).success,
        clientMessageSchema.safeParse(subscribeWith('not-a-cursor')).success,
      ],
      expected: [true, true, false],
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
