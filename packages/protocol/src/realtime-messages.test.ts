import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildClientMessageSchema,
  buildDebateTopic,
  buildHelloMessageSchema,
  clientMessageSchema,
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  ticketSchema,
  type EnvelopeVersion,
  type ProtocolVersion,
} from './realtime';
import {
  parseEach,
  parseOutcome,
  parsedUnchanged,
} from './parse-outcome.test-support';

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
      actual: parseEach(clientMessageSchema, messages),
      expected: parsedUnchanged(messages),
    });
  });

  test('rejects unknown message types', () => {
    assert({
      given: 'a message with a type outside the client union',
      should: 'reject it, naming the offending field',
      actual: parseOutcome(clientMessageSchema, {
        ...base,
        type: 'debate.command',
      }),
      expected: { issues: ['type'] },
    });
  });

  test('rejects an unsupported envelope version', () => {
    assert({
      given: 'a ping stamped with a future envelope version',
      should: 'reject it, naming the offending field',
      actual: parseOutcome(clientMessageSchema, { v: 2, type: 'ping', id }),
      expected: { issues: ['v'] },
    });
  });

  test('validates the envelope v and hello.protocolVersion independently, as distinct values (ADR 0031 §6)', () => {
    assert({
      given:
        'a hello with a supported envelope v but an unsupported protocolVersion, and one the other way round',
      should:
        'fail safeParse both times: neither field stands in for the other',
      actual: [
        parseOutcome(clientMessageSchema, {
          v: ENVELOPE_VERSION,
          type: 'hello',
          protocolVersion: 2,
          ticket,
        }),
        parseOutcome(clientMessageSchema, {
          v: 2,
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          ticket,
        }),
      ],
      expected: [{ issues: ['protocolVersion'] }, { issues: ['v'] }],
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
        parseOutcome(helloSchema, validMessage),
        parseOutcome(helloSchema, { ...validMessage, v: 22 }),
        parseOutcome(helloSchema, { ...validMessage, protocolVersion: 11 }),
      ],
      expected: [
        { data: validMessage },
        { issues: ['v'] },
        { issues: ['protocolVersion'] },
      ],
    });
  });

  test('builds every non-hello client message from an independently injected envelope version (RT-2.1c AC1, continued: envelope)', () => {
    const injectedEnvelopeVersion = 33 as EnvelopeVersion;
    const schema = buildClientMessageSchema(
      injectedEnvelopeVersion,
      PROTOCOL_VERSION,
    );
    const topic = buildDebateTopic(otherId);
    const messagesAtV33 = [
      { v: 33, type: 'subscribe', id, topic },
      { v: 33, type: 'unsubscribe', id, topic },
      { v: 33, type: 'presence.activity', activity: 'active' },
      { v: 33, type: 'ping', id },
    ];
    assert({
      given:
        'a client message schema built with envelope version 33, and one message of every non-hello type stamped v:33',
      should:
        "accept v:33 on every one of them, and reject each when restamped with PROTOCOL_VERSION's or ENVELOPE_VERSION's value (both 1), proving no member's envelope is hard-coded to either constant",
      actual: [
        ...messagesAtV33.map((message) => parseOutcome(schema, message)),
        ...messagesAtV33.map((message) =>
          parseOutcome(schema, { ...message, v: PROTOCOL_VERSION }),
        ),
        ...messagesAtV33.map((message) =>
          parseOutcome(schema, { ...message, v: ENVELOPE_VERSION }),
        ),
      ],
      expected: [
        ...messagesAtV33.map((message) => ({ data: message })),
        ...messagesAtV33.map(() => ({ issues: ['v'] })),
        ...messagesAtV33.map(() => ({ issues: ['v'] })),
      ],
    });
  });

  test('rejects a subscribe with a hand-built topic string', () => {
    assert({
      given: 'a subscribe naming an invalid topic string',
      should: 'reject it, naming the offending field',
      actual: parseOutcome(clientMessageSchema, {
        ...base,
        type: 'subscribe',
        id,
        topic: 'debate:not-a-cuid2',
      }),
      expected: { issues: ['topic'] },
    });
  });

  test("rejects ping without id, per ADR 0031's ping{id}/pong{id} pairing", () => {
    assert({
      given: 'a ping with no id',
      should: 'reject it, naming the offending field',
      actual: parseOutcome(clientMessageSchema, { ...base, type: 'ping' }),
      expected: { issues: ['id'] },
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
    const withoutSince = {
      ...base,
      type: 'subscribe',
      id,
      topic: buildDebateTopic(otherId),
    };
    assert({
      given:
        'subscribe with no since, a well-formed since, and a malformed since',
      should: 'accept the first two and reject the third',
      actual: [
        parseOutcome(clientMessageSchema, withoutSince),
        parseOutcome(clientMessageSchema, subscribeWith('12:34')),
        parseOutcome(clientMessageSchema, subscribeWith('not-a-cursor')),
      ],
      expected: [
        { data: withoutSince },
        { data: subscribeWith('12:34') },
        { issues: ['since'] },
      ],
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
        parseOutcome(ticketSchema, ticket),
        parseOutcome(ticketSchema, ticket.slice(1)),
        parseOutcome(ticketSchema, `${ticket.slice(1)}!`),
      ],
      expected: [
        { data: ticket },
        { issues: ['(root)'] },
        { issues: ['(root)'] },
      ],
    });
  });
});
