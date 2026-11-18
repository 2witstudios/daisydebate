'use client';

import type { SeatRef } from '@daisy/protocol';
import {
  refusedFor,
  roomFormFields,
  type RoomFormState,
} from '../../../features/rooms/command-answer';
import type { FormFields } from '../../../features/forms/form-state';
import type { FormAction } from '../../form-action/form-action';
import { Icon } from '../../components/icon/icon';
import { AssemblyCommandFields } from './assembly-command-fields';
import { RoomAnswerForm } from './assembly-command-form';
import { RetryRoomCommand } from './retry-room-command';

/** Why a refused seat is on the viewer's other ladder (`seatOnOtherLadder`). */
export type OtherLadderSeat = { readonly title: string; readonly body: string };

/**
 * Take seat on an open seat. When the Room refuses the viewer's own debater
 * seat because it is on their other ladder (ADR 0147), the seat says which
 * ladder it is on and what the viewer can do instead, in place of the bare
 * refusal; any other answer reads as every room command's does.
 */
export function ClaimSeatForm({
  action,
  version,
  commandId,
  seat,
  name,
  className,
  otherLadder,
}: {
  readonly action: FormAction<RoomFormState>;
  readonly version: number;
  readonly commandId: string;
  readonly seat: SeatRef;
  /** The accessible name: "Take Negative 1". */
  readonly name: string;
  readonly className: string;
  /** This seat's ladder words for the viewer; null when it is theirs. */
  readonly otherLadder: OtherLadderSeat | null;
}) {
  const onOtherLadder = (answer: RoomFormState) =>
    otherLadder !== null && refusedFor(answer, 'ranked-division');
  const fields = (answer: RoomFormState): FormFields =>
    onOtherLadder(answer)
      ? { ...roomFormFields(answer), error: undefined }
      : roomFormFields(answer);
  return (
    <RoomAnswerForm action={action} fields={fields}>
      {(answer, _fields, pending) =>
        answer.kind === 'unacknowledged' ? (
          <RetryRoomCommand values={answer.values} pending={pending} />
        ) : (
          <>
            <AssemblyCommandFields
              type="claim-seat"
              version={version}
              commandId={commandId}
            />
            <input type="hidden" name="seat" value={JSON.stringify(seat)} />
            <button
              type="submit"
              aria-label={name}
              disabled={onOtherLadder(answer)}
              className={`${className} ml-auto`}
            >
              Take seat
            </button>
            {otherLadder !== null && onOtherLadder(answer) ? (
              <div
                role="status"
                data-ladder-refusal=""
                className="flex basis-full items-start gap-3 rounded-lg bg-hue-plum-soft px-4 py-3 text-sm"
              >
                <Icon
                  name="info"
                  size={18}
                  className="mt-1 shrink-0 text-hue-plum"
                />
                <p>
                  <strong className="font-strong">{otherLadder.title}</strong>{' '}
                  {otherLadder.body}
                </p>
              </div>
            ) : null}
          </>
        )
      }
    </RoomAnswerForm>
  );
}
