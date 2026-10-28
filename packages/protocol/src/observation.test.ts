import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  observationBaseField,
  observationFrameBytes,
  observationJsonBytes,
  observationResourceKey,
  parseObservationResourceKey,
} from './observation';
import { clientMessageSchema } from './realtime';
import { serverMessageSchema } from './realtime-server';

setupRitewayBun();
const id = 'a'.repeat(24);
const resource = { kind: 'channel-messages', id } as const;

describe('observation resource identity', () => {
  test('round trip', () => {
    assert({
      given: 'a channel-messages resource',
      should: 'key it as a Redis-safe segment and parse it back',
      actual: [
        observationResourceKey(resource),
        parseObservationResourceKey(observationResourceKey(resource)),
      ],
      expected: [`channel-messages_${id}`, resource],
    });
  });
  test('foreign keys', () => {
    assert({
      given: 'keys the identity did not produce',
      should: 'parse to null',
      actual: [
        'room_' + id,
        'channel-messages_',
        id,
        `channel-messages_${id}_x`,
      ].map(parseObservationResourceKey),
      expected: [null, null, null, null],
    });
  });
  test('base field', () => {
    assert({
      given: 'a base',
      should: 'digest partition and disclosure revision only',
      actual: observationBaseField({
        resource,
        partition: 'members',
        disclosureRevision: 7,
      }),
      expected: 'members.7',
    });
  });
});

describe('observation messages at the socket boundary', () => {
  test('observe and unobserve', () => {
    assert({
      given: 'observe, unobserve and an unknown kind',
      should: 'accept only known resource kinds',
      actual: [
        { v: 1, type: 'observe', id: 'o-1', resource },
        { v: 1, type: 'unobserve', id: 'o-2', resource },
        { v: 1, type: 'observe', id: 'o-3', resource: { kind: 'room', id } },
        { v: 1, type: 'observe', id: 'o-4', resource, since: '1:2' },
      ].map((frame) => clientMessageSchema.safeParse(frame).success),
      expected: [true, true, false, false],
    });
  });
  const snapshot = (body: unknown) => ({
    v: 1,
    type: 'observation.snapshot',
    resource,
    generation: 3,
    partition: 'members',
    disclosureRevision: 2,
    contentRevision: 9,
    body,
  });
  test('server frames', () => {
    assert({
      given: 'ready, snapshot and state frames',
      should: 'parse',
      actual: [
        {
          v: 1,
          type: 'observation.ready',
          id: 'o-1',
          resource,
          generation: 3,
          partition: 'members',
          disclosureRevision: 2,
          minimumContentRevision: 9,
          validForMs: 4700,
        },
        snapshot({ messages: [] }),
        {
          v: 1,
          type: 'observation.state',
          resource,
          generation: 3,
          state: 'revoked',
        },
      ].map((frame) => serverMessageSchema.safeParse(frame).success),
      expected: [true, true, true],
    });
  });
  test('permit lifetime bound', () => {
    assert({
      given: 'a ready frame promising more than the DEC-130 permit',
      should: 'refuse it',
      actual: serverMessageSchema.safeParse({
        v: 1,
        type: 'observation.ready',
        id: 'o-1',
        resource,
        generation: 3,
        partition: 'members',
        disclosureRevision: 2,
        minimumContentRevision: 0,
        validForMs: 4701,
      }).success,
      expected: false,
    });
  });
  test('frame byte bound', () => {
    const body = { text: 'é'.repeat(observationFrameBytes / 2) };
    assert({
      given: 'a snapshot whose UTF-8 encoding exceeds 128KiB',
      should: 'refuse it',
      actual: [
        observationJsonBytes(snapshot(body)) > observationFrameBytes,
        serverMessageSchema.safeParse(snapshot(body)).success,
      ],
      expected: [true, false],
    });
  });
});
