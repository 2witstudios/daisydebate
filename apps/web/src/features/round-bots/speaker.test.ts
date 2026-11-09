import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { refuseFinalSpeech } from '@daisy/db/testing';
import { answered, harness, job } from './speaker.test-support';
setupRitewayBun();
test('a speech claim delivers its generated phrases once without overlapping turns', async () => {
  const { speaker, log, release, settle } = harness('speech');
  speaker.wake();
  speaker.wake();
  await settle();
  assert({
    given: 'an actual speech claim woken twice while publishing',
    should: 'run one turn, voicing the next phrase while the first one plays',
    actual: [...log],
    expected: ['generate', 'deadline', 'tts:One.', 'tts:Two.', 'publish:One.'],
  });
  await release();
  await release();
  speaker.wake();
  await settle();
  assert({
    given: 'a fully delivered speech claim woken again',
    should: 'publish each phrase in order and never regenerate the speech',
    actual: log,
    expected: [
      'generate',
      'deadline',
      'tts:One.',
      'tts:Two.',
      'publish:One.',
      'publish:Two.',
    ],
  });
  await speaker.stop();
});
test('refused speaking authority waits without consuming delivery attempts', async () => {
  let calls = 0;
  const { speaker, settle, failures } = harness('speech', {
    generate: async () => {
      calls++;
      throw createAppError('CONFLICT', 'Bot speaking authority changed');
    },
  });
  for (let i = 0; i < 4; i++) {
    speaker.wake();
    await settle();
  }
  assert({
    given: 'a claim woken before its speaking interval opens',
    should: 'retry on each wake and report no worker failure',
    actual: [calls, failures()],
    expected: [4, 0],
  });
  await speaker.stop();
});
test('provider failures stop after the bounded attempt count', async () => {
  let calls = 0;
  const { speaker, settle, stages } = harness('speech', {
    generate: async () => {
      calls++;
      throw createAppError('INFRASTRUCTURE', 'provider');
    },
  });
  for (let i = 0; i < 4; i++) {
    speaker.wake();
    await settle();
  }
  assert({
    given: 'a provider that keeps failing',
    should: 'stop after maxAttempts and report each failure with its stage',
    actual: [calls, stages()],
    expected: [2, ['generate', 'generate']],
  });
  await speaker.stop();
});
test('a cross-examination respondent stays silent until a question ends', async () => {
  const { speaker, log, release, settle } = harness('cross_ex', {
    opensExchange: false,
  });
  speaker.wake();
  await settle();
  assert({
    given: 'a respondent seat when the segment opens',
    should: 'generate nothing and stay silent',
    actual: [log.length, speaker.playing()],
    expected: [0, false],
  });
  speaker.peer('end-of-turn');
  speaker.wake();
  await settle();
  assert({
    given: 'the questioner finishing a question',
    should: 'answer it',
    actual: log.filter((line) => line === 'generate').length,
    expected: 1,
  });
  await release();
  await speaker.stop();
});
test('cross-examination answers each peer turn once and cancels the active phrase on barge-in', async () => {
  const { speaker, log, release, settle } = harness('cross_ex');
  speaker.wake();
  await settle();
  assert({
    given: 'a cross-examination claim',
    should: 'open the exchange once and report playback',
    actual: [log.length, speaker.playing()],
    expected: [5, true],
  });
  speaker.peer('barge-in');
  await settle();
  speaker.wake();
  await settle();
  assert({
    given: 'a peer barge-in during playback',
    should:
      'cancel the active phrase, whose writer clears its own queue, and wait for the peer turn to end',
    actual: [speaker.playing(), log.length],
    expected: [false, 5],
  });
  speaker.peer('end-of-turn');
  speaker.peer('end-of-turn');
  await release();
  await release();
  speaker.wake();
  await settle();
  assert({
    given: 'one ended peer turn reported twice',
    should: 'answer it exactly once',
    actual: log.filter((line) => line === 'generate').length,
    expected: 2,
  });
  speaker.peer('end-of-turn');
  await settle();
  speaker.peer('unknown');
  await speaker.stop();
  assert({
    given: 'unknown activity followed by shutdown',
    should: 'abort the active phrase and leave nothing playing',
    actual: speaker.playing(),
    expected: false,
  });
});

test('a peer speaking over a cross-examination tail still queued silences it at once', async () => {
  let queued = true;
  const { speaker, log, settle } = harness('cross_ex', {
    audible: () => queued,
    publish: async () => ({
      complete: true,
      segmentEnded: false,
    }),
  });
  speaker.wake();
  await settle();
  const playingTail = speaker.playing();
  speaker.peer('speech-start');
  queued = false;
  assert({
    given:
      'an answer whose last phrase returned with its tail still queued, then the peer starts speaking',
    should: 'still read as playing, and drop the queued tail at once',
    actual: [playingTail, log.at(-1), speaker.playing()],
    expected: [true, 'silence', false],
  });
  await speaker.stop();
});

test('the speech ending stops voicing ahead: nothing more is bought', async () => {
  const aborted: string[] = [];
  const { speaker, settle } = harness('speech', {
    generate: async () =>
      answered({
        text: 'One. Two. Three.',
        phrases: ['One.', 'Two.', 'Three.'],
      }),
    synthesize: async (phraseId, text, signal) => {
      if (text === 'One.') return answered(job(phraseId, text));
      // Held until aborted: the speech ends before these are needed.
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => {
          aborted.push(text);
          reject(signal.reason);
        }),
      );
    },
    publish: async () => ({
      complete: false,
      segmentEnded: true,
    }),
  });
  speaker.wake();
  await settle();
  assert({
    given:
      'a first phrase that ends the segment while two more are being voiced',
    should:
      'abort both voicings, so neither is bought, and leave nothing playing',
    actual: { aborted, playing: speaker.playing() },
    expected: { aborted: ['Two.', 'Three.'], playing: false },
  });
  await speaker.stop();
});

for (const ending of ['a final refusal', 'a stop'] as const)
  test(`${ending} stops voicing ahead: nothing more is bought (delta minor 2)`, async () => {
    const aborted: string[] = [];
    const gate = Promise.withResolvers<void>();
    const { speaker, settle } = harness('speech', {
      generate: async () =>
        answered({
          text: 'One. Two. Three.',
          phrases: ['One.', 'Two.', 'Three.'],
        }),
      synthesize: async (phraseId, text, signal) => {
        if (text === 'One.') return answered(job(phraseId, text));
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () => {
            aborted.push(text);
            reject(signal.reason);
          }),
        );
      },
      publish: async (_job, signal) => {
        if (ending === 'a final refusal')
          throw refuseFinalSpeech('Bot phrase would end past its segment');
        signal.addEventListener('abort', () => gate.resolve());
        await gate.promise;
        return { complete: false, segmentEnded: false };
      },
    });
    speaker.wake();
    await settle();
    if (ending === 'a stop') await speaker.stop();
    assert({
      given: `a speech ended by ${ending} while two phrases are voicing ahead`,
      should: 'abort both voicings',
      actual: aborted.sort(),
      expected: ['Three.', 'Two.'],
    });
    gate.resolve();
    await speaker.stop();
  });
