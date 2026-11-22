import type { RoomView } from '@daisy/protocol/room-contract';
import { idle } from '../../../features/forms/form-state';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { RoomControls } from './room-controls';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

/** Every command the controls post, for the test to read. */
export const posted: unknown[] = [];

/** A free casual host's Room controls: capture offered only with Premium. */
export function FreeHostControls() {
  const view: RoomView = {
    ...assemblySnapshot,
    capabilities: { ...assemblySnapshot.capabilities, canEdit: true },
    captureOffer: 'premium',
    capture: null,
  };
  return (
    <RoomControls
      view={view}
      commandIds={{ visibility: 'visibility-id', capture: 'capture-id' }}
      commandAction={async (state, form) => {
        posted.push(form);
        return idle();
      }}
    />
  );
}
