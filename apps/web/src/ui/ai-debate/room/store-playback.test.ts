import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AiDebateApi } from './api';
import {
  fakeEngine,
  holdBallot,
  roomFixture,
  settle,
  T0,
} from './room.test-support';
import { createRoomStore } from './store';

setupRitewayBun();

for (const saved of [true, false]) {
  test(`final AI playback correction ${saved ? 'precedes judging' : 'failure blocks judging'}`, async () => {
    const { log, time, timers, base, view } = await roomFixture();
    const total = view.rules.segments.reduce(
      (ms, segment) => ms + segment.durationMs + view.rules.countdownMs,
      0,
    );
    const engine = fakeEngine(log);
    const heard: Parameters<AiDebateApi['heard']>[0][] = [];
    let release: () => void = () => undefined;
    const correction = new Promise<void>((resolve) => (release = resolve));
    const store = createRoomStore({
      id: 'd1',
      clock: time.clock,
      every: timers.every,
      openEngine: async () => engine,
      api: {
        ...base,
        view: async () => ({
          ...view,
          personSide: 'negative',
          startedAt: T0 - total + 1_000,
          serverNow: time.at(),
        }),
        speech: async (_id, index, onEvent) => {
          log.push(`speech:${index}`);
          onEvent({ type: 'utterance', id: 'final-ai' });
          onEvent({
            type: 'phrase',
            index: 0,
            text: 'Heard words. Unheard words.',
          });
          onEvent({ type: 'done' });
        },
        heard: async (input) => {
          heard.push(input);
          log.push('heard-start');
          await correction;
          if (!saved) throw new Error('cutoff write failed');
          log.push('heard-saved');
        },
        ballot: holdBallot(log),
      },
    });
    const stop = store.start();
    await settle();
    await store.join(false);
    timers.fire();
    await engine.advance(50);
    time.advance(1_001);
    timers.fire();
    await settle();
    timers.fire();
    await settle();
    const order = () =>
      log.filter((entry) => /^(speech:|heard-|ballot)/.test(entry));
    assert({
      given:
        'a negative person and an AI final 2AR expiring halfway through a phrase',
      should:
        'stop playback and await its heard correction before requesting any ballot',
      actual: {
        order: order(),
        heard,
        stopped: engine.clips.map((clip) => clip.stopped),
      },
      expected: {
        order: ['speech:6', 'heard-start'],
        heard: [
          {
            id: 'd1',
            utteranceId: 'final-ai',
            phraseIndex: 0,
            playedMs: 50,
            totalMs: 100,
          },
        ],
        stopped: [true],
      },
    });
    release();
    await settle();
    timers.fire();
    await settle();
    assert({
      given: saved
        ? 'the cutoff write has persisted'
        : 'the cutoff write rejected',
      should: saved
        ? 'request one ballot after the correction'
        : 'surface the failure and keep judging blocked',
      actual: { order: order(), problem: store.getSnapshot().problem },
      expected: {
        order: saved
          ? ['speech:6', 'heard-start', 'heard-saved', 'ballot']
          : ['speech:6', 'heard-start'],
        problem: saved
          ? ''
          : 'Your opponent’s playback could not be saved. Reload to try again.',
      },
    });
    stop();
  });
}
