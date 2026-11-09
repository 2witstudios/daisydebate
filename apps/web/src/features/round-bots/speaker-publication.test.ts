import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { publicationStopError } from '@daisy/media/audio';
import { answered, harness, job } from './speaker.test-support';
setupRitewayBun();

test('a phrase cut by a failed native handoff is a recorded failure, said again whole', async () => {
  const offered: string[] = [];
  let failed = false;
  const run = harness('speech', {
    synthesize: async (phraseId, text) => answered(job(phraseId, text, 960)),
    publish: async (sent) => {
      offered.push(`${sent.text}:${sent.pcm.length}`);
      if (!failed) {
        failed = true;
        throw publicationStopError('handoff', 'Native audio handoff failed');
      }
      return { complete: true, segmentEnded: false, line: Promise.resolve() };
    },
  });
  for (let i = 0; i < 3; i++) {
    run.speaker.wake();
    await run.settle();
  }
  await run.speaker.stop();
  assert({
    given: 'a first phrase whose native handoff fails mid-play',
    should:
      'record one publish failure and replay that phrase whole on the next wake, then the rest',
    actual: { offered, stages: run.stages() },
    expected: {
      offered: ['One.:960', 'One.:960', 'Two.:960'],
      stages: ['publish'],
    },
  });
});

test('a speech that reaches its segment end stops quietly at its last whole phrase', async () => {
  const offered: string[] = [];
  const run = harness('speech', {
    publish: async (sent) => {
      offered.push(sent.text);
      return { complete: false, segmentEnded: true, line: Promise.resolve() };
    },
  });
  for (let i = 0; i < 3; i++) {
    run.speaker.wake();
    await run.settle();
  }
  await run.speaker.stop();
  assert({
    given: 'a first phrase that would not fit before the segment end',
    should: 'end the speech with no failure and start nothing more',
    actual: { offered, stages: run.stages() },
    expected: { offered: ['One.'], stages: [] },
  });
});

test('the next phrase is voiced while the current one plays (ADR 0122)', async () => {
  const run = harness('speech', {
    generate: async () =>
      answered({
        text: 'One. Two. Three.',
        phrases: ['One.', 'Two.', 'Three.'],
      }),
  });
  run.speaker.wake();
  await run.settle();
  const whilePlayingFirst = [...run.log];
  await run.release();
  const whilePlayingSecond = [...run.log];
  await run.release();
  await run.release();
  await run.speaker.stop();
  assert({
    given: 'a three-phrase speech whose first phrase is still playing',
    should:
      'read the deadline once, voice phrase two during phrase one, and voice each phrase exactly once',
    actual: { whilePlayingFirst, whilePlayingSecond, all: run.log },
    expected: {
      whilePlayingFirst: ['deadline', 'tts:One.', 'tts:Two.', 'publish:One.'],
      whilePlayingSecond: [
        'deadline',
        'tts:One.',
        'tts:Two.',
        'publish:One.',
        'tts:Three.',
        'publish:Two.',
      ],
      all: [
        'deadline',
        'tts:One.',
        'tts:Two.',
        'publish:One.',
        'tts:Three.',
        'publish:Two.',
        'publish:Three.',
      ],
    },
  });
});

test('every phrase plays against the one speech deadline', async () => {
  const stops: number[] = [];
  const run = harness('speech', {
    deadline: async () => 4321,
    publish: async (_sent, _signal, stopAtMs) => {
      stops.push(stopAtMs);
      return { complete: true, segmentEnded: false, line: Promise.resolve() };
    },
  });
  run.speaker.wake();
  await run.settle();
  await run.speaker.stop();
  assert({
    given: 'a two-phrase speech with a calibrated deadline',
    should: 'hand both phrases the same hard stop',
    actual: stops,
    expected: [4321, 4321],
  });
});

test('a prefetched answer whose settlement failed is settled again, never bought again', async () => {
  let settles = 0;
  const run = harness('speech', {
    synthesize: async (phraseId, text) => ({
      value: job(phraseId, text),
      settle: async () => {
        settles += 1;
        if (text === 'Two.' && settles === 2)
          throw publicationStopError('handoff', 'settlement refused once');
      },
    }),
    publish: async () => ({
      complete: true,
      segmentEnded: false,
      line: Promise.resolve(),
    }),
  });
  for (let i = 0; i < 3; i++) {
    run.speaker.wake();
    await run.settle();
  }
  await run.speaker.stop();
  assert({
    given: 'a voiced-ahead second phrase whose first settlement fails',
    should:
      'keep its answer, settle it again in turn with no failure, and buy each phrase once',
    actual: {
      bought: run.log.filter((line) => line.startsWith('tts:')),
      stages: run.stages(),
    },
    expected: { bought: ['tts:One.', 'tts:Two.'], stages: [] },
  });
});

