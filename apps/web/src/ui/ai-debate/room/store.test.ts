import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AiDebateRequestError } from './api';
import type { AudioEngine } from './audio';
import {
  T0,
  fakeApi,
  fakeEngine,
  handClock,
  handTimers,
  holdBallot,
  roomFixture,
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
    const sent: unknown[] = [];
    const initialView = await fakeApi({ log, at: time.at }).view('d1');
    const store = createRoomStore({
      id: 'd1',
      clock: time.clock,
      every: timers.every,
      openEngine: async () => fakeEngine(log),
      api: fakeApi({
        log,
        at: time.at,
        overrides: {
          view: async () => ({ ...initialView, serverNow: time.at() }),
          command: async (_id, _version, command) => {
            log.push(`command:${command.type}`);
            sent.push(command);
          },
          transcribe: async () => {
            log.push('transcribe');
            time.advance(940_000);
            timers.fire(); // polling refreshes to a later segment during upload
            await settle();
            return { text: 'last words' };
          },
        },
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
    assert({
      given: 'the round advances while the recorder uploads its tail',
      should: 'send the yield with the original AC identity',
      actual: sent,
      expected: [{ type: 'yield', segmentIndex: 0 }],
    });
  });
});

test('a completed forfeit never asks the judge, including after reload', async () => {
  const { log, time, timers, base, view } = await roomFixture();
  const store = createRoomStore({
    id: 'd1',
    clock: time.clock,
    every: timers.every,
    api: {
      ...base,
      view: async () => ({
        ...view,
        status: 'completed',
        outcome: 'negative',
        ballot: null,
      }),
      ballot: async () => {
        log.push('ballot');
        throw new Error('forfeits need no ballot');
      },
    },
  });
  const stop = store.start();
  await settle();
  timers.fire();
  await settle();
  assert({
    given: 'a reloaded round completed by forfeit without a ballot',
    should: 'show a terminal result without requesting judging',
    actual: {
      requested: log.includes('ballot'),
      phase: store.getSnapshot().state.phase,
    },
    expected: { requested: false, phase: 'ended' },
  });
  stop();
});

test('natural final speech expiry flushes recorded words before requesting the ballot', async () => {
  const { log, time, timers, base, view: initialView } = await roomFixture();
  const total = initialView.rules.segments.reduce(
    (ms, segment) => ms + segment.durationMs + initialView.rules.countdownMs,
    0,
  );
  const startedAt = T0 - total + 1_000;
  let uploaded: () => void = () => undefined;
  const upload = new Promise<void>((resolve) => {
    uploaded = resolve;
  });
  const store = createRoomStore({
    id: 'd1',
    clock: time.clock,
    every: timers.every,
    openEngine: async () => fakeEngine(log),
    api: {
      ...base,
      view: async () => ({ ...initialView, startedAt, serverNow: time.at() }),
      transcribe: async () => {
        log.push('tail');
        await upload;
        log.push('tail-saved');
        return { text: 'last words' };
      },
      ballot: holdBallot(log),
    },
  });
  const stop = store.start();
  await settle();
  await store.join(false);
  timers.fire();
  await settle();
  time.advance(1_001);
  timers.fire();
  await settle();
  assert({
    given: 'the naturally expired final speech with its last upload pending',
    should: 'stop the recorder and wait for the tail before judging',
    actual: log.filter((entry) => ['stop', 'tail', 'ballot'].includes(entry)),
    expected: ['stop', 'tail'],
  });
  uploaded();
  await settle();
  assert({
    given: 'the final clip is now persisted',
    should: 'request judging once after the final words',
    actual: log.filter((entry) => ['tail-saved', 'ballot'].includes(entry)),
    expected: ['tail-saved', 'ballot'],
  });
  stop();
});
