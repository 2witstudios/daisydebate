import type { RoomView } from '@daisy/protocol';
import { declaredSeats, seatLabel } from './assembly-controls';

export function AssemblySeats({
  seats,
  participants,
}: {
  readonly seats: RoomView['definition']['seats'];
  readonly participants: RoomView['participants'];
}) {
  return (
    <ul aria-label="Room seats" className="grid grid-cols-1 gap-4">
      {declaredSeats(seats).map(({ role, slot }) => {
        const occupant = participants.find(
          (seat) => seat.role === role && seat.slot === slot,
        );
        const status = !occupant
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
        return (
          <li
            key={`${role}:${slot}`}
            className="flex flex-col gap-2 rounded-xl bg-surface p-5 shadow-1"
          >
            <h2 className="font-strong text-ink">{seatLabel(role, slot)}</h2>
            {occupant ? (
              <p className="text-ink">
                {occupant.label}
                {occupant.kind === 'bot' ? ' · AI' : ''}
              </p>
            ) : null}
            <p className="text-sm text-ink-muted">{status}</p>
          </li>
        );
      })}
    </ul>
  );
}
