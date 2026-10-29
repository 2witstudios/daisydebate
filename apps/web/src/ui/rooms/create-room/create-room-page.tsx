import Link from 'next/link';
import type { PublishedResolution } from '@daisy/protocol';
import { buttonClass } from '../../components/button/button-class';
import { PageHeader } from '../../components/page-header/page-header';
import type { FormState } from '../../../features/forms/form-state';
import { cn } from '../../cn';
import { CreateAssemblyForm } from './create-assembly-form';
import type { RoomTemplate } from '../../../features/rooms/read-catalog';

export function CreateRoomPage({
  initialState,
  sourceRoomId,
  commandId,
  choices,
  resolutions = [],
  freshRoom = false,
  initialRated = false,
}: {
  readonly freshRoom?: boolean;
  readonly initialRated?: boolean;
  readonly initialState?: FormState;
  readonly sourceRoomId?: string;
  readonly commandId: string;
  readonly choices: readonly RoomTemplate[];
  readonly resolutions?: readonly PublishedResolution[];
}) {
  return (
    <div className="create-room-page">
      <PageHeader
        title={freshRoom ? 'Create a new room' : 'Create a room'}
        actions={
          <Link
            href="/lobby"
            className={cn(
              buttonClass('secondary'),
              'no-underline hover:no-underline',
            )}
          >
            Browse open rooms
          </Link>
        }
      />
      {freshRoom ? (
        <p role="status">
          Everyone joins and gets ready again in the new room.
        </p>
      ) : null}
      <CreateAssemblyForm
        initialRated={initialRated}
        {...(initialState ? { initialState } : {})}
        {...(sourceRoomId ? { sourceRoomId } : {})}
        commandId={commandId}
        choices={choices}
        resolutions={resolutions}
      />
    </div>
  );
}
