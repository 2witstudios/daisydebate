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
