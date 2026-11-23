import { type ContentModerationStore } from '@daisy/db/stores/content-moderation';

type Store = Pick<ContentModerationStore, 'chatRemovalCommand'>;
type Input = Parameters<Store['chatRemovalCommand']>[0];

/** Only a missing message permits trying the next conversation owner. */
export function runChatRemovalCommand(store: Store, input: Input) {
  return store.chatRemovalCommand(input, async (removers) => {
    const spectator = await removers.spectator();
    if (spectator !== null) return spectator;
    const floor = await removers.floor();
    return floor === null ? removers.room() : floor;
  });
}
