import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCaptureHeardOperations } from './capture-heard';
import type { RedisTransport } from './transport';
setupRitewayBun();

const round = 'abcdefghijklmnopqrstuvwx';
const seat = 'mnopqrstuvwxabcdefghijkl';

const memoryClient = () => {
  const store = new Map<string, string>();
  const sets: unknown[][] = [];
  const client: RedisTransport = {
    connect: async () => {},
    ping: async () => 'PONG',
    get: async (key) => store.get(String(key)) ?? null,
    getdel: async () => null,
    del: async () => 0,
    close: () => {},
    send: async (command, args) => {
      if (command === 'SET') {
        sets.push(args);
        store.set(String(args[0]), String(args[1]));
      }
      return 'OK';
    },
  };
  return { client, store, sets };
};

test('capture reports the seat it hears on a track, under a capture key (DEC-226)', async () => {
  const { client, store, sets } = memoryClient();
  const heard = createCaptureHeardOperations({
    client,
    namespace: 'unit',
    reportFailure: () => {},
  });
  await heard.writeCaptureHeard({ roundId: round, trackId: 'TR_a1', seat });
  assert({
    given: 'capture hearing a bot seat on a track',
    should:
      'store only the seat under the capture-heard key for 30 s, and read it back',
    actual: [
      [...store.keys()],
      sets[0]?.slice(2),
      await heard.readCaptureHeard(round, 'TR_a1'),
      await heard.readCaptureHeard(round, 'TR_other'),
    ],
    expected: [
      [`unit:v1:captureheard:${round}:TR_a1`],
      ['PX', '30000'],
      seat,
      null,
    ],
  });
});

test('a heard report names a real seat', async () => {
  const { client, sets } = memoryClient();
  const heard = createCaptureHeardOperations({
    client,
    namespace: 'unit',
    reportFailure: () => {},
  });
  const refusal = await Promise.resolve()
    .then(() =>
      heard.writeCaptureHeard({
        roundId: round,
        trackId: 'TR_a1',
        seat: 'not a seat',
      }),
    )
    .then(
      () => null,
      (error: Error) => error.message,
    );
  assert({
    given: 'a heard report whose seat is not an id',
    should: 'refuse it before any write',
    actual: [refusal, sets.length],
    expected: ['Invalid heard seat', 0],
  });
});
