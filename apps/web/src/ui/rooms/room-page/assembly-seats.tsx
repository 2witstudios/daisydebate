import type { RoomView } from '@daisy/protocol';
import { declaredSeats, seatLabel } from './assembly-controls';

type Props = {
  readonly seats: RoomView['definition']['seats'];
  readonly participants: RoomView['participants'];
  readonly status?: RoomView['status'];
};

function seatStatus(occupant: RoomView['participants'][number] | undefined) {
  return !occupant
    ? 'Open seat'
    : !occupant.eligible
      ? 'Not eligible'
      : !occupant.needsReady
        ? 'Server managed'
        : occupant.ready === 'ready'
          ? 'Ready'
          : occupant.ready === 'unavailable'
            ? 'Readiness unavailable'
            : 'Not ready';
}

function Seat({
  role,
  slot,
  participants,
}: ReturnType<typeof declaredSeats>[number] & Pick<Props, 'participants'>) {
  const occupant = participants.find(
    (seat) => seat.role === role && seat.slot === slot,
  );
  const status = seatStatus(occupant);
  const judge = role === 'judge';
  return (
    <li
      className={
        judge
          ? 'flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-stage-accent/40 py-4'
          : 'flex min-w-0 flex-col gap-3'
      }
    >
      {!judge ? (
        <div
          aria-hidden="true"
          className={`flex h-room-portrait items-center justify-center rounded-lg ${role === 'affirmative' ? 'bg-stage-accent' : 'bg-stage-accent-strong'} text-stage-accent-ink max-narrow:h-room-portrait-small`}
        >
          <span className="font-display text-display-sm">
            {occupant ? occupant.label.slice(0, 1).toLocaleUpperCase() : '—'}
          </span>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="text-sm font-semibold wrap-anywhere text-stage-ink-muted">
          {seatLabel(role, slot)}
        </h3>
        {occupant ? (
          <p className="font-semibold wrap-anywhere text-stage-ink">
            {occupant.label}
            {occupant.kind === 'bot' ? ' · AI' : ''}
          </p>
        ) : null}
      </div>
      <p className="text-sm wrap-anywhere text-stage-ink-muted">{status}</p>
    </li>
  );
}

export function AssemblySeats({
  seats,
  participants,
  status = 'assembling',
}: Props) {
  const declared = declaredSeats(seats);
  return (
    <section
      aria-label="Room seats"
      className="rounded-xl bg-surface-stage p-6 text-stage-ink max-narrow:p-4"
    >
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">
          Take your places.
        </h2>
        <span className="rounded-full border border-stage-accent px-3 py-1 text-xs text-stage-ink-muted">
          {status === 'started' ? 'Round started' : 'Before the round'}
        </span>
      </header>
      <div className="grid room-team-grid gap-6 max-narrow:gap-3">
        {(['affirmative', 'negative'] as const).map((role) => (
          <section
            key={role}
            aria-label={`${role === 'affirmative' ? 'Affirmative' : 'Negative'} lineup`}
            className="min-w-0"
          >
            <h2 className="mb-3 text-sm font-semibold wrap-anywhere">
              {role === 'affirmative' ? 'Affirmative' : 'Negative'}
            </h2>
            <ul className="flex flex-col gap-5">
              {declared
                .filter((seat) => seat.role === role)
                .map((seat) => (
                  <Seat key={seat.slot} {...seat} participants={participants} />
                ))}
            </ul>
          </section>
        ))}
      </div>
      <ul aria-label="Judges" className="mt-6">
        {declared
          .filter((seat) => seat.role === 'judge')
          .map((seat) => (
            <Seat key={seat.slot} {...seat} participants={participants} />
          ))}
      </ul>
    </section>
  );
}
