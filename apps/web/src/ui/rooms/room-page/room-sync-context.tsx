'use client';

import { createContext, useContext, useEffect } from 'react';
import type { RoomView } from '@daisy/protocol';
import type { RoomFormState } from '../../../features/rooms/command-answer';

/** What a room form tells room sync about its answer (ADR 0066). */
export type RoomSyncHandle = {
  readonly accepted: (view: RoomView) => void;
  readonly signal: () => void;
};

export const RoomSyncContext = createContext<RoomSyncHandle | null>(null);

/**
 * Hands each new answer to room sync: an accepted view is adopted; a refusal
 * or a lost answer asks for a read, since the room may have moved. The
 * answer the page rendered with is not new.
 */
export function useRoomAnswer(state: RoomFormState, initial: RoomFormState) {
  const sync = useContext(RoomSyncContext);
  useEffect(() => {
    if (sync === null || state === initial) return;
    switch (state.kind) {
      case 'accepted':
        sync.accepted(state.view);
        return;
      case 'refused':
      case 'unacknowledged':
        sync.signal();
        return;
      case 'idle':
      case 'done':
      case 'moved':
        return;
    }
  }, [sync, state, initial]);
}
