import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { AiDebateApi } from './api';
import { playLine } from './play-line';
import {
  fakeApi,
  fakeEngine,
  handClock,
  turnContext,
  until,
  type FakeEngine,
} from './room.test-support';

setupRitewayBun();

type Heard = Parameters<AiDebateApi['heard']>[0];

/** A line playing through a hand-moved engine, with everything it reports. */
const playing = ({
  phrases = ['One.', 'Two.', 'Three.'],
  speak,
  decoding,
}: {
  readonly phrases?: readonly string[];
  readonly speak?: AiDebateApi['speak'];
  readonly decoding?: () => Promise<void>;
} = {}) => {
  const log: string[] = [];
  const starts: number[] = [];
  const captions: string[] = [];
  const speaking: boolean[] = [];
  const heard: Heard[] = [];
  const engine: FakeEngine = fakeEngine(log, {
    onPlay: (at) => starts.push(at),
    ...(decoding ? { decoding } : {}),
  });
  let cut: () => void = () => undefined;
  const stopWhen = new Promise<void>((resolve) => (cut = resolve));
  const outcome = playLine({
    context: turnContext({
      api: fakeApi({
        log,
        at: handClock().at,
        overrides: {
          heard: async (input) => {
            heard.push(input);
          },
          ...(speak ? { speak } : {}),
        },
      }),
      engine,
      onCaption: (text) => captions.push(text),
      onSpeaking: (on) => speaking.push(on),
    }),
    utteranceId: () => 'line-1',
    phraseAt: async (index) => phrases[index] ?? null,
    stopWhen,
  });
  return { engine, starts, captions, speaking, heard, cut, outcome };
};

const report = (phraseIndex: number, playedMs: number, totalMs: number) => ({
  id: 'd1',
  utteranceId: 'line-1',
  phraseIndex,
  playedMs,
  totalMs,
});

describe('playLine', () => {
  test('schedules each phrase a short breath after the one before', async () => {
    const line = playing();
    assert({
      given: 'three 100 ms phrases',
      should: 'start each 80 ms after the last one ends, and finish',
      actual: [await until(line.engine, line.outcome), line.starts],
      expected: ['finished', [0, 180, 360]],
    });
  });

  test('steps the caption through a phrase’s sentences as they are spoken', async () => {
    const line = playing({ phrases: ['One. Two two two.'] });
    await line.engine.advance(20);
    const early = [...line.captions];
    await line.engine.advance(20);
    assert({
      given: 'a two-sentence phrase whose second sentence starts 29 ms in',
      should:
        'show the first sentence, then the second when the voice reaches it',
      actual: [early, line.captions],
      expected: [['One.'], ['One.', 'Two two two.']],
    });
  });
});

describe('playLine, cut off', () => {
  test('mid-phrase with another queued: stops both and reports what was heard', async () => {
    const line = playing();
    await line.engine.advance(50);
    line.cut();
    const outcome = await until(line.engine, line.outcome);
    await line.engine.advance(500);
    assert({
      given: 'a cut 50 ms into the first phrase, with the second queued',
      should:
        'stop both clips, report phrase 0 at 50 of 100 ms, and show nothing more',
      actual: {
        outcome,
        stopped: line.engine.clips.map((clip) => clip.stopped),
        heard: line.heard,
        captions: line.captions,
        speaking: line.speaking.at(-1),
      },
      expected: {
        outcome: 'stopped',
        stopped: [true, true],
        heard: [report(0, 50, 100)],
        captions: ['One.'],
        speaking: false,
      },
    });
  });

  test('in the breath between phrases: nothing of the next was heard', async () => {
    const line = playing();
    await line.engine.advance(140);
    line.cut();
    await until(line.engine, line.outcome);
    assert({
      given: 'a cut after the first phrase ended and before the second began',
      should: 'report the second phrase at 0 ms, keeping only the first',
      actual: line.heard,
      expected: [report(1, 0, 100)],
    });
  });

  test('before the first voice arrives: nothing was heard at all', async () => {
    const line = playing({ speak: () => new Promise(() => undefined) });
    await line.engine.advance(30);
    line.cut();
    const outcome = await until(line.engine, line.outcome);
    assert({
      given: 'a cut while the first phrase’s voice is still loading',
      should: 'report phrase 0 as unheard, so its words leave the transcript',
      actual: [outcome, line.heard],
      expected: ['stopped', [report(0, 0, 1)]],
    });
  });

  test('while a clip is decoding: that clip never plays', async () => {
    let decoded: () => void = () => undefined;
    const line = playing({
      decoding: () => new Promise<void>((resolve) => (decoded = resolve)),
    });
    await line.engine.advance(10);
    line.cut();
    await line.engine.advance(10);
    decoded();
    await until(line.engine, line.outcome);
    await line.engine.advance(300);
    assert({
      given: 'a cut that lands while the first clip is being decoded',
      should: 'stop that clip when it is ready, with no caption',
      actual: {
        stopped: line.engine.clips.map((clip) => clip.stopped),
        captions: line.captions,
      },
      expected: { stopped: [true], captions: [] },
    });
  });
});
