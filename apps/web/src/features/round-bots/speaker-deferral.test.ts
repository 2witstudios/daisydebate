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
        ['generate', 'tts:One.', 'publish:One.'],
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
    claim: { scope, token: 'memory-only', segmentType: 'speech' },
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
    publish: async (job) => {
      refuse(`publish:${job.text}`);
      spoken.push(job.text);
      return { complete: true };
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
      'a speech whose shared pool refuses the language settlement twice, the second phrase settlement once and its publication twice',
    should:
      'call the language provider once, synthesize each phrase once and speak each phrase once',
    actual: { calls, spoken, stages },
    expected: {
      calls: { language: 1, speech: 2 },
      spoken: ['One.', 'Two.'],
      stages: ['generate', 'generate', 'synthesize', 'publish', 'publish'],
    },
  });
  await speaker.stop();
});
test('a phrase refused mid-publication resumes from the samples already sent', async () => {
  const offered: number[] = [];
  let refused = false;
  const { speaker, settle } = harness('speech', {
    synthesize: async (phraseId, text) => answered(job(phraseId, text, 960)),
    publish: async (sent, _signal, onSent) => {
      offered.push(sent.pcm.length);
      if (!refused) {
        refused = true;
        onSent?.(480);
        throw refuseCapacity();
      }
      onSent?.(sent.pcm.length);
      return { complete: true };
    },
  });
  for (let i = 0; i < 4; i++) {
    speaker.wake();
    await settle();
  }
  assert({
    given:
      'a 960-sample first phrase whose window authorization is refused after 480 samples were sent',
    should:
      'offer only the unsent 480 samples on the next wake, then the next phrase whole',
    actual: offered,
    expected: [960, 480, 960],
  });
  await speaker.stop();
});
