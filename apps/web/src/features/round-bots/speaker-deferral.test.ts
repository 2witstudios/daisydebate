import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createBotSpeaker } from './speaker';
import { answered, harness, job, scope } from './speaker.test-support';
setupRitewayBun();
test('pool capacity refusals defer the speech without spending attempts', async () => {
  for (const segmentType of ['speech', 'cross_ex'] as const) {
    let calls = 0;
    const { speaker, settle, log, stages } = harness(segmentType, {
      generate: async () => {
        calls++;
        if (calls <= 3) throw refuseCapacity();
        log.push('generate');
        return answered({ text: 'One.', phrases: ['One.'] });
      },
    });
    for (let i = 0; i < 4; i++) {
      speaker.wake();
      await settle();
    }
    assert({
      given: `a ${segmentType} claim whose shared pool refuses admission three times`,
      should:
        'hand each refusal to the failure sink and deliver on the next wake',
      actual: [calls, stages(), log],
      expected: [
        4,
        ['generate', 'generate', 'generate'],
        ['generate', 'deadline', 'tts:One.', 'publish:One.'],
      ],
    });
    await speaker.stop();
  }
});
test('a deferred turn resumes at its refused step without buying or speaking anything twice', async () => {
  const refusals = new Map([
    ['settle:generate', 2],
    ['settle:Two.', 1],
    ['publish:Two.', 2],
  ]);
  const refuse = (step: string) => {
    const left = refusals.get(step) ?? 0;
    if (left === 0) return;
    refusals.set(step, left - 1);
    throw refuseCapacity();
  };
  const calls = { language: 0, speech: 0 };
  const spoken: string[] = [];
  const stages: string[] = [];
  let ids = 0;
  const speaker = createBotSpeaker({
    claim: {
      scope,
      token: 'memory-only',
      segmentType: 'speech',
      opensExchange: false,
    },
    generate: async () => {
      calls.language++;
      return {
        value: { text: 'One. Two.', phrases: ['One.', 'Two.'] },
        settle: async () => refuse('settle:generate'),
      };
    },
    synthesize: async (_scope, _token, phraseId, text) => {
      calls.speech++;
      return {
        value: job(phraseId, text),
        settle: async () => refuse(`settle:${text}`),
      };
    },
    deadline: async () => 1e12,
    lineClosed: () => false,
    tailCut: () => false,
    writeAhead: () => undefined,
    discard: () => undefined,
    audible: () => false,
    silence: () => undefined,
    publish: async (job) => {
      refuse(`publish:${job.text}`);
      spoken.push(job.text);
      return { complete: true, segmentEnded: false };
    },
    nextId: () => `phrase-${++ids}`,
    maxAttempts: 2,
    failed: (_error, stage) => {
      stages.push(stage);
    },
  });
  for (let i = 0; i < 8; i++) {
    speaker.wake();
    for (let j = 0; j < 20; j++) await Promise.resolve();
  }
  assert({
    given:
      'a speech whose shared pool refuses the language settlement twice, the voiced-ahead second phrase settlement once and its publication twice',
    should:
      'call the language provider once, synthesize each phrase once and speak each phrase once',
    actual: { calls, spoken, stages },
    expected: {
      calls: { language: 1, speech: 2 },
      spoken: ['One.', 'Two.'],
      // The voiced-ahead phrase's refused settlement is retried in turn, unpaid.
      stages: ['generate', 'generate', 'publish', 'publish'],
    },
  });
  await speaker.stop();
});
/** The phrase ids offered when the first publish is refused once. */
async function offeredAfterOneRefusal(closedAfterRefusal: boolean) {
  const offered: string[] = [];
  let refused = false;
  const closed = new Set<string>();
  const { speaker, settle } = harness('speech', {
    synthesize: async (phraseId, text) => answered(job(phraseId, text, 960)),
    lineClosed: (id) => closed.has(id),
    tailCut: () => false,
    publish: async (sent) => {
      offered.push(`${sent.text}:${sent.phraseId}`);
      if (!refused) {
        refused = true;
        if (closedAfterRefusal) closed.add(sent.phraseId);
        throw refuseCapacity();
      }
      return { complete: true, segmentEnded: false };
    },
  });
  for (let i = 0; i < 4; i++) {
    speaker.wake();
    await settle();
  }
  await speaker.stop();
  return offered;
}
test('a phrase whose start outcome is unknown is retried under the same line id', async () => {
  const offered = await offeredAfterOneRefusal(false);
  assert({
    given: 'a first phrase refused once before its line was closed',
    should:
      'say it again under the same line id, so a start that committed is not written twice',
    actual: offered.map((entry) => entry.split(':')[0]),
    expected: ['One.', 'One.', 'Two.'],
  });
  assert({
    given: 'the same retry',
    should: 'reuse the first line id, then give the next phrase its own',
    actual: [offered[0] === offered[1], offered[1] !== offered[2]],
    expected: [true, true],
  });
});
test('a phrase cut and closed is said again whole, as a new line (ADR 0122)', async () => {
  const offered = await offeredAfterOneRefusal(true);
  assert({
    given: 'a first phrase whose line was closed cut before the retry',
    should: 'say it again whole under a new line id',
    actual: new Set(offered.map((entry) => entry.split(':')[1])).size,
    expected: 3,
  });
});
