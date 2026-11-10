import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRefusal } from '@daisy/errors';
import { answered, harness } from './speaker.test-support';
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

test('an incident that cuts the tail of the phrase before resumes at that phrase, said again whole', async () => {
  const sent: string[] = [];
  const voiced: string[] = [];
  let refusedTwo = false;
  const { speaker, settle } = harness('speech', {
    generate: async () =>
      answered({
        text: 'One. Two. Three.',
        phrases: ['One.', 'Two.', 'Three.'],
      }),
    synthesize: async (phraseId, text) => {
      voiced.push(text);
      return answered({
        scope: undefined as never,
        token: 't',
        phraseId,
        text,
        pcm: new Int16Array(24_000 * 5),
        sampleRate: 24_000,
        channels: 1,
      });
    },
    // Two. is held by an incident while One.'s tail still plays: One. is cut.
    publish: async (job) => {
      if (job.text === 'Two.' && !refusedTwo) {
        refusedTwo = true;
        throw held();
      }
      sent.push(job.text);
      return { complete: true, segmentEnded: false };
    },
    tailCut: () => refusedTwo && sent.length === 1,
  });
  for (let wake = 0; wake < 6; wake += 1) {
    speaker.wake();
    await settle();
  }
  assert({
    given:
      'a phrase whose start is held by an incident, cutting the queued tail of the phrase before it',
    should:
      'say the cut phrase again whole once the hold lifts, then go on, voicing nothing twice',
    actual: { sent, voiced: [...voiced].sort() },
    expected: {
      sent: ['One.', 'One.', 'Two.', 'Three.'],
      voiced: ['One.', 'Three.', 'Two.'],
    },
  });
  await speaker.stop();
});
