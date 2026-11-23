import { virtualClock } from '@daisy/clock/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { virtualBrowserTime } from '../test-support/virtual-browser-time.test-support';
import type { StageAnswer } from './stage-answer';
import {
  createStageRoomDriver,
  type StageMediaEvents,
  type StageRead,
} from './stage-driver';

setupRitewayBun();

const room = { url: 'wss://media.test', token: 'observer' };
const speech = (over: Partial<StageAnswer> = {}): StageAnswer =>
  ({
    phase: 'speech',
    clock: { label: 'Constructive', endsAt: '2026-11-02T00:01:00.000Z' },
    seats: [],
    debaterIdentities: ['ada', 'bo'],
    nowMs: 0,
    room,
    ...over,
  }) as StageAnswer;

const start = (options: {
  readonly answer: (attempt: number) => StageRead;
  readonly connect?: () => Promise<void>;
  readonly fonts?: () => Promise<void>;
}) => {
  const clock = virtualClock();
  const { scheduler } = virtualBrowserTime(clock);
  const said: string[] = [];
  const media: string[] = [];
  const rooms: StageMediaEvents<string>[] = [];
  let attempt = 0;
  const driver = createStageRoomDriver<string>({
    read: async () => options.answer(++attempt),
    every: scheduler.every,
    now: clock.nowMs,
    createRoom: (events) => {
      rooms.push(events);
      const index = rooms.length;
      return {
        connect: async () => {
          media.push(`connect ${index}`);
          await options.connect?.();
        },
        disconnect: async () => void media.push(`disconnect ${index}`),
        participants: () => [],
      };
    },
    play: (track) => media.push(`play ${track}`),
    release: (track) => media.push(`release ${track}`),
    fontsSettled: options.fonts ?? (() => Promise.resolve()),
    signal: (line) => said.push(line),
  });
  return { clock, driver, said, media, rooms };
};

describe('stage room driver', () => {
  test('a read that offers a room joins it once and shows the link', async () => {
    const { clock, driver, media } = start({
      answer: () => ({ status: 200, next: speech() }),
    });
    const before = driver.readSnapshot().link;
    await clock.advance(3000);
    assert({
      given: 'a speech snapshot every second, each offering the room',
      should: 'connect one room and show the link connected',
      actual: { before, media, link: driver.readSnapshot().link },
      expected: {
        before: 'reconnecting',
        media: ['connect 1'],
        link: 'connected',
      },
    });
  });

  test('only debaters are shown: cameras as tiles, voices played', async () => {
    const { clock, driver, media, rooms } = start({
      answer: () => ({ status: 200, next: speech() }),
    });
    await clock.advance(0);
    const events = rooms[0]!;
    events.subscribed('ada', 'ada-camera', true);
    events.subscribed('judge', 'judge-camera', true);
    events.subscribed('bo', 'bo-voice', false);
    const shown = [...driver.readSnapshot().cameras];
    events.unsubscribed('ada', 'ada-camera', true);
    events.unsubscribed('bo', 'bo-voice', false);
    assert({
      given: 'tracks from two debaters and a judge',
      should: 'tile the debater camera, play the voice, and let both go',
      actual: {
        shown,
        after: [...driver.readSnapshot().cameras],
        media: media.slice(1),
      },
      expected: {
        shown: [['ada', 'ada-camera']],
        after: [],
        media: ['play bo-voice', 'release bo-voice'],
      },
    });
  });

  test('a dropped room takes its tiles, and the next read rejoins', async () => {
    const { clock, driver, media, rooms } = start({
      answer: () => ({ status: 200, next: speech() }),
    });
    await clock.advance(0);
    rooms[0]!.subscribed('ada', 'ada-camera', true);
    rooms[0]!.disconnected();
    const dropped = {
      cameras: driver.readSnapshot().cameras.size,
      link: driver.readSnapshot().link,
    };
    await clock.advance(1000);
    assert({
      given: 'the joined room disconnecting',
      should: 'clear the tiles, show reconnecting, and join a fresh room',
      actual: { dropped, media, link: driver.readSnapshot().link },
      expected: {
        dropped: { cameras: 0, link: 'reconnecting' },
        media: ['connect 1', 'connect 2'],
        link: 'connected',
      },
    });
  });

  test('a resuming room shows reconnecting until it resumes', async () => {
    const { clock, driver, rooms } = start({
      answer: () => ({ status: 200, next: speech() }),
    });
    await clock.advance(0);
    rooms[0]!.resuming();
    const resuming = driver.readSnapshot().link;
    rooms[0]!.resumed();
    assert({
      given: 'the media room reconnecting by itself',
      should: 'show the gap and then the live link',
      actual: [resuming, driver.readSnapshot().link],
      expected: ['reconnecting', 'connected'],
    });
  });

  test('recording starts once, after the faces settle', async () => {
    let settle: () => void = () => undefined;
    const fonts = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const { clock, said } = start({
      answer: () => ({ status: 200, next: speech({ room: null }) }),
      fonts: () => fonts,
    });
    await clock.advance(3000);
    const waiting = [...said];
    settle();
    await clock.advance(3000);
    assert({
      given: 'three drawn reads before the faces load',
      should: 'say START_RECORDING once they have, and only once',
      actual: { waiting, said },
      expected: { waiting: [], said: ['START_RECORDING'] },
    });
  });

  test('an end while the faces load never starts recording', async () => {
    let settle: () => void = () => undefined;
    const fonts = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const { clock, said, media } = start({
      answer: (attempt) =>
        attempt === 1
          ? { status: 200, next: speech() }
          : { status: 410, next: null },
      fonts: () => fonts,
    });
    await clock.advance(1000);
    settle();
    await clock.advance(5000);
    assert({
      given: 'a 410 on the second read, before the faces loaded',
      should: 'say only END_RECORDING and let the room go',
      actual: { said, media },
      expected: {
        said: ['END_RECORDING'],
        media: ['connect 1', 'disconnect 1'],
      },
    });
  });

  test('dispose stops reading and lets the room go', async () => {
    let reads = 0;
    const { clock, driver, media, said } = start({
      answer: () => {
        reads += 1;
        return { status: 200, next: speech() };
      },
    });
    await clock.advance(0);
    driver.dispose();
    const at = reads;
    await clock.advance(10_000);
    assert({
      given: 'the stage page unmounting',
      should: 'read no more and disconnect',
      actual: { reads: reads - at, media, said },
      expected: {
        reads: 0,
        media: ['connect 1', 'disconnect 1'],
        said: ['START_RECORDING'],
      },
    });
  });
});
