import { AssemblyCommandForm } from './assembly-command-form';
import type { MockFormState } from '../../../features/mock-form/form';
import type { FormAction } from '../../form-action/form-action';
import type { RoomCastChoice, RoomView } from '@daisy/protocol';
import { declaredSeats, seatLabel } from './assembly-controls';
import { AssemblyCommandFields } from './assembly-command-fields';
import { buttonClass } from '../../components/button/button-class';
import { controlClass } from '../../components/form-field/form-field-class';

type Seat = ReturnType<typeof declaredSeats>[number];
type IntentIds = {
  readonly claim: string;
  readonly assign: string;
  readonly remove: string;
};
type Props = {
  readonly view: RoomView;
  readonly viewer: { readonly actorId: string; readonly label: string };
  readonly bots: readonly RoomCastChoice[];
  readonly action: FormAction<MockFormState>;
  readonly commandIds: readonly IntentIds[];
  readonly leaveId: string;
};

function SeatActions({
  props,
  seat,
  ids,
}: {
  readonly props: Props;
  readonly seat: Seat;
  readonly ids: IntentIds;
}) {
  const { view, action } = props;
  const occupant = view.participants.find(
    (member) => member.role === seat.role && member.slot === seat.slot,
  );
  const targets = [
    ...new Map(
      [
        props.viewer,
        ...view.participants.filter((member) => member.kind === 'human'),
      ].map((member) => [member.actorId, member]),
    ).values(),
  ];
  return (
    <fieldset className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4">
      <legend>{seatLabel(seat.role, seat.slot)}</legend>
      {!occupant && view.capabilities.canClaimSeat ? (
        <AssemblyCommandForm action={action}>
          <AssemblyCommandFields
            type="claim-seat"
            version={view.version}
            commandId={ids.claim}
          />
          <input type="hidden" name="role" value={seat.role} />
          <input type="hidden" name="slot" value={String(seat.slot)} />
          <button type="submit" className={buttonClass('secondary')}>
            Take {seatLabel(seat.role, seat.slot)}
          </button>
        </AssemblyCommandForm>
      ) : null}
      {view.capabilities.host ? (
        <AssemblyCommandForm action={action} className="flex gap-2">
          <AssemblyCommandFields
            type="assign-seat"
            version={view.version}
            commandId={ids.assign}
          />
          <input type="hidden" name="role" value={seat.role} />
          <input type="hidden" name="slot" value={String(seat.slot)} />
          <label
            className="sr-only"
            htmlFor={`assign-${seat.role}-${seat.slot}`}
          >
            Assign {seatLabel(seat.role, seat.slot)}
          </label>
          <select
            id={`assign-${seat.role}-${seat.slot}`}
            name="actorId"
            className={controlClass}
          >
            {targets.map((member) => (
              <option key={member.actorId} value={member.actorId}>
                {member.label}
              </option>
            ))}
            {props.bots.map((bot) => (
              <option
                key={bot.actorId}
                value={bot.actorId}
                disabled={!bot.eligible}
              >
                {bot.label} · AI{!bot.eligible ? ' · unavailable' : ''}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass('secondary')}>
            Assign
          </button>
        </AssemblyCommandForm>
      ) : null}
      {view.capabilities.host && occupant ? (
        <AssemblyCommandForm action={action}>
          <AssemblyCommandFields
            type="remove-seat"
            version={view.version}
            commandId={ids.remove}
          />
          <input type="hidden" name="participantId" value={occupant.id} />
          <button type="submit" className={buttonClass('secondary')}>
            Remove {occupant.label}
          </button>
        </AssemblyCommandForm>
      ) : null}
    </fieldset>
  );
}

export function AssemblyCast(props: Props) {
  return (
    <section aria-label="Seat controls" className="flex flex-col gap-3">
      {declaredSeats(props.view.definition.seats).map((seat, index) => {
        const ids = props.commandIds[index];
        if (!ids) throw new Error('Missing Room seat command identities');
        return (
          <SeatActions
            key={`${seat.role}:${seat.slot}`}
            props={props}
            seat={seat}
            ids={ids}
          />
        );
      })}
      {props.view.participants.some(
        (member) => member.actorId === props.viewer.actorId,
      ) ? (
        <AssemblyCommandForm action={props.action}>
          <AssemblyCommandFields
            type="leave-seat"
            version={props.view.version}
            commandId={props.leaveId}
          />
          <button type="submit" className={buttonClass('secondary')}>
            Leave seat
          </button>
        </AssemblyCommandForm>
      ) : null}
    </section>
  );
}
