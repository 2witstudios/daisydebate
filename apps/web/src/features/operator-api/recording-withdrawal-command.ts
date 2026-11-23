import { type ContentModerationStore } from '@daisy/db/stores/content-moderation';
import { createAppError } from '@daisy/errors';

type Store = Pick<ContentModerationStore, 'recordingWithdrawalCommand'>;
type Input = Parameters<Store['recordingWithdrawalCommand']>[0];

/** Preparing effects, feed termination and receipt remain in the same bounded transaction. */
export function runRecordingWithdrawalCommand(store: Store, input: Input) {
  return store.recordingWithdrawalCommand(input, async (session) => {
    const loaded = await session.load();
    if (loaded.kind === 'replayed') return;
    if (loaded.recording === null) throw createAppError('NOT_FOUND');
    const change = input.change;
    const feed = await loaded.endFeed(
      change.action === 'recording.takedown'
        ? change.reason
        : change.action === 'recording.remove'
          ? 'recording_removed'
          : 'recording_legally_removed',
    );
    await loaded.settle({
      v: 1,
      outcome: feed === 'applied' ? 'applied' : loaded.recording,
    });
  });
}
