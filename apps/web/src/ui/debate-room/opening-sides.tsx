import {
  debateSides,
  isNamedSeat,
  type DebateSide,
  type RoundView,
} from '@daisy/protocol';
import { sideName } from '../../features/round-runtime/round-reading';

type Sides = NonNullable<NonNullable<RoundView['opening']>['sides']>;

const sideText: Readonly<Record<DebateSide, string>> = {
  affirmative: 'text-hue-sky',
  negative: 'text-hue-clay',
};

const ordinals = ['1st', '2nd', '3rd'];
/** A seat's speaking position, from its zero-based slot. */
export const speakerLabel = (slot: number) =>
  `${ordinals[slot] ?? `${slot + 1}th`} speaker`;

/**
 * The sides result (ADR 0145), first in the opening and for everyone: who
 * argues each side, at which speaking position, and which seats were open.
 * Shown alongside the opening, never ahead of it: it times nothing.
 */
export function OpeningSides({
  view,
  sides,
  actorId,
}: {
  readonly view: RoundView;
  readonly sides: Sides;
  readonly actorId: string;
}) {
  if (sides.coin === null && sides.moved.length === 0) return null;
  const debaters = view.participants
    .filter(isNamedSeat)
    .filter(
      (seat): seat is typeof seat & { role: DebateSide } =>
        seat.role !== 'judge',
    )
    .sort((a, b) => a.slot - b.slot);
  const wasOpen = new Set(sides.moved.map((m) => m.participantId));
  const onSide = (side: DebateSide) =>
    debaters.filter((seat) => seat.role === side);
  const mine = debaters.find((seat) => seat.actorId === actorId);
  const affirmative = onSide('affirmative').map((seat) => seat.label);
  const headline = mine
    ? `You're ${sideName[mine.role]}`
    : affirmative.length > 0
      ? `${affirmative.join(' and ')} ${affirmative.length > 1 ? 'are' : 'is'} Affirmative`
      : null;
  return (
    <section
      aria-labelledby="opening-sides-title"
      className="flex flex-col gap-3 px-4 py-2"
    >
      <div className="flex flex-col gap-1">
        {sides.coin !== null ? (
          <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">
            Coin flip
          </p>
        ) : null}
        <h2
          id="opening-sides-title"
          className={`font-display text-xl font-semibold ${mine ? sideText[mine.role] : ''}`}
        >
          {headline ?? 'Sides'}
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {debateSides.map((side) => (
          <div
            key={side}
            className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-raised p-3"
          >
            <h3 className={`text-sm font-semibold ${sideText[side]}`}>
              {sideName[side]}
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
              {onSide(side).map((seat) => (
                <li key={seat.id} className="flex flex-col">
                  <span className="font-strong wrap-anywhere">
                    {seat.label}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {speakerLabel(seat.slot)}
                    {wasOpen.has(seat.id) ? ' · was ?' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
