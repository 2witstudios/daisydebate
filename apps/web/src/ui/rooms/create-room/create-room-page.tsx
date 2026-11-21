import { StatusRegion } from '../../components/status-region/status-region';
import type { CreateLobbyChoice } from '../../../features/rooms/create-lobby-choice';
import type { RatingDivision } from '@daisy/protocol';
import Link from 'next/link';
import { buttonClass } from '../../components/button/button-class';
import { PageHeader } from '../../components/page-header/page-header';
import type { RoomDraftAnswer } from '../../../features/rooms/create-room-answer';
import { cn } from '../../cn';
import { CreateAssemblyForm } from './create-assembly-form';
import type { RoomTemplate } from '../../../features/rooms/read-catalog';

export function CreateRoomPage({
  initialState,
  sourceRoomId,
  commandId,
  choices,
  freshRoom = false,
  initialRanked = false,
  memberDivision,
  lobbyChoice,
}: {
  readonly freshRoom?: boolean;
  readonly initialRanked?: boolean;
  /** The member's ladder division (ADR 0147); null with no age on record, so no ranked play. */
  readonly memberDivision: RatingDivision | null;
  /** The eligible lobby options and the selection carried into the form. */
  readonly lobbyChoice: CreateLobbyChoice | null;
  readonly initialState?: RoomDraftAnswer;
  readonly sourceRoomId?: string;
  readonly commandId: string;
  readonly choices: readonly RoomTemplate[];
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
        <StatusRegion as="p" role="status">
          Everyone joins and gets ready again in the new room.
        </StatusRegion>
      ) : null}
      <CreateAssemblyForm
        initialRanked={initialRanked}
        memberDivision={memberDivision}
        lobbyChoice={lobbyChoice}
        {...(initialState ? { initialState } : {})}
        {...(sourceRoomId ? { sourceRoomId } : {})}
        commandId={commandId}
        choices={choices}
      />
    </div>
  );
}
