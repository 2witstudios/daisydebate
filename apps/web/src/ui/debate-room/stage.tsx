import { cn } from '../cn';
import type { Debater } from './round';

const sideName = { aff: 'Aff', neg: 'Neg' } as const;
const sideDisc = { aff: 'bg-hue-sky', neg: 'bg-hue-clay' } as const;

/** How much of a tile its occupant fills: a disc and a pill, or a caption. */
type Look = 'large' | 'medium' | 'small';

const discLook: Readonly<Record<Look, string>> = {
  large: 'size-room-disc text-3xl',
  medium: 'size-room-disc-md text-2xl',
  small: 'size-room-disc-sm text-md',
};

/** The pill naming a large tile's part in the phase. */
function FloorPill({
  state,
  side,
}: {
  readonly state: string;
  readonly side: Debater['side'];
}) {
  return (
    <span className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-round bg-scrim/60 px-2 py-1 text-xs font-strong max-narrow:hidden">
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-round',
          state === 'Speaking' ? 'bg-live' : sideDisc[side],
        )}
      />
      {state}
    </span>
  );
}

/** Name, side and rating; a small tile adds its part in the phase. */
function TileCaption({
  debater,
  you,
  state,
}: {
  readonly debater: Debater;
  readonly you: boolean;
  readonly state: string;
}) {
  return (
    <figcaption className="absolute bottom-2 left-3 flex items-baseline gap-1 text-sm whitespace-nowrap max-narrow:text-xs">
      <span className="font-strong">{you ? 'You' : debater.name}</span>
      <span className="text-stage-ink-muted">
        · {sideName[debater.side]}
        {state ? ` · ${state.toLowerCase()}` : ''}
      </span>
      {debater.rating === null ? null : (
        <span className="text-stage-ink-muted tabular-nums">
          {debater.rating}
        </span>
      )}
    </figcaption>
  );
}

export function Tile({
  debater,
  you,
  state,
  look,
  caption = false,
  className,
}: {
  readonly debater: Debater;
  readonly you: boolean;
  /** The debater's part in the phase ("Speaking"); '' for none. */
  readonly state: string;
  readonly look: Look;
  /** A small tile names the state in its caption instead of a pill. */
  readonly caption?: boolean;
  readonly className: string;
}) {
  const name = you ? `${debater.name}, you` : debater.name;
  return (
    <figure
      aria-label={state ? `${name}, ${state.toLowerCase()}` : name}
      aria-current={state ? 'true' : undefined}
      className={cn(
        'relative m-0 flex min-w-0 items-center justify-center overflow-hidden rounded-xl bg-surface-stage text-stage-ink max-narrow:h-room-phone-tile max-narrow:w-auto max-narrow:rounded-md',
        state && 'ring-3 ring-stage-accent ring-inset',
        className,
      )}
    >
      {caption ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-round font-display text-background max-narrow:hidden',
            discLook[look],
            sideDisc[debater.side],
          )}
        >
          {debater.initials}
        </span>
      )}
      {state && !caption ? (
        <FloorPill state={state} side={debater.side} />
      ) : null}
      <TileCaption debater={debater} you={you} state={caption ? state : ''} />
    </figure>
  );
}
