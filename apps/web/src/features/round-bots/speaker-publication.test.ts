import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { publicationStopError } from '@daisy/media/audio';
import { refuseCapacity } from '@daisy/db/testing';
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
      return { complete: true, segmentEnded: false };
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
      return { complete: false, segmentEnded: true };
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

test('the next two phrases are voiced while the current one plays (ADR 0122)', async () => {
  const run = harness('speech', {
    generate: async () =>
      answered({
        text: 'One. Two. Three. Four.',
        phrases: ['One.', 'Two.', 'Three.', 'Four.'],
      }),
  });
  run.speaker.wake();
  await run.settle();
  const whilePlayingFirst = [...run.log];
  await run.release();
  const whilePlayingSecond = [...run.log];
  await run.release();
  await run.release();
  await run.release();
  await run.speaker.stop();
  assert({
    given: 'a four-phrase speech whose first phrase is still playing',
    should:
      'read the deadline once, keep two phrases voiced ahead, and voice each phrase exactly once',
    actual: {
      whilePlayingFirst,
      whilePlayingSecond: whilePlayingSecond.slice(whilePlayingFirst.length),
      bought: run.log.filter((entry) => entry.startsWith('tts:')),
    },
    expected: {
      whilePlayingFirst: [
        'deadline',
        'tts:One.',
        'tts:Two.',
        'tts:Three.',
        'publish:One.',
      ],
      whilePlayingSecond: ['tts:Four.', 'publish:Two.'],
      bought: ['tts:One.', 'tts:Two.', 'tts:Three.', 'tts:Four.'],
    },
  });
});

