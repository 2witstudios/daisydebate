import { assert, setupRitewayBun, test } from 'riteway/bun';
import { answered, harness, job } from './speaker.test-support';
setupRitewayBun();

/** A speaker whose first publication stops early after 480 samples were sent. */
async function stoppedOnce(segmentEnded: boolean) {
  const offered: number[] = [];
  let stopped = false;
  const run = harness('speech', {
    synthesize: async (phraseId, text) => answered(job(phraseId, text, 960)),
    publish: async (sent, _signal, onSent) => {
      offered.push(sent.pcm.length);
      if (!stopped) {
        stopped = true;
        onSent?.(480);
        return { complete: false, segmentEnded };
      }
      onSent?.(sent.pcm.length);
      return { complete: true, segmentEnded: false };
    },
  });
  for (let i = 0; i < 3; i++) {
    run.speaker.wake();
    await run.settle();
  }
  await run.speaker.stop();
  return { offered, stages: run.stages() };
}

test('a publication stopped early by a stall is a recorded failure that resumes the speech', async () => {
  assert({
    given:
      'a first phrase whose publication stops early, with the segment still open (ISSUE-497 repro)',
    should:
      'record a publish failure and resume from the unsent samples on the next wake, then speak the rest',
    actual: await stoppedOnce(false),
    expected: { offered: [960, 480, 960], stages: ['publish'] },
  });
});

test('a publication stopped by the segment end finishes the speech without a failure', async () => {
  assert({
    given: 'a first phrase cut off by the end of its segment',
    should: 'end the speech quietly: the segment is over',
    actual: await stoppedOnce(true),
    expected: { offered: [960], stages: [] },
  });
});
