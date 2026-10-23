import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { refuseFinalSpeech } from '@daisy/db/testing';
import { answered, harness } from './speaker.test-support';
setupRitewayBun();

/** A language answer whose settlement fails once with `error`, then settles. */
const settlingOnceAfter = (error: Error, calls: { generate: number }) => () => {
  calls.generate++;
  let failed = false;
  return Promise.resolve({
    value: { text: 'One.', phrases: ['One.'] },
    settle: async () => {
      if (failed) return;
      failed = true;
      throw error;
    },
  });
};

for (const [label, error] of [
  ['an infrastructure failure', createAppError('INFRASTRUCTURE', 'reset')],
  ['changed speaking authority', createAppError('CONFLICT', 'not yet')],
] as const)
  test(`a speech keeps its paid answer through ${label} at settlement`, async () => {
    const calls = { generate: 0 };
    const { speaker, release, log } = harness('speech', {
      generate: settlingOnceAfter(error, calls),
    });
    speaker.wake();
    await release();
    speaker.wake();
    await release();
    assert({
      given: `a received speech answer whose first settlement meets ${label}`,
      should:
        'settle the same answer on the next wake and speak it, buying one answer',
      actual: { generated: calls.generate, log },
      expected: { generated: 1, log: ['tts:One.', 'publish:One.'] },
    });
    await speaker.stop();
  });

test('a final refusal ends the speech whether it comes before or after the answer', async () => {
  const outcomes: Record<string, number> = {};
  for (const when of ['before', 'after'] as const) {
    let generated = 0;
    const { speaker, settle, stages } = harness('speech', {
      generate: async () => {
        generated++;
        if (when === 'before')
          throw refuseFinalSpeech('Speech already answered');
        return answered({ text: 'One.', phrases: ['One.'] });
      },
      synthesize: async () => {
        throw refuseFinalSpeech('Speech budget exhausted');
      },
    });
    for (let i = 0; i < 6; i++) {
      speaker.wake();
      await settle();
    }
    outcomes[when] = generated;
    outcomes[`${when} reported`] = stages().length;
    await speaker.stop();
  }
  assert({
    given:
      'a speech refused as already answered, and one whose voice budget is spent after its answer, each woken six times',
    should: 'ask the provider at most once, report nothing and stop',
    actual: outcomes,
    expected: {
      before: 1,
      'before reported': 0,
      after: 1,
      'after reported': 0,
    },
  });
});

test('a cross-examination answer kept after a failure is dropped once the peer takes a new turn', async () => {
  let generated = 0;
  const { speaker, settle } = harness('cross_ex', {
    generate: async () => {
      generated++;
      return {
        value: { text: 'Why?', phrases: ['Why?'] },
        settle: async () => {
          if (generated === 1) throw createAppError('INFRASTRUCTURE', 'reset');
        },
      };
    },
  });
  speaker.wake();
  await settle();
  speaker.peer('end-of-turn');
  speaker.wake();
  await settle();
  assert({
    given:
      'a cross-examination answer whose settlement failed, then a new peer turn',
    should: 'buy a fresh answer for the new turn instead of the stale one',
    actual: generated,
    expected: 2,
  });
  await speaker.stop();
});

test('an empty answer is dropped, so the next attempt can buy a usable one', async () => {
  let generated = 0;
  const { speaker, release } = harness('speech', {
    generate: async () => {
      generated++;
      const text = generated === 1 ? ' ' : 'One.';
      return {
        value: { text, phrases: text.trim() ? [text] : [] },
        settle: async () => {
          if (!text.trim())
            throw createAppError('INFRASTRUCTURE', 'Empty bot phrase');
        },
      };
    },
  });
  for (let i = 0; i < 2; i++) {
    speaker.wake();
    await release();
  }
  assert({
    given: 'a first answer with no phrases, then a usable one',
    should: 'spend an attempt on the empty answer and buy one more',
    actual: generated,
    expected: 2,
  });
  await speaker.stop();
});
