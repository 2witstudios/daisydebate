import { createAppError } from '@daisy/errors';
import type {
  contentModerationOperations,
  ContentModerationChange,
} from '../src/content-moderation-operations';

type Store = ReturnType<typeof contentModerationOperations>;
type Input = Omit<Parameters<Store['runModerationCommand']>[0], 'change'> & {
  readonly change: ContentModerationChange;
};

/** Explicit integration-only composition; web contracts exercise the actual application caller. */
export const testModerationCommands = (store: Store) => ({
  ...store,
  runModerationCommand: async (input: Input) => {
    const change = input.change;
    if (
      change.action !== 'recording.takedown' &&
      change.action !== 'recording.remove' &&
      change.action !== 'recording.legal_remove'
    )
      return store.runModerationCommand({ ...input, change });
    return store.recordingWithdrawalCommand(
      { ...input, change },
      async (session) => {
        const loaded = await session.load();
        if (loaded.kind === 'replayed') return;
        if (loaded.recording === null) throw createAppError('NOT_FOUND');
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
      },
    );
  },
});