test('every phrase plays against the one speech deadline', async () => {
  const stops: number[] = [];
  const run = harness('speech', {
    deadline: async () => 4321,
    publish: async (_sent, _signal, stopAtMs) => {
      stops.push(stopAtMs);
      return { complete: true, segmentEnded: false };
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

test('a final phrase whose start fails for good is said again under its line id, bought once', async () => {
  const offered: string[] = [];
  let failed = false;
  const run = harness('speech', {
    publish: async (sent) => {
      offered.push(`${sent.text}:${sent.phraseId}`);
      // Its line could not be written, so none of its audio played.
      if (sent.text === 'Two.' && !failed) {
        failed = true;
        throw createAppError('INFRASTRUCTURE', 'statement timeout');
      }
      return { complete: true, segmentEnded: false };
    },
  });
  for (let i = 0; i < 3; i++) {
    run.speaker.wake();
    await run.settle();
  }
  await run.speaker.stop();
  const [, second, third] = offered.map((entry) => entry.split(':'));
  assert({
    given:
      'a two-phrase speech whose final phrase start fails after its retries',
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

test('a refused phrase start keeps the speech on it, and buys nothing again (delta minor 1)', async () => {
  const offered: string[] = [];
  let refused = false;
  const run = harness('speech', {
    generate: async () =>
      answered({
        text: 'One. Two. Three.',
        phrases: ['One.', 'Two.', 'Three.'],
      }),
    publish: async (sent) => {
      offered.push(sent.text);
      if (sent.text === 'One.' && !refused) {
        refused = true;
        throw createAppError('CONFLICT', 'floor lost');
      }
      return { complete: true, segmentEnded: false };
    },
  });
  for (let i = 0; i < 3; i++) {
    run.speaker.wake();
    await run.settle();
  }
  await run.speaker.stop();
  assert({
    given: 'a three-phrase speech whose first phrase start is refused once',
    should:
      'say the first again on the next wake with no failure recorded, and buy each phrase once',
    actual: {
      offered,
      stages: run.stages(),
      bought: run.log.filter((entry) => entry.startsWith('tts:')),
    },
    expected: {
      offered: ['One.', 'One.', 'Two.', 'Three.'],
      stages: [],
      bought: ['tts:One.', 'tts:Two.', 'tts:Three.'],
    },
  });
});

test('the next phrase’s line is written while the current phrase plays', async () => {
  const run = harness('speech');
  run.speaker.wake();
  await run.settle();
  const whilePlayingFirst = [...run.prepared];
  await run.release();
  await run.release();
  await run.speaker.stop();
  assert({
    given:
      'a two-phrase speech whose first phrase is playing, the second voiced',
    should:
      'write the second phrase’s line ahead, under the id it is then spoken with',
    actual: whilePlayingFirst.map((entry) => entry.split(':')[0]),
    expected: ['Two.'],
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

test('a voice-ahead refused a pool slot is asked again at the next phrase, not at its own turn', async () => {
  let refusedThree = false;
  const run = harness('speech', {
    generate: async () =>
      answered({
        text: 'One. Two. Three. Four.',
        phrases: ['One.', 'Two.', 'Three.', 'Four.'],
      }),
    synthesize: async (phraseId, text) => {
      if (text === 'Three.' && !refusedThree) {
        refusedThree = true;
        throw refuseCapacity();
      }
      return answered(job(phraseId, text));
    },
  });
  run.speaker.wake();
  await run.settle();
  await run.release();
  const whilePlayingSecond = [...run.log];
  await run.release();
  await run.release();
  await run.release();
  await run.speaker.stop();
  assert({
    given:
      'a third phrase whose voice-ahead is refused a pool slot while the first plays',
    should:
      'voice it again as the second starts, so it is ready before its turn, with no failure',
    actual: {
      askedAgainEarly: whilePlayingSecond.filter(
        (entry) => entry === 'tts:Three.',
      ).length,
      stages: run.stages(),
    },
    expected: { askedAgainEarly: 2, stages: [] },
  });
});

test('a short opening phrase waits for the second to be voiced, so the speech never stalls after it', async () => {
  const second = Promise.withResolvers<void>();
  const run = harness('speech', {
    synthesize: async (phraseId, text) => {
      if (text === 'Two.') await second.promise;
      // One. is 0.1 s, far shorter than voicing the next phrase can take.
      return answered(job(phraseId, text));
    },
  });
  run.speaker.wake();
  await run.settle();
  const beforeSecondVoiced = run.log.filter((entry) =>
    entry.startsWith('publish:'),
  );
  second.resolve();
  await run.settle();
  const afterSecondVoiced = run.log.filter((entry) =>
    entry.startsWith('publish:'),
  );
  await run.release();
  await run.release();
  await run.speaker.stop();
  assert({
    given: 'a 0.1 s first phrase whose second phrase is still being voiced',
    should: 'play nothing until the second is voiced, then play the first',
    actual: { beforeSecondVoiced, afterSecondVoiced },
    expected: { beforeSecondVoiced: [], afterSecondVoiced: ['publish:One.'] },
  });
});

test('a phrase authorized ahead under an id already closed is authorized under a new one', async () => {
  const closed = new Set<string>();
  let failed = false;
  let spokenTwo = 0;
  const run = harness('speech', {
    generate: async () =>
      answered({ text: 'One. Two.', phrases: ['One.', 'Two.'] }),
    lineClosed: (id) => closed.has(id),
    publish: async (sent, signal) => {
      // Two. was authorized ahead as One. began; One.'s handoff then fails,
      // and its id is closed meanwhile.
      if (sent.text === 'One.' && !failed) {
        await Promise.resolve();
        failed = true;
        for (const entry of run.prepared) closed.add(entry.split(':')[1]!);
        throw publicationStopError('handoff', 'Native audio handoff failed');
      }
      void signal;
      if (sent.text === 'Two.') spokenTwo += 1;
      return { complete: true, segmentEnded: false };
    },
  });
  for (let i = 0; i < 3; i++) {
    run.speaker.wake();
    await run.settle();
  }
  await run.speaker.stop();
  const twos = run.prepared.filter((entry) => entry.startsWith('Two.:'));
  assert({
    given:
      'a next phrase authorized ahead, its id closed when the phrase before it failed, the speech then said again',
    should:
      'authorize it ahead again under a new id, never the closed one, and speak it once',
    actual: {
      authorizedAhead: twos.length,
      distinctIds: new Set(twos.map((entry) => entry.split(':')[1])).size,
      spokenTwo,
    },
    expected: { authorizedAhead: 2, distinctIds: 2, spokenTwo: 1 },
  });
});

test('a voice-ahead refused a pool slot is asked again as soon as another voice is bought', async () => {
  let refusedThree = false;
  const first = Promise.withResolvers<void>();
  const run = harness('speech', {
    generate: async () =>
      answered({
        text: 'One. Two. Three. Four.',
        phrases: ['One.', 'Two.', 'Three.', 'Four.'],
      }),
    synthesize: async (phraseId, text) => {
      if (text === 'Three.' && !refusedThree) {
        refusedThree = true;
        throw refuseCapacity();
      }
      // The first phrase's voice is slow: its slot frees only once bought.
      if (text === 'One.') await first.promise;
      return answered(job(phraseId, text, 24000 * 5));
    },
  });
  run.speaker.wake();
  await run.settle();
  const beforeAnyPlayed = run.log.filter(
    (entry) => entry === 'tts:Three.',
  ).length;
  first.resolve();
  await run.settle();
  const threeAskedAgain = run.log.filter(
    (entry) => entry === 'tts:Three.',
  ).length;
  await run.speaker.stop();
  assert({
    given:
      'a third phrase refused a pool slot while the first two are voiced, before anything plays',
    should:
      'ask for it again the moment another voice is bought, not a phrase later',
    actual: { beforeAnyPlayed, threeAskedAgain },
    expected: { beforeAnyPlayed: 1, threeAskedAgain: 2 },
  });
});

test('two short opening phrases wait for the third to be voiced, so the speech never stalls after them', async () => {
  const third = Promise.withResolvers<void>();
  const run = harness('speech', {
    generate: async () =>
      answered({
        text: 'One. Two. Three.',
        phrases: ['One.', 'Two.', 'Three.'],
      }),
    synthesize: async (phraseId, text) => {
      if (text === 'Three.') await third.promise;
      // One. and Two. are 0.1 s each, far shorter than voicing Three. can take.
      return answered(job(phraseId, text));
    },
  });
  run.speaker.wake();
  await run.settle();
  const beforeThirdVoiced = run.log.filter((entry) =>
    entry.startsWith('publish:'),
  );
  third.resolve();
  await run.settle();
  const afterThirdVoiced = run.log.filter((entry) =>
    entry.startsWith('publish:'),
  );
  for (let i = 0; i < 3; i++) await run.release();
  await run.speaker.stop();
  assert({
    given: 'two 0.1 s opening phrases whose third phrase is still being voiced',
    should: 'play nothing until the third is voiced, then play the first',
    actual: { beforeThirdVoiced, afterThirdVoiced },
    expected: { beforeThirdVoiced: [], afterThirdVoiced: ['publish:One.'] },
  });
});
