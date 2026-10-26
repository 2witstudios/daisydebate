import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withClaimedCapture } from './media-capture.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('audio heard past the speaking interval end earns no transcript credit', () =>
  withClaimedCapture(async (_f, { store, clip, start, end }) => {
    const at = (ms: number) => new Date(start.getTime() + ms).toISOString();
    const credited = (candidate: typeof clip) =>
      store.appendCapturedTranscript(candidate).then(
        () => 'credited',
        () => 'refused',
      );
    // A frame that a bot publisher sent up to 100 ms past the interval end.
    const overrun = await credited({
      ...clip,
      trackId: createId(),
      startOffsetMs: 950,
      durationMs: 100,
      before: at(949),
      after: new Date(end.getTime() + 80).toISOString(),
    });
    const inside = await credited({
      ...clip,
      startOffsetMs: 900,
      durationMs: 98,
      before: at(899),
      after: at(999),
    });
    assert({
      given:
        'a speaking interval ending at its segment end, a clip ending just inside it and one reaching 80 ms past it',
      should:
        'credit the clip inside the interval and refuse the one heard in the overrun (ISSUE-460, DEC-212)',
      actual: { inside, overrun },
      expected: { inside: 'credited', overrun: 'refused' },
    });
  }));
