import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { WithAppRouter } from '../../test-support/app-router';
import { AssemblyCommandForm } from './assembly-command-form';
import { RoomSyncContext, type RoomSyncHandle } from './room-sync-context';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

/** One room command form as the room page mounts it: its fields, one control, room sync around it. */
export function CommandFormHarness({
  action,
  sync,
  fields,
}: {
  readonly action: FormAction<RoomFormState>;
  readonly sync: RoomSyncHandle;
  readonly fields: Readonly<Record<string, string>>;
}) {
  return (
    <WithAppRouter>
      <RoomSyncContext value={sync}>
        <AssemblyCommandForm action={action}>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <button type="submit">Take seat</button>
        </AssemblyCommandForm>
      </RoomSyncContext>
    </WithAppRouter>
  );
}
