import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoomReadinessOperations } from './room-readiness';
import type { RedisTransport } from './transport';

setupRitewayBun();
const id = 'abcdefghijklmnopqrstuvwx';
test('Room readiness refuses nonexpiring consent before Redis I/O', async () => {
  let calls = 0;
  const client = {
    connect: async () => {
      calls++;
    },
    send: async () => null,
  } as unknown as RedisTransport;
  const ready = createRoomReadinessOperations({
    client,
    namespace: 'test',
    reportFailure: () => {},
  });
  let message = '';
  try {
    await ready.setRoomConsent({
      roomId: id,
      version: 1,
      actorId: id,
      commandId: id,
      ttlMs: 0,
    });
  } catch (e) {
    message = (e as Error).message;
  }
  assert({
    given: 'a zero consent lifetime',
    should: 'reject before touching Redis',
    actual: [message, calls],
    expected: ['Consent lifetime must be a positive integer', 0],
  });
});
test('Room readiness requires current durable fence and does not mutate on read', async () => {
  const calls: string[] = [];
  const client = {
    connect: async () => {},
    send: async (cmd: string, args: string[]) => {
      calls.push(cmd);
      return args.at(-1) === id ? [1] : [];
    },
  } as unknown as RedisTransport;
  const ready = createRoomReadinessOperations({
    client,
    namespace: 'test',
    reportFailure: () => {},
  });
  const held = [{ actorId: id, commandId: 'zyxwvutsrqponmlkjihgfedc' }];
  const stale = await ready.readRoomConsent(id, 1, held);
  const current = await ready.readRoomConsent(id, 1, [
    { actorId: id, commandId: id },
  ]);
  assert({
    given: 'stale and matching durable fences',
    should: 'report only matching consent without refreshing expiry',
    actual: [stale, current, calls],
    expected: [[], [id], ['EVAL', 'EVAL']],
  });
});

test('a failed replacement Ready cannot overwrite the accepted durable lease', async () => {
  const values = new Map<string, string>();
  let failAfterWrite = false;
  const client = {
    connect: async () => {},
    send: async (command: string, args: string[]) => {
      if (command === 'SET') {
        values.set(args[0]!, args[1]!);
        if (failAfterWrite) throw new Error('Lost Redis acknowledgement');
        return 'OK';
      }
      const count = Number(args[1]);
      return args.slice(2, 2 + count).flatMap((key, index) => {
        const value = values.get(key);
        return value && JSON.parse(value).commandId === args[2 + count + index]
          ? [index + 1]
          : [];
      });
    },
  } as unknown as RedisTransport;
  const ready = createRoomReadinessOperations({
    client,
    namespace: 'test',
    reportFailure: () => {},
  });
  const input = {
    roomId: id,
    version: 1,
    actorId: id,
    commandId: id,
    ttlMs: 60_000,
  };
  await ready.setRoomConsent(input);
  failAfterWrite = true;
  await ready
    .setRoomConsent({ ...input, commandId: 'zyxwvutsrqponmlkjihgfedc' })
    .catch(() => undefined);
  assert({
    given:
      'a replacement write whose acknowledgement fails before SQL can commit its fence',
    should:
      'retain readiness for the previous durable command without accepting the replacement',
    actual: await ready.readRoomConsent(id, 1, [
      { actorId: id, commandId: id },
    ]),
    expected: [id],
  });
});
