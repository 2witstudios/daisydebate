import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  answered,
  budgetFull,
  harness,
  job,
  peerSaid,
} from './speaker.test-support';

setupRitewayBun();

const published = (log: readonly string[]) =>
  log.filter((line) => line.startsWith('publish:'));
/** A one-phrase answer naming what it answers, so a test reads which turn was answered. */
const answering = (log: string[]) => async (to: { kind: string }) => {
  log.push(`generate:${to.kind}`);
  return answered({ phrases: [`To ${to.kind}.`] });
};

test('hearing loss and a peer who speaks while the bot prepares cancel nothing', async () => {
  const gate = Promise.withResolvers<void>();
  const calls: string[] = [];
  const { speaker, log, settle } = harness('cross_ex', {
    generate: async (to) => {
      calls.push(to.kind);
      await gate.promise;
      return answered({ phrases: ['Why?'] });
    },
  });
  speaker.wake();
  await settle();
  speaker.peer(peerSaid('unknown'));
  speaker.wake();
  await settle();
  gate.resolve();
  await settle();
  assert({
    given: 'the opening question being generated when the hearing goes unknown',
    should: 'keep the one answer and ask the question',
    actual: [calls, published(log)],
    expected: [['opening'], ['publish:Why?']],
  });
  await speaker.stop();
});

test('the bot never starts over a peer who is mid-turn, and answers their turn when it ends', async () => {
  const calls: string[] = [];
  const { speaker, log, release, settle } = harness('cross_ex', {
    opensExchange: false,
    generate: answering(calls),
  });
  speaker.peer(peerSaid('end-of-turn'));
  speaker.wake();
  speaker.peer(peerSaid('speech-start'));
  await settle();
  assert({
    given: 'a peer who resumes speaking while the answer is prepared',
    should: 'prepare the answer but play none of it',
    actual: [calls, log.includes('tts:To peer-turn.'), published(log)],
    expected: [['generate:peer-turn'], true, []],
  });
  speaker.peer(peerSaid('end-of-turn'));
  await settle();
  speaker.wake();
  await settle();
  await release();
  assert({
    given: 'that peer’s turn then ending',
    should: 'drop the held answer and answer the newer turn once',
    actual: [calls.length, published(log).length],
    expected: [2, 1],
  });
  await speaker.stop();
});

test('a cross-examination answer is made only after the peer’s words are in the transcript', async () => {
  const order: string[] = [];
  const line = Promise.withResolvers<void>();
  const { speaker, settle } = harness('cross_ex', {
    heard: async (peer, spokeUntilMs) => {
      order.push(`wait:${peer}:${spokeUntilMs > 0}`);
      await line.promise;
    },
    generate: async (to) => {
      order.push(`generate:${to.kind}`);
      return answered({ phrases: ['Because.'] });
    },
    publish: async () => ({ complete: true, segmentEnded: false }),
  });
  speaker.wake();
  await settle();
  assert({
    given: 'the asking seat’s opening question',
    should: 'not wait for any line',
    actual: order,
    expected: ['generate:opening'],
  });
  speaker.peer(peerSaid('end-of-turn'));
  speaker.wake();
  await settle();
  const before = [...order];
  line.resolve();
  await settle();
  assert({
    given:
      'a peer turn ended, before and after its line reaches the transcript',
    should: 'wait for that peer’s line, then generate the follow-up',
    actual: [before.slice(1), order.slice(1)],
    expected: [['wait:peer:true'], ['wait:peer:true', 'generate:peer-turn']],
  });
  await speaker.stop();
});