test('the second phrase is voiced while the first is still being voiced', async () => {
  const first = Promise.withResolvers<void>();
  const run = harness('speech', {
    synthesize: async (phraseId, text) => {
      if (text === 'One.') await first.promise;
      return answered(job(phraseId, text));
    },
  });
  run.speaker.wake();
  await run.settle();
  const beforeFirstVoiced = [...run.log];
  first.resolve();
  await run.release();
  await run.release();
  await run.speaker.stop();
  assert({
    given: 'a first phrase whose voice is still on its way',
    should:
      'already be voicing the second, so a short first phrase never leaves a gap',
    actual: beforeFirstVoiced,
    expected: ['generate', 'deadline', 'tts:One.', 'tts:Two.'],
  });
});

test('a voiced-ahead phrase that failed is voiced again in turn, never deferring the turn', async () => {
  let failedOnce = false;
  const run = harness('speech', {
    synthesize: async (phraseId, text) => {
      if (text === 'Two.' && !failedOnce) {
        failedOnce = true;
        throw new Error('provider hiccup');
      }
      return answered(job(phraseId, text));
    },
    publish: async () => ({
      complete: true,
      segmentEnded: false,
      line: Promise.resolve(),
    }),
  });
  run.speaker.wake();
  await run.settle();
  await run.speaker.stop();
  assert({
    given: 'a second phrase whose voice-ahead failed with nothing bought',
    should:
      'voice it again when its turn comes and speak the whole speech in one turn, with no failure',
    actual: {
      bought: run.log.filter((line) => line.startsWith('tts:')),
      stages: run.stages(),
    },
    expected: { bought: ['tts:One.', 'tts:Two.', 'tts:Two.'], stages: [] },
  });
});

test('a final phrase whose line is never written is said again, under its line id, before the speech is done', async () => {
  const offered: string[] = [];
  let lines = 0;
  const run = harness('speech', {
    publish: async (sent) => {
      offered.push(`${sent.text}:${sent.phraseId}`);
      lines += 1;
      // The final phrase's first start fails for good after hand-over.
      const line =
        sent.text === 'Two.' && lines === 2
          ? Promise.reject(
              createAppError('INFRASTRUCTURE', 'statement timeout'),
            )
          : Promise.resolve();
      line.catch(() => undefined);
      return { complete: true, segmentEnded: false, line };
    },
  });
  for (let i = 0; i < 3; i++) {
    run.speaker.wake();
    await run.settle();
  }
  await run.speaker.stop();
  const [, second, third] = offered.map((entry) => entry.split(':'));
  assert({
    given: 'a two-phrase speech whose final line fails to be written once',
    should:
      'record one failure, say the final phrase again under the same line id, and buy nothing twice',
    actual: {
      offered: offered.map((entry) => entry.split(':')[0]),
      sameLine: second?.[1] === third?.[1],
      stages: run.stages(),
      bought: run.log.filter((entry) => entry.startsWith('tts:')),
    },
    expected: {
      offered: ['One.', 'Two.', 'Two.'],
      sameLine: true,
      stages: ['publish'],
      bought: ['tts:One.', 'tts:Two.'],
    },
  });
});

test('a refused line puts the speech back on its phrase without spending an attempt', async () => {
  const offered: string[] = [];
  let refused = false;
  const run = harness('speech', {
    publish: async (sent) => {
      offered.push(sent.text);
      const line =
        sent.text === 'One.' && !refused
          ? ((refused = true),
            Promise.reject(createAppError('CONFLICT', 'floor lost')))
          : Promise.resolve();
      line.catch(() => undefined);
      return { complete: true, segmentEnded: false, line };
    },
  });
  for (let i = 0; i < 3; i++) {
    run.speaker.wake();
    await run.settle();
  }
  await run.speaker.stop();
  assert({
    given: 'a first phrase whose line start is refused after hand-over',
    should:
      'stop before the next phrase, then say the first again on the next wake with no failure recorded',
    actual: { offered, stages: run.stages() },
    expected: { offered: ['One.', 'One.', 'Two.'], stages: [] },
  });
});
