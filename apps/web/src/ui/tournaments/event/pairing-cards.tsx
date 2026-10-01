import {
  formatTime,
  shiftMinutes,
  formatDay,
} from '../../../features/tournaments/dates';
import type { Pairing } from '../../../features/tournaments/event';
import { CHECK_IN_MINUTES } from '../../../features/tournaments/schedule';
import { Person } from '../person/person';

const card =
  'flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4';
const label = 'text-xs font-bold tracking-wider text-ink-faint uppercase';

/** Opponent, side, room and judge: everything the pairing fixed. */
export function PairingCards({ pairing }: { readonly pairing: Pairing }) {
  const { opponent } = pairing;
  return (
    <div className="grid grid-cols-2 gap-3 max-compact:grid-cols-1">
      <div className={card}>
        <p className={label}>Your opponent</p>
        <Person handle={opponent.handle} />
        <p className="text-sm text-ink-muted">{`Seed ${opponent.seed}, rating ${opponent.rating}`}</p>
      </div>
      <div className={card}>
        <p className={label}>Your side</p>
        <p className="text-md font-strong text-ink">{pairing.side}</p>
        <p className="text-sm text-ink-muted">Sides are set by the pairing</p>
      </div>
      <div className={card}>
        <p className={label}>Room and time</p>
        <p className="text-md font-strong text-ink">{pairing.room}</p>
        <p className="text-sm text-ink-muted">
          {`${formatDay(pairing.startsAt)}, ${formatTime(pairing.startsAt)} UTC. Room opens at ${formatTime(shiftMinutes(pairing.startsAt, -CHECK_IN_MINUTES))}.`}
        </p>
      </div>
      <div className={card}>
        <p className={label}>Your judge</p>
        <Person handle={pairing.judge} />
        <p className="text-sm text-ink-muted">
          Assigned by Daisy. Judges are chosen by the system after a conflict
          check. Their rating is hidden while they judge. You cannot pick or
          strike a judge.
        </p>
      </div>
    </div>
  );
}