test('errors in one cross-examination turn never mute a later one', async () => {
  let failing = true;
  const calls: string[] = [];
  const { speaker, log, settle } = harness('cross_ex', {
    opensExchange: false,
    generate: async (to) => {
      calls.push(to.kind);
      if (failing) throw createAppError('INFRASTRUCTURE', 'unreachable');
      return answered({ phrases: ['Because.'] });
    },
    publish: async (job) => {
      log.push(`publish:${job.text}`);
      return { complete: true, segmentEnded: false };
    },
  });
  speaker.peer(peerSaid('end-of-turn'));
  for (let pulse = 0; pulse < 4; pulse++) {
    speaker.wake();
    await settle();
  }
  assert({
    given: 'a peer turn whose answer fails twice',
    should: 'give that turn up after two attempts',
    actual: calls.length,
    expected: 2,
  });
  failing = false;
  speaker.peer(peerSaid('end-of-turn'));
  speaker.wake();
  await settle();
  assert({
    given: 'the next peer turn',
    should: 'be answered',
    actual: published(log),
    expected: ['publish:Because.'],
  });
  await speaker.stop();
});

test('the asking seat presses a question that met silence, once', async () => {
  const calls: string[] = [];
  const { speaker, settle, elapse } = harness('cross_ex', {
    generate: answering(calls),
    publish: async () => ({ complete: true, segmentEnded: false }),
  });
  speaker.wake();
  await settle();
  elapse();
  await settle();
  elapse();
  speaker.wake();
  await settle();
  assert({
    given: 'the asking seat’s question, then two long silences',
    should: 'ask again once, saying it went unanswered, and then only wait',
    actual: calls,
    expected: ['generate:opening', 'generate:unanswered'],
  });
  await speaker.stop();
});

test('a reply, or a seat that does not ask, is never pressed', async () => {
  const asked: string[] = [];
  const asker = harness('cross_ex', {
    generate: answering(asked),
    publish: async () => ({ complete: true, segmentEnded: false }),
  });
  asker.speaker.wake();
  await asker.settle();
  asker.speaker.peer(peerSaid('speech-start'));
  asker.elapse();
  await asker.settle();
  const answeredBy: string[] = [];
  const respondent = harness('cross_ex', {
    opensExchange: false,
    generate: answering(answeredBy),
    publish: async () => ({ complete: true, segmentEnded: false }),
  });
  respondent.speaker.peer(peerSaid('end-of-turn'));
  respondent.speaker.wake();
  await respondent.settle();
  respondent.elapse();
  respondent.speaker.wake();
  await respondent.settle();
  assert({
    given:
      'a peer who starts to reply within the silence, and a respondent whose answer met silence',
    should: 'press neither',
    actual: [asked, answeredBy],
    expected: [['generate:opening'], ['generate:peer-turn']],
  });
  await asker.speaker.stop();
  await respondent.speaker.stop();
});

test('a full provider budget keeps a cross-examination answer already bought', async () => {
  let voiced = 0;
  const calls: string[] = [];
  const { speaker, log, settle, stages } = harness('cross_ex', {
    generate: answering(calls),
    synthesize: async (phraseId, text) => {
      if (++voiced === 1) throw budgetFull();
      return answered(job(phraseId, text));
    },
    publish: async (job) => {
      log.push(`publish:${job.text}`);
      return { complete: true, segmentEnded: false };
    },
  });
  speaker.wake();
  await settle();
  speaker.wake();
  await settle();
  assert({
    given: 'an opening question whose first voice is refused by a full budget',
    should:
      'keep the one answer, voice it on the next wake and report no failure',
    actual: [calls, published(log), stages()],
    expected: [['generate:opening'], ['publish:To opening.'], []],
  });
  await speaker.stop();
});

test('no later phrase starts over a peer who began in the gap before it', async () => {
  const { speaker, log, release, settle } = harness('cross_ex', {
    generate: async () => answered({ phrases: ['One.', 'Two.'] }),
  });
  speaker.wake();
  await settle();
  // The first phrase has played out and nothing is audible; the peer starts.
  speaker.peer(peerSaid('speech-start'));
  await release();
  assert({
    given: 'a peer who starts speaking in the gap between two phrases',
    should: 'hold the second phrase back',
    actual: published(log),
    expected: ['publish:One.'],
  });
  await speaker.stop();
});

