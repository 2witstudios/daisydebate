import { createAppError } from '@daisy/errors';
import { refuseCapacity } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPhraseSource } from './phrase-source';
import { answered, harness, job } from './speaker.test-support';

setupRitewayBun();

/** A speech whose answer the test produces phrase by phrase. */
function streaming(options: Parameters<typeof harness>[1] = {}) {
  const producer = createPhraseSource();
  let bought = 0;
  let closed = 0;
  const speech = harness('speech', {
    ...options,
    generate: async () => {
      bought++;
      // As the real answer does: it opens once its first phrase exists.
      await producer.source.at(0);
      return {
        value: { phrases: producer.source },
        settle: async () => undefined,
        close: async () => {
          closed++;
        },
      };
    },
  });
  return { ...speech, producer, bought: () => bought, closed: () => closed };
}

test('a speech starts with its first phrase, before its answer is finished', async () => {
  const { speaker, producer, log, release, settle, closed } = streaming();
  speaker.wake();
  await settle();
  producer.push(['One.']);
  await settle();
  assert({
    given: 'an answer that has produced only its first phrase',
    should: 'voice and play it, and voice nothing that does not exist yet',
    actual: log,
    expected: ['deadline', 'tts:One.', 'publish:One.'],
  });
  producer.push(['Two.']);
  await settle();
  assert({
    given: 'the second phrase arriving while the first plays',
    should: 'voice it ahead at once',
    actual: log.at(-1),
    expected: 'tts:Two.',
  });
  await release();
  assert({
    given: 'the first phrase played and the answer still unfinished',
    should: 'play the second and wait for more, recording no usage yet',
    actual: [log.at(-1), closed()],
    expected: ['publish:Two.', 0],
  });
  await release();
  producer.push(['Three.']);
  producer.end();
  await settle();
  await release();
  speaker.wake();
  await settle();
  assert({
    given: 'the answer ending after its third phrase',
    should: 'say every phrase once, record its usage once and be over',
    actual: [log.filter((line) => line.startsWith('publish:')), closed()],
    expected: [['publish:One.', 'publish:Two.', 'publish:Three.'], 1],
  });
  await speaker.stop();
});

test('an answer cut short is spoken to its last whole phrase and never bought again', async () => {
  const { speaker, producer, log, release, settle, bought, stages } =
    streaming();
  speaker.wake();
  producer.push(['One.', 'Two.']);
  await settle();
  producer.cut(createAppError('INFRASTRUCTURE', 'stream ended early'));
  await release();
  await release();
  for (let pulse = 0; pulse < 3; pulse++) {
    speaker.wake();
    await settle();
  }
  assert({
    given: 'a stream that broke after two phrases, then three more pulses',
    should:
      'say both whole phrases, report the failure once and buy no second answer',
    actual: [
      log.filter((line) => line.startsWith('publish:')),
      stages(),
      bought(),
    ],
    expected: [['publish:One.', 'publish:Two.'], ['generate'], 1],
  });
  await speaker.stop();
});

test('an answer that fails before any phrase spends an attempt and may be bought again', async () => {
  let bought = 0;
  const { speaker, log, release, settle, stages } = harness('speech', {
    generate: async () => {
      if (++bought === 1) throw createAppError('INFRASTRUCTURE', 'unreachable');
      return answered({ text: 'One.', phrases: ['One.'] });
    },
  });
  speaker.wake();
  await settle();
  speaker.wake();
  await release();
  assert({
    given: 'a provider failure before the first phrase, then a pulse',
    should: 'report it, buy once more and speak',
    actual: [bought, stages(), log.at(-1)],
    expected: [2, ['generate'], 'publish:One.'],
  });
  await speaker.stop();
});

test('a short opening does not wait for a phrase that does not exist yet', async () => {
  const { speaker, producer, log, settle } = streaming({
    // 240 samples at 24 kHz: a 10 ms opening, far under the hold.
    synthesize: async (phraseId, text) => answered(job(phraseId, text, 240)),
  });
  speaker.wake();
  producer.push(['Hi.']);
  await settle();
  assert({
    given: 'a very short first phrase and no second phrase produced yet',
    should: 'play it at once',
    actual: log.at(-1),
    expected: 'publish:Hi.',
  });
  await speaker.stop();
});

test('after a refusal the speaker wakes itself, and starts nothing until then', async () => {
  let refusals = 2;
  const pending: { run: () => void; ms: number }[] = [];
  let bought = 0;
  const { createBotSpeaker } = await import('./speaker');
  const { generated, scope } = await import('./speaker.test-support');
  const speaker = createBotSpeaker({
    claim: {
      scope,
      token: 'memory-only',
      segmentType: 'speech',
      opensExchange: false,
    },
    generate: async () => {
      bought++;
      if (refusals-- > 0) throw refuseCapacity();
      return generated(answered({ phrases: ['One.'] }));
    },
    heard: async () => undefined,
    timer: {
      setTimeout: (run, ms) => pending.push({ run, ms }),
      clearTimeout: () => undefined,
    },
    synthesize: async (_scope, _token, phraseId, text) =>
      answered(job(phraseId, text)),
    deadline: async () => 1e12,
    lineClosed: () => false,
    tailCut: () => false,
    writeAhead: () => undefined,
    discard: () => undefined,
    audible: () => false,
    silence: () => undefined,
    publish: async () => ({ complete: true, segmentEnded: false }),
    nextId: () => 'phrase',
    maxAttempts: 2,
    busy: (error) => error instanceof Error && error.message === 'budget full',
    failed: () => undefined,
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  speaker.wake();
  await settle();
  speaker.wake();
  speaker.wake();
  await settle();
  assert({
    given: 'a refused admission, then two pulses during the pause',
    should: 'ask for one wake in 200 ms and start nothing meanwhile',
    actual: [bought, pending.map((timer) => timer.ms)],
    expected: [1, [200]],
  });
  pending.shift()!.run();
  await settle();
  assert({
    given: 'the wake finding the refusal repeated',
    should: 'try again and wait twice as long',
    actual: [bought, pending.map((timer) => timer.ms)],
    expected: [2, [400]],
  });
  pending.shift()!.run();
  await settle();
  assert({
    given: 'the next wake admitted',
    should: 'speak with no attempt spent and ask for no further wake',
    actual: [bought, pending.length],
    expected: [3, 0],
  });
  await speaker.stop();
});
