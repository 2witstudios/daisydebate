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
 * Hands each new answer to room sync: an accepted view is adopted, a refusal
 * asks for a read. The answer the page rendered with is not new.
 */
export function useRoomAnswer(state: RoomFormState, initial: RoomFormState) {
  const sync = useContext(RoomSyncContext);
  useEffect(() => {
    if (sync === null || state === initial) return;
    if (state.view) sync.accepted(state.view);
    else if (state.error) sync.signal();
  }, [sync, state, initial]);
}
