import type { LayoutPreset } from '../../features/debate-room/layout';
import {
  floorStates,
  speakerIsSelf,
  upNext,
} from '../../features/debate-room/stage';
import { cn } from '../cn';
import type { Debater, RoundSnapshot } from './round';

export const sideName = { aff: 'Aff', neg: 'Neg' } as const;
const sideDisc = { aff: 'bg-hue-sky', neg: 'bg-hue-clay' } as const;

/** How much of a tile its occupant fills: a disc and a pill, or a caption. */
type Look = 'large' | 'medium' | 'small';

export const discLook: Readonly<Record<Look, string>> = {
  large: 'size-room-disc text-3xl',
  medium: 'size-room-disc-md text-2xl',
  small: 'size-room-disc-sm text-md',
};

/** The video band: its height is the room's video size (room.css). */
export const band =
  'room-video-band flex shrink-0 gap-3 border-b border-border bg-surface-sunken px-4 py-3 max-narrow:gap-2 max-narrow:border-b-0 max-narrow:bg-transparent max-narrow:pt-0 max-narrow:pb-2';
/** A phone shows both debaters as two small tiles. */
const phonePair = 'max-narrow:grid max-narrow:grid-cols-2';

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

/** Next and Then: what follows the live speech, beside the speaker. */
function UpNext({ round }: { readonly round: RoundSnapshot }) {
  const firstName = round.opponent.name.split(/\s+/)[0] ?? round.opponent.name;
  return (
    <dl className="m-0 flex flex-col gap-2 rounded-lg border border-border px-4 py-3 text-sm max-narrow:hidden">
      {upNext(round.speeches, round.liveIndex, round.self.side, firstName).map(
        (line) => (
          <div key={line.label} className="flex justify-between gap-3">
            <dt className="text-ink-faint">{line.label}</dt>
            <dd className="m-0 font-strong">{line.text}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

export type StageProps = {
  readonly round: RoundSnapshot;
  readonly preset: LayoutPreset;
};

/** The speaker large; your own view small beside it, over Next and Then. */
function SpeakerBand({ round }: { readonly round: RoundSnapshot }) {
  const states = floorStates(round.phase);
  const selfSpeaks = speakerIsSelf(round.phase);
  const speaker = selfSpeaks ? round.self : round.opponent;
  const other = selfSpeaks ? round.opponent : round.self;
  return (
    <section aria-label="Debaters" className={cn(band, phonePair)}>
      <Tile
        debater={speaker}
        you={selfSpeaks}
        state={selfSpeaks ? states.self : states.opponent}
        look="large"
        className="aspect-video h-full shrink"
      />
      <div className="flex h-full min-w-0 flex-1 flex-col gap-3 max-narrow:contents">
        <Tile
          debater={other}
          you={!selfSpeaks}
          state={selfSpeaks ? states.opponent : states.self}
          look="small"
          className="h-1/2 w-full"
        />
        <UpNext round={round} />
      </div>
    </section>
  );
}

const pairLook: Readonly<
  Record<Exclude<LayoutPreset, 'speaker'>, { look: Look; tile: string }>
> = {
  stage: {
    look: 'large',
    tile: 'aspect-video h-full max-w-1/2 shrink max-narrow:max-w-none',
  },
  conversation: {
    look: 'medium',
    tile: 'aspect-video h-full max-w-1/2 shrink max-narrow:max-w-none',
  },
  focus: { look: 'small', tile: 'aspect-video h-full shrink' },
};

/** Both debaters side by side, Aff on the left. */
function PairBand({
  round,
  preset,
}: StageProps & { readonly preset: Exclude<LayoutPreset, 'speaker'> }) {
  const states = floorStates(round.phase);
  const { look, tile } = pairLook[preset];
  const pair =
    round.self.side === 'aff'
      ? [round.self, round.opponent]
      : [round.opponent, round.self];
  return (
    <section
      aria-label="Debaters"
      className={cn(band, phonePair, preset === 'stage' && 'justify-center')}
    >
      {pair.map((debater) => {
        const you = debater.id === round.self.id;
        return (
          <Tile
            key={debater.id}
            debater={debater}
            you={you}
            state={you ? states.self : states.opponent}
            look={look}
            caption={preset === 'focus'}
            className={tile}
          />
        );
      })}
    </section>
  );
}

/**
 * The debaters as the layout arranges them; the judge has no tile. Video
 * tiles show initials until media arrives (ADR 0053).
 */
export function VideoStage({ round, preset }: StageProps) {
  if (preset === 'speaker') return <SpeakerBand round={round} />;
  return <PairBand round={round} preset={preset} />;
}
