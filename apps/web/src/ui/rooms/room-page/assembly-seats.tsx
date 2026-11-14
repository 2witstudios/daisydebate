import type { ReactNode } from 'react';
import {
  freeSeatsOf,
  isJudgeSeat,
  isNamedSeat,
  sameSeat,
  seatKey,
  type SeatRef,
} from '@daisy/protocol';
import { buttonClass } from '../../components/button/button-class';
import {
  AssemblyCast,
  botsForSeat,
  type CastProps,
  type IntentIds,
} from './assembly-cast';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';
import { AiJudgeNotice, aiJudgeSeatable } from './ai-judge-notice';
import { declaredSeats, seatLabel } from './assembly-controls';
import { initialsOf } from '../../../lib/initials';
import { seatStatus } from './room-labels';
import { RoomInvite } from './room-invite';
import { officialTone, sideTone, speakerTone } from './side-tone';

type Seat = SeatRef;
type Props = CastProps & {
  /** The viewer's own Ready control, shown in their seat row; null without one. */
  readonly ready: ReactNode;
};

/** A seat's avatar tone: its side's, the speakers' shared one, or the officials'. */
const avatarTone = (
  sides: readonly { readonly key: string }[],
  seat: Seat,
): string => {
  switch (seat.kind) {
    case 'side':
      return sideTone(sides, seat.side);
    case 'speaker':
      return speakerTone;
    case 'judge':
    case 'moderator':
      return officialTone;
  }
};

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

/** Whether every free seat of this kind is held for someone other than this viewer. */
const heldFromViewer = (view: Props['view'], seat: Seat) => {
  const held = view.seatsHeldFromViewer[seat.kind];
  return held > 0 && freeSeatsOf(view, seat.kind) <= held;
};

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
  const position = { seat: JSON.stringify(seat) };
  const judge = isJudgeSeat(seat);
  const aiJudge =
    judge && aiJudgeSeatable(view.aiJudgeSeating)
      ? botsForSeat(props.bots, seat).find((bot) => bot.eligible)
      : undefined;
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      {view.capabilities.canClaimSeat && !heldFromViewer(view, seat) ? (
        <SeatCommand
          props={props}
          type="claim-seat"
          commandId={ids.claim}
          fields={position}
          label={`Take ${seatLabel(view.rules.sides, seat)}`}
        />
      ) : null}
      {judge ? (
        <RoomInvite
          roomId={view.id}
          visibility={view.visibility}
          label="Invite"
        />
      ) : null}
      {view.capabilities.host && aiJudge ? (
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

type Occupant = Props['view']['participants'][number];

/** A seat's name and detail line; a human judge may be anonymous (DEC-174). */
function seatText(
  name: string,
  occupant: Occupant | undefined,
  named: Extract<Occupant, { actorId: string }> | null,
  who: { readonly viewerActorId: string; readonly hostActorId: string | null },
) {
  if (!occupant) return { name, detail: seatStatus(occupant) };
  const occupantName = !named
    ? 'Judge'
    : named.actorId === who.viewerActorId
      ? 'You'
      : `${named.label}${named.kind === 'bot' ? ' · AI' : ''}`;
  const host =
    who.hostActorId !== null && named?.actorId === who.hostActorId
      ? ['host']
      : [];
  return { name: occupantName, detail: [name, ...host].join(' · ') };
}

/** What a row says about its seat: the occupant's readiness, or what an open seat offers. */
function SeatStanding({
  props,
  seat,
  ids,
  occupant,
}: {
  readonly props: Props;
  readonly seat: Seat;
  readonly ids: IntentIds;
  readonly occupant: Occupant | undefined;
}) {
  if (!occupant) return <OpenSeatActions props={props} seat={seat} ids={ids} />;
  const status = seatStatus(occupant);
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${status === 'Ready' ? 'bg-hue-teal-soft text-hue-teal' : 'bg-surface-sunken text-ink-muted'}`}
    >
      {status}
    </span>
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
  const occupant = view.participants.find((member) =>
    sameSeat(member.seat, seat),
  );
  const named = occupant && isNamedSeat(occupant) ? occupant : null;
  const { name, detail } = seatText(
    seatLabel(view.rules.sides, seat),
    occupant,
    named,
    {
      viewerActorId: props.viewer.actorId,
      hostActorId: view.hostActorId,
    },
  );
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-3 border-t border-border py-3 first:border-t-0">
      {occupant ? (
        <span
          aria-hidden="true"
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarTone(view.rules.sides, seat)}`}
        >
          {initialsOf(named?.label ?? 'Judge')}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-ink-muted"
        >
          +
        </span>
      )}
      <div className="flex-1">
        <h3 className="font-semibold wrap-anywhere">{name}</h3>
        <p className="text-sm text-ink-muted">{detail}</p>
      </div>
      {named?.actorId === props.viewer.actorId && props.ready ? (
        props.ready
      ) : (
        <SeatStanding props={props} seat={seat} ids={ids} occupant={occupant} />
      )}
    </li>
  );
}

/** Every declared seat as one row; the host's assignment form sits beneath. */
export function AssemblySeats(props: Props) {
  const seats = declaredSeats(props.view.rules);
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
            <SeatRow key={seatKey(seat)} props={props} seat={seat} ids={ids} />
          );
        })}
      </ul>
      <AiJudgeNotice view={props.view} />
      {props.view.capabilities.host ? (
        <details className="border-t border-border pt-3">
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-strong">
            Manage seats
          </summary>
          <div className="mt-3">
            <AssemblyCast
              view={props.view}
              viewer={props.viewer}
              bots={props.bots}
              action={props.action}
              commandIds={props.commandIds}
            />
          </div>
        </details>
      ) : null}
    </section>
  );
}
