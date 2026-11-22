import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';

type Store = Pick<Database, 'recordingTakedownCommand'>;
type Input = Parameters<Store['recordingTakedownCommand']>[0];

/** Preparing effects, feed termination and receipt remain in the same bounded transaction. */
export function runRecordingTakedownCommand(store: Store, input: Input) {
  return store.recordingTakedownCommand(input, async (session) => {
    const loaded = await session.load();
    if (loaded.kind === 'replayed') return;
    if (loaded.recording === null) throw createAppError('NOT_FOUND');
    const feed = await loaded.endFeed();
    await loaded.settle({
      v: 1,
      outcome: feed === 'applied' ? 'applied' : loaded.recording,
    });
  });
}
