import {
  affirmativeSide,
  twoSideKeys,
  type TwoSideKey,
} from '@daisy/protocol/seats';
import { isNamedSeat, type RoundView } from '@daisy/protocol/round-view';
import { sideName } from '../../features/debate-room/seat-names';

type Sides = NonNullable<NonNullable<RoundView['opening']>['sides']>;
type Debater = Extract<RoundView['participants'][number], { actorId: string }>;

/** A team side's text tone, in the two-sided preset's order (sky, then clay). */
const sideText: Readonly<Record<TwoSideKey, string>> = {
  [twoSideKeys[0]]: 'text-hue-sky',
  [twoSideKeys[1]]: 'text-hue-clay',
};
const sideOf = (seat: Debater): TwoSideKey | null =>
  seat.seat.kind === 'side' &&
  (twoSideKeys as readonly string[]).includes(seat.seat.side)
    ? (seat.seat.side as TwoSideKey)
    : null;

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
    .filter((seat) => sideOf(seat) !== null)
    .sort((a, b) => a.seat.slot - b.seat.slot);
  const wasOpen = new Set(sides.moved.map((m) => m.participantId));
  const onSide = (side: TwoSideKey) =>
    debaters.filter((seat) => sideOf(seat) === side);
  const named = (side: TwoSideKey) => sideName(view.rules.sides, side);
  const mine = debaters.find((seat) => seat.actorId === actorId);
  const mySide = mine ? sideOf(mine) : null;
  const affirmative = onSide(affirmativeSide).map((seat) => seat.label);
  const headline = mySide
    ? `You're ${named(mySide)}`
    : affirmative.length > 0
      ? `${affirmative.join(' and ')} ${affirmative.length > 1 ? 'are' : 'is'} ${named(affirmativeSide)}`
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
          className={`font-display text-xl font-semibold ${mySide ? sideText[mySide] : ''}`}
        >
          {headline ?? 'Sides'}
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {twoSideKeys.map((side) => (
          <div
            key={side}
            className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-raised p-3"
          >
            <h3 className={`text-sm font-semibold ${sideText[side]}`}>
              {named(side)}
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
              {onSide(side).map((seat) => (
                <li key={seat.id} className="flex flex-col">
                  <span className="font-strong wrap-anywhere">
                    {seat.label}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {speakerLabel(seat.seat.slot)}
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