test('the pressing of an unanswered question voices its later phrases ahead', async () => {
  const { speaker, log, settle, elapse } = harness('cross_ex', {
    generate: async (to) =>
      answered({
        phrases: to.kind === 'unanswered' ? ['Again.', 'Well?'] : ['Why?'],
      }),
    publish: async (job) => {
      if (job.text === 'Again.') await new Promise(() => undefined);
      return { complete: true, segmentEnded: false };
    },
  });
  speaker.wake();
  await settle();
  elapse();
  await settle();
  assert({
    given: 'a second turn under one claim, after the first was delivered',
    should: 'voice its second phrase while its first plays',
    actual: log.filter((line) => line.startsWith('tts:')),
    expected: ['tts:Why?', 'tts:Again.', 'tts:Well?'],
  });
  void speaker.stop();
});

test('a pause earned by one turn never holds back the turn that replaces it', async () => {
  let voiced = 0;
  const calls: string[] = [];
  const { createBotSpeaker } = await import('./speaker');
  const { generated, isBudgetFull, scope } =
    await import('./speaker.test-support');
  const pending: number[] = [];
  const stopped: string[] = [];
  const speaker = createBotSpeaker({
    claim: {
      scope,
      token: 'memory-only',
      segmentType: 'cross_ex',
      opensExchange: true,
    },
    generate: async (_scope, _token, _signal, to) => {
      calls.push(to.kind);
      return generated({
        ...answered({ phrases: [`To ${to.kind}.`] }),
        abandon: () => stopped.push(to.kind),
      });
    },
    heard: async () => undefined,
    // The pause never ends by itself in this test.
    timer: {
      setTimeout: (_run, ms) => pending.push(ms),
      clearTimeout: () => undefined,
    },
    synthesize: async (_scope, _token, phraseId, text) => {
      if (++voiced === 1) throw budgetFull();
      return answered(job(phraseId, text));
    },
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
    busy: isBudgetFull,
    failed: () => undefined,
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  speaker.wake();
  await settle();
  speaker.wake();
  await settle();
  const whilePaused = [...calls];
  speaker.peer(peerSaid('end-of-turn'));
  speaker.wake();
  await settle();
  assert({
    given:
      'an opening paused by a full budget, a pulse during the pause, then a peer turn ending and a pulse',
    should:
      'start nothing during the pause, then answer the peer at once and stop the dropped answer',
    actual: [whilePaused, calls, stopped[0], pending[0]],
    expected: [['opening'], ['opening', 'peer-turn'], 'opening', 200],
  });
  await speaker.stop();
});

test('a claim that stops abandons the answer it was still holding', async () => {
  const stopped: string[] = [];
  let voiced = 0;
  const { speaker, settle } = harness('speech', {
    generate: async () => ({
      ...answered({ phrases: ['One.'] }),
      abandon: () => stopped.push('abandoned'),
    }),
    synthesize: async (phraseId, text) => {
      if (++voiced === 1) throw budgetFull();
      return answered(job(phraseId, text));
    },
  });
  speaker.wake();
  await settle();
  await speaker.stop();
  assert({
    given: 'a speech deferred with its answer held, then the claim stopping',
    should: 'stop the answer',
    actual: stopped,
    expected: ['abandoned'],
  });
});

test('a peer who goes on speaking before the answer is bought costs nothing', async () => {
  const line = Promise.withResolvers<void>();
  const calls: string[] = [];
  const { speaker, settle } = harness('cross_ex', {
    opensExchange: false,
    heard: () => line.promise,
    generate: answering(calls),
    publish: async () => ({ complete: true, segmentEnded: false }),
  });
  speaker.peer(peerSaid('end-of-turn'));
  speaker.wake();
  await settle();
  // Still waiting for their line: they were only pausing mid-question.
  speaker.peer(peerSaid('speech-start'));
  line.resolve();
  await settle();
  speaker.wake();
  await settle();
  const whileTheySpeak = [...calls];
  speaker.peer(peerSaid('end-of-turn'));
  speaker.wake();
  await settle();
  assert({
    given:
      'a person who pauses mid-question and resumes before the bot has bought an answer, then finishes',
    should: 'buy nothing for the pause and one answer for the whole question',
    actual: [whileTheySpeak, calls],
    expected: [[], ['generate:peer-turn']],
  });
  await speaker.stop();
});
