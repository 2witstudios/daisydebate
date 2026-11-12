'use client';

import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { buttonClass } from '../../components/button/button-class';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';
import { RoomDialog, RoomDialogClose } from './room-dialog';

/** The host closes the room for everyone, behind a confirm dialog. */
export function CloseRoom({
  version,
  commandId,
  action,
}: {
  readonly version: number;
  readonly commandId: string;
  readonly action: FormAction<RoomFormState>;
}) {
  return (
    <RoomDialog
      label="Close room"
      titleId="close-room-title"
      title="Close this room for everyone?"
    >
      <p className="text-sm text-ink-muted">
        Nobody can join or start a round in it again.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <RoomDialogClose>Cancel</RoomDialogClose>
        <AssemblyCommandForm action={action}>
          <AssemblyCommandFields
            type="close"
            version={version}
            commandId={commandId}
          />
          <button type="submit" className={buttonClass('primary')}>
            Close room for everyone
          </button>
        </AssemblyCommandForm>
      </div>
    </RoomDialog>
  );
}
