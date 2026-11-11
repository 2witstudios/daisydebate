import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { WithAppRouter } from '../../test-support/app-router';
import { ContentWaiverForm } from './content-waiver-form';
import { RoomSyncContext, type RoomSyncHandle } from './room-sync-context';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

/** The waiver form as the room page mounts it, with room sync around it. */
export function WaiverFormHarness({
  action,
  sync,
}: {
  readonly action: FormAction<RoomFormState>;
  readonly sync: RoomSyncHandle;
}) {
  return (
    <WithAppRouter>
      <RoomSyncContext value={sync}>
        <ContentWaiverForm action={action} />
      </RoomSyncContext>
    </WithAppRouter>
  );
}
