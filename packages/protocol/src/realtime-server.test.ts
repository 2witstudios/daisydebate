import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { serverMessageSchema } from './realtime-server';

setupRitewayBun();
const actor = 'a'.repeat(24);
const room = 'b'.repeat(24);
describe('server message trust boundary', () => {
  const cases = [
    { type: 'ready' },
    { type: 'pong', id: 'ping-1' },
    { type: 'subscribed', id: actor, topic: `room:${room}`, position: '1:2' },
    { type: 'unsubscribed', id: actor, topic: `room:${room}` },
    { type: 'resync_required', id: actor, topic: `room:${room}` },
    { type: 'error', id: actor, code: 'AUTHORIZATION', message: 'Not allowed' },
    {
      type: 'event',
      topic: `room:${room}`,
      position: '1:2',
      payload: { kind: 'room.changed', ids: [room], entityVersion: 2 },
    },
  ];
  for (const frame of cases)
    test(`accept ${frame.type}`, () => {
      assert({
        given: `a canonical ${frame.type} frame`,
        should: 'parse',
        actual: serverMessageSchema.safeParse({ v: 1, ...frame }).success,
        expected: true,
      });
    });
  for (const payload of [
    { kind: 'session.revoked', ids: [actor], entityVersion: 1 },
    { kind: 'room.changed', ids: [actor], entityVersion: 1 },
    { kind: 'room.changed', ids: [room], entityVersion: 1, text: 'private' },
  ])
    test(`refuse unsafe event ${JSON.stringify(payload)}`, () => {
      assert({
        given: 'a control, mismatched resource, or content-bearing payload',
        should: 'refuse at the shared delivery boundary',
        actual: serverMessageSchema.safeParse({
          v: 1,
          type: 'event',
          topic: `room:${room}`,
          position: '1:2',
          payload,
        }).success,
        expected: false,
      });
    });
});
