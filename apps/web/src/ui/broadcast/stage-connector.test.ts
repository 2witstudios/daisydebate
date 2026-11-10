import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { StageRoomHandle } from './stage-connection';
import { createStageConnection } from './stage-connector';
import type { StageLink } from './stage-view';

setupRitewayBun();

type FakeRoom = StageRoomHandle & {
  readonly name: string;
  readonly connects: number;
  readonly disconnects: number;
  resolve(): void;
  reject(error: unknown): void;
};

const fakeRoom = (
  name: string,
  options: { readonly disconnectRejects?: boolean } = {},
): FakeRoom => {
  let settle: { resolve(): void; reject(error: unknown): void } | null = null;
  let connects = 0;
  let disconnects = 0;
  return {
    name,
    get connects() {
      return connects;
    },
    get disconnects() {
      return disconnects;
    },
    connect: () => {
      connects += 1;
      return new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
    disconnect: () => {
      disconnects += 1;
      return options.disconnectRejects
        ? Promise.reject(new Error('already gone'))
        : Promise.resolve();
    },
    resolve: () => settle?.resolve(),
    reject: (error) => settle?.reject(error),
  };
};

const flush = () => new Promise<void>((done) => setTimeout(done, 0));

const unreachable = Object.assign(new Error('could not establish signal'), {
  name: 'ConnectionError',
});

const connection = () => {
  const rooms: FakeRoom[] = [];
  const links: StageLink[] = [];
  const stage = createStageConnection<FakeRoom>({
    createRoom: () => {
      const room = fakeRoom(String(rooms.length));
      rooms.push(room);
      return room;
    },
    onLink: (link) => links.push(link),
  });
  return { stage, rooms, links };
};
const offer = { url: 'wss://media.test', token: 'observer' };

describe('createStageConnection', () => {
  test('an unreachable server is caught and the next offer retries', async () => {
    const { stage, rooms, links } = connection();
    const first = stage.offer(offer);
    rooms[0]!.reject(unreachable);
    await first;
    const afterFailure = { links: [...links], joined: stage.joinedRoom() };
    const second = stage.offer(offer);
    rooms[1]!.resolve();
    await second;
    assert({
      given:
        'a connect that rejects with serverUnreachable, then another offer',
      should:
        'disconnect the failed room, stay reconnecting, and join a new room',
      actual: {
        afterFailure,
        connects: rooms.map((room) => room.connects),
        disconnects: rooms.map((room) => room.disconnects),
        links,
        joined: stage.joinedRoom() === rooms[1],
      },
      expected: {
        afterFailure: { links: [], joined: null },
        connects: [1, 1],
        disconnects: [1, 0],
        links: ['connected'],
        joined: true,
      },
    });
  });
  test('an offer while a connect is in flight starts no second connect', async () => {
    const { stage, rooms } = connection();
    const first = stage.offer(offer);
    const second = stage.offer(offer);
    rooms[0]!.resolve();
    await Promise.all([first, second]);
    assert({
      given: 'two offers before the first connect settles',
      should: 'create and connect one room',
      actual: rooms.map((room) => room.connects),
      expected: [1],
    });
  });
  test('closing during a connect disconnects whichever way it settles', async () => {
    const resolved = connection();
    const joining = resolved.stage.offer(offer);
    resolved.stage.close();
    resolved.rooms[0]!.resolve();
    await joining;
    const rejected = connection();
    const failing = rejected.stage.offer(offer);
    rejected.stage.close();
    rejected.rooms[0]!.reject(unreachable);
    await failing;
    assert({
      given: 'a close before the connect resolves, and before it rejects',
      should: 'leave no room joined in either case',
      actual: [
        resolved.stage.joinedRoom(),
        resolved.rooms[0]!.disconnects > 0,
        rejected.stage.joinedRoom(),
        rejected.rooms[0]!.disconnects > 0,
      ],
      expected: [null, true, null, true],
    });
  });
  test('a room that drops can be replaced on the next offer', async () => {
    const { stage, rooms, links } = connection();
    const first = stage.offer(offer);
    rooms[0]!.resolve();
    await first;
    stage.on({ type: 'dropped', room: rooms[0]! });
    const second = stage.offer(offer);
    rooms[1]!.resolve();
    await second;
    assert({
      given: 'a joined room that drops, then an offer',
      should: 'show reconnecting and join a second room',
      actual: { links, joined: stage.joinedRoom() === rooms[1] },
      expected: {
        links: ['connected', 'reconnecting', 'connected'],
        joined: true,
      },
    });
  });
  test('a disconnect that rejects never escapes', async () => {
    const rejections: unknown[] = [];
    const record = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', record);
    try {
      const rooms: FakeRoom[] = [];
      const stage = createStageConnection<FakeRoom>({
        createRoom: () => {
          const room = fakeRoom('x', { disconnectRejects: true });
          rooms.push(room);
          return room;
        },
        onLink: () => undefined,
      });
      const first = stage.offer(offer);
      rooms[0]!.reject(unreachable);
      await first;
      stage.close();
      await flush();
    } finally {
      process.off('unhandledRejection', record);
    }
    assert({
      given: 'a failed connect whose disconnect also rejects',
      should: 'raise no unhandled rejection',
      actual: rejections,
      expected: [],
    });
  });
});
