import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { WithAppRouter } from '../../test-support/app-router';
import { ClaimSeatForm, type OtherLadderSeat } from './claim-seat-form';
import { RoomSyncContext } from './room-sync-context';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

/** One Take seat as the roster mounts it, with room sync around it. */
export function ClaimSeatHarness({
  action,
  otherLadder,
}: {
  readonly action: FormAction<RoomFormState>;
  readonly otherLadder: OtherLadderSeat | null;
}) {
  return (
    <WithAppRouter>
      <RoomSyncContext value={{ accepted: () => {}, signal: () => {} }}>
        <ClaimSeatForm
          action={action}
          version={3}
          commandId={'c'.repeat(24)}
          seat={{ kind: 'side', side: 'negative', slot: 0 }}
          name="Take Negative"
          className="inline-flex"
          otherLadder={otherLadder}
        />
      </RoomSyncContext>
    </WithAppRouter>
  );
}
