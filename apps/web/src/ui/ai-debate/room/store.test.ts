import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AiDebateRequestError } from './api';
import type { AudioEngine } from './audio';
import {
  T0,
  fakeApi,
  fakeEngine,
  handClock,
  handTimers,
  settle,
} from './room.test-support';
import { createRoomStore } from './store';

setupRitewayBun();

describe('the room store', () => {
  test('a debate that cannot be found says so and stops asking', async () => {
    const log: string[] = [];
    const time = handClock();
    const timers = handTimers();
    let asked = 0;
    const store = createRoomStore({
      id: 'missing',
      clock: time.clock,
      every: timers.every,
      openEngine: async () => fakeEngine(log),
      api: fakeApi({
        log,
        at: time.at,
        overrides: {
          view: async () => {
            asked += 1;
            throw new AiDebateRequestError(404, 'VIEW');
          },
        },
      }),
    });
    store.start();
    await settle();
    timers.fire();
    await settle();
    assert({
      given: 'a debate id the server does not know',
      should: 'show it as missing and stop polling',
      actual: { missing: store.getSnapshot().missing, asked },
      expected: { missing: true, asked: 1 },
    });
  });

  test('leaving while the microphone prompt is open turns it off', async () => {
    const log: string[] = [];
    const time = handClock();
    const timers = handTimers();
    let grant: (engine: AudioEngine) => void = () => undefined;
    const store = createRoomStore({
      id: 'd1',
      clock: time.clock,
      every: timers.every,
      openEngine: () => new Promise((resolve) => (grant = resolve)),
      api: fakeApi({ log, at: time.at }),
    });
    const stop = store.start();
    await settle();
    const joining = store.join(true);
    stop();
    grant(fakeEngine(log));
    await joining;
    assert({
      given: 'a person who leaves before allowing the microphone',
      should: 'close the microphone once it opens, and start nothing',
      actual: {
        closed: log.includes('close'),
        started: log.includes('command:start'),
        joined: store.getSnapshot().joined,
      },
      expected: { closed: true, started: false, joined: false },
    });
  });

  test('ending my speech sends its last words before the turn ends', async () => {
    const log: string[] = [];
    const time = handClock(T0 + 20_000); // 10 s into the AC
    const timers = handTimers();
    const store = createRoomStore({
      id: 'd1',
      clock: time.clock,
      every: timers.every,
      openEngine: async () => fakeEngine(log),
      api: fakeApi({
        log,
        at: time.at,
      }),
    });
    store.start();
    await settle();
    await store.join(false);
    timers.fire(); // the tick starts the person's speech
    await settle();
    await store.finishTurn(0);
    assert({
      given: 'the person ending their AC early',
      should: 'stop recording and transcribe it, and only then yield the turn',
      actual: log.filter((entry) =>
        ['stop', 'transcribe', 'command:yield'].includes(entry),
      ),
      expected: ['stop', 'transcribe', 'command:yield'],
    });
  });
});
