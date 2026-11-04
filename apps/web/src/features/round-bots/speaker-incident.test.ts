import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRefusal } from '@daisy/errors';
import { answered, harness, job } from './speaker.test-support';
setupRitewayBun();

const held = () => createRefusal('CONFLICT', 'platform-incident');

test('a platform incident stops the job and the same answer resumes', async () => {
  for (const segmentType of ['speech', 'cross_ex'] as const) {
    let bought = 0;
    let refused = 3;
    const sent: string[] = [];
    const { speaker, settle, stages } = harness(segmentType, {
      generate: async () => {
        bought += 1;
        return answered({ text: 'One.', phrases: ['One.'] });
      },
      publish: async (job) => {
        if (refused > 0) {
          refused -= 1;
          throw held();
        }
        sent.push(job.text);
        return { complete: true, segmentEnded: false };
      },
    });
    for (let wake = 0; wake < 12; wake += 1) {
      speaker.wake();
      await settle();
    }
    assert({
      given: `a ${segmentType} held by an incident through three publishes`,
      should:
        'buy one answer, spend no attempt, and deliver it once when the hold lifts',
      actual: { bought, sent, failures: stages() },
      expected: { bought: 1, sent: ['One.'], failures: [] },
    });
    await speaker.stop();
  }
});

const tts = (phraseId: string, text: string) =>
  answered(job(phraseId, text, 24000));
const incident = (since: string, unheardMs: number) =>
  createRefusal('CONFLICT', 'platform-incident', undefined, {
    since,
    unheardMs,
  });

test('what went into a dead room is said again, once, with nothing new bought', async () => {
  const since = '2026-11-04T00:00:00.000Z';
  const synthesized: string[] = [];
  const sent: string[] = [];
  let refusals = 0;
  const { speaker, settle } = harness('speech', {
    generate: async () =>
      answered({
        text: 'One. Two. Three.',
        phrases: ['One.', 'Two.', 'Three.'],
      }),
    synthesize: (phraseId, text) => {
      synthesized.push(text);
      return Promise.resolve(tts(phraseId, text));
    },
    publish: async (spoken, _signal, onSent) => {
      if (spoken.text === 'Three.' && refusals < 3) {
        refusals += 1;
        if (refusals === 1) onSent?.(12000);
        throw incident(since, 1500);
      }
      sent.push(`${spoken.text}:${spoken.pcm.length}`);
      return { complete: true, segmentEnded: false };
    },
  });
  for (let wake = 0; wake < 12; wake += 1) {
    speaker.wake();
    await settle();
  }
  assert({
    given:
      'half of phrase three sent, 1.5 s unheard, and the hold refusing three times',
    should:
      'go back once to the start of phrase two, reuse its audio, then finish',
    actual: { synthesized, sent },
    expected: {
      synthesized: ['One.', 'Two.', 'Three.'],
      sent: ['One.:24000', 'Two.:24000', 'Two.:24000', 'Three.:24000'],
    },
  });
  await speaker.stop();
});

test('an incident with nothing unheard resumes where it stopped', async () => {
  const sent: number[] = [];
  let refused = false;
  const { speaker, settle } = harness('speech', {
    generate: async () => answered({ text: 'One.', phrases: ['One.'] }),
    synthesize: (phraseId, text) => Promise.resolve(tts(phraseId, text)),
    publish: async (spoken, _signal, onSent) => {
      if (!refused) {
        refused = true;
        onSent?.(6000);
        throw incident('2026-11-04T00:00:00.000Z', 0);
      }
      sent.push(spoken.pcm.length);
      return { complete: true, segmentEnded: false };
    },
  });
  for (let wake = 0; wake < 6; wake += 1) {
    speaker.wake();
    await settle();
  }
  assert({
    given: 'a hold with every sample confirmed',
    should: 'send only the rest of the phrase',
    actual: sent,
    expected: [18000],
  });
  await speaker.stop();
});
