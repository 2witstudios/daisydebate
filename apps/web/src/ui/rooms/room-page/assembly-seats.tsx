import { buttonClass } from '../../components/button/button-class';
import { AssemblyCast, type CastProps, type IntentIds } from './assembly-cast';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';
import { declaredSeats, seatLabel } from './assembly-controls';
import { initials, seatStatus } from './room-labels';
import { RoomInvite } from './room-invite';

type Seat = ReturnType<typeof declaredSeats>[number];
type Props = CastProps;

const avatarTone = {
  affirmative: 'bg-hue-sky-soft text-hue-sky',
  negative: 'bg-hue-clay-soft text-hue-clay',
  judge: 'bg-hue-teal-soft text-hue-teal',
} as const;

function SeatCommand({
  props,
  type,
  commandId,
  fields,
  label,
}: {
  readonly props: Props;
  readonly type: 'claim-seat' | 'assign-seat';
  readonly commandId: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly label: string;
}) {
  return (
    <AssemblyCommandForm action={props.action}>
      <AssemblyCommandFields
        type={type}
        version={props.view.version}
        commandId={commandId}
      />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={buttonClass('secondary')}>
        {label}
      </button>
    </AssemblyCommandForm>
  );
}

/** An open seat: take it, invite someone, or (judge, host) seat an AI judge. */
function OpenSeatActions({
  props,
  seat,
  ids,
}: {
  readonly props: Props;
  readonly seat: Seat;
  readonly ids: IntentIds;
}) {
  const { view } = props;
  const position = { role: seat.role, slot: String(seat.slot) };
  const aiJudge = props.bots.find((bot) => bot.eligible);
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      {view.capabilities.canClaimSeat ? (
        <SeatCommand
          props={props}
          type="claim-seat"
          commandId={ids.claim}
          fields={position}
          label={`Take ${seatLabel(seat.role, seat.slot)}`}
        />
      ) : null}
      {seat.role === 'judge' ? (
        <RoomInvite
          roomId={view.id}
          visibility={view.visibility}
          label="Invite"
        />
      ) : null}
      {seat.role === 'judge' && view.capabilities.host && aiJudge ? (
        <SeatCommand
          props={props}
          type="assign-seat"
          commandId={ids.ai}
          fields={{ ...position, actorId: aiJudge.actorId }}
          label="AI judge"
        />
      ) : null}
    </div>
  );
}

function SeatRow({
  props,
  seat,
  ids,
}: {
  readonly props: Props;
  readonly seat: Seat;
  readonly ids: IntentIds;
}) {
  const { view } = props;
  const occupant = view.participants.find(
    (member) => member.role === seat.role && member.slot === seat.slot,
  );
  const status = seatStatus(occupant);
  const name = !occupant
    ? seatLabel(seat.role, seat.slot)
    : occupant.actorId === props.viewer.actorId
      ? 'You'
      : `${occupant.label}${occupant.kind === 'bot' ? ' · AI' : ''}`;
  const detail = !occupant
    ? status
    : [
        seatLabel(seat.role, seat.slot),
        ...(occupant.actorId === view.hostActorId ? ['host'] : []),
      ].join(' · ');
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-3 border-t border-border py-3 first:border-t-0">
      {occupant ? (
        <span
          aria-hidden="true"
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarTone[seat.role]}`}
        >
          {initials(occupant.label)}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-ink-muted"
        >
          +
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold wrap-anywhere">{name}</h3>
        <p className="text-sm wrap-anywhere text-ink-muted">{detail}</p>
      </div>
      {occupant ? (
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${status === 'Ready' ? 'bg-hue-teal-soft text-hue-teal' : 'bg-surface-sunken text-ink-muted'}`}
        >
          {status}
        </span>
      ) : (
        <OpenSeatActions props={props} seat={seat} ids={ids} />
      )}
    </li>
  );
}

/** Every declared seat as one row; the host's assignment form sits beneath. */
export function AssemblySeats(props: Props) {
  const seats = declaredSeats(props.view.definition.seats);
  return (
    <section
      aria-labelledby="room-seats-title"
      className="flex min-w-0 flex-col rounded-xl border border-border bg-surface px-4 py-3"
    >
      <h2 id="room-seats-title" className="text-md font-semibold">
        Seats
      </h2>
      <ul className="flex flex-col">
        {seats.map((seat, index) => {
          const ids = props.commandIds[index];
          if (!ids) throw new Error('Missing Room seat command identities');
          return (
            <SeatRow
              key={`${seat.role}:${seat.slot}`}
              props={props}
              seat={seat}
              ids={ids}
            />
          );
        })}
      </ul>
      {props.view.capabilities.host ? (
        <details className="border-t border-border pt-3">
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-strong">
            Manage seats
          </summary>
          <div className="mt-3">
            <AssemblyCast {...props} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
