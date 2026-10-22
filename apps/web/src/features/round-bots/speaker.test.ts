import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { refuseCapacity } from '@daisy/db/testing';
import { createBotSpeaker } from './speaker';
setupRitewayBun();
const scope = {
  roundId: 'round',
  roundParticipantId: 'seat',
  segmentId: 'segment',
  agentRunId: 'run',
  serviceId: 'agent-run:run',
  publicationEpoch: 1,
};
/** A provider answer whose settlement always succeeds. */
const answered = <T>(value: T) => ({ value, settle: async () => undefined });
const job = (phraseId: string, text: string) => ({
  scope,
  token: 'memory-only',
  phraseId,
  text,
  pcm: new Int16Array(240),
  sampleRate: 24000 as const,
  channels: 1 as const,
});
function harness(
  segmentType: 'speech' | 'cross_ex',
  options: {
    readonly generate?: () => Promise<
      ReturnType<typeof answered<{ text: string; phrases: string[] }>>
    >;
  } = {},
) {
  const log: string[] = [];
  const failures: unknown[] = [];
  let ids = 0;
  const gates: ReturnType<typeof Promise.withResolvers<void>>[] = [];
  const speaker = createBotSpeaker({
    claim: { scope, token: 'memory-only', segmentType },
    generate:
      options.generate ??
      (async () => {
        log.push('generate');
        return answered({ text: 'One. Two.', phrases: ['One.', 'Two.'] });
      }),
    synthesize: async (_scope, _token, phraseId, text) => {
      log.push(`tts:${text}`);
      return answered(job(phraseId, text));
    },
    publish: async (job, signal) => {
      const gate = Promise.withResolvers<void>();
      gates.push(gate);
      signal.addEventListener('abort', () => gate.reject(signal.reason));
      log.push(`publish:${job.text}`);
      await gate.promise;
      return { complete: true };
    },
    nextId: () => `phrase-${++ids}`,
    maxAttempts: 2,
    failed: (_error, stage) => {
      failures.push(stage);
    },
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const release = async () => {
    await settle();
    gates.shift()?.resolve();
    await settle();
  };
  return {
    speaker,
    log,
    release,
    settle,
    failures: () => failures.length,
    stages: () => failures,
  };
}
test('a speech claim delivers its generated phrases once without overlapping turns', async () => {
  const { speaker, log, release, settle } = harness('speech');
  speaker.wake();
  speaker.wake();
  await settle();
  assert({
    given: 'an actual speech claim woken twice while publishing',
    should: 'run one turn and keep the phrase in memory for publication',
    actual: [...log],
    expected: ['generate', 'tts:One.', 'publish:One.'],
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
      'tts:One.',
      'publish:One.',
      'tts:Two.',
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
test('cross-examination answers each peer turn once and cancels the active phrase on barge-in', async () => {
  const { speaker, log, release, settle } = harness('cross_ex');
  speaker.wake();
  await settle();
  assert({
    given: 'a free cross-examination claim',
    should: 'open the exchange once and report playback',
    actual: [log.length, speaker.playing()],
    expected: [3, true],
  });
  speaker.peer('barge-in');
  await settle();
  speaker.wake();
  await settle();
  assert({
    given: 'a peer barge-in during playback',
    should: 'cancel the active phrase and wait for the peer turn to end',
    actual: [speaker.playing(), log.length],
    expected: [false, 3],
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
