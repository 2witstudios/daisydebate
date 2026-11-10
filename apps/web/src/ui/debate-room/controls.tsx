'use client';

import { startSpeechLabel } from '../../features/debate-room/vocabulary';
import type { LocalPublication } from '../../features/round-media/model/media-publication';
import type { ReactNode } from 'react';
import { formatCountdown } from '../../lib/clock-display';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import type { RoundSnapshot } from './round';
import { RoundClock } from './round-clock';

const button =
  'inline-flex h-room-target shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm border px-4 text-sm font-strong whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60';
const quiet = `${button} border-border-strong bg-transparent text-ink hover:bg-surface-raised`;
const primary = `${button} border-transparent bg-accent text-accent-ink hover:bg-accent-strong`;

const sideInk = { aff: 'text-hue-sky', neg: 'text-hue-clay' } as const;
const sideName = { aff: 'Affirmative', neg: 'Negative' } as const;

type Props = {
  readonly round: RoundSnapshot;
  readonly actions?: ReactNode;
};

/**
 * Snapshot-only previews have no command authority. The live Round page
 * supplies its canonical command forms through the actions slot.
 */
function PhaseActions({
  round,
  wide = false,
}: {
  readonly round: RoundSnapshot;
  readonly wide?: boolean;
}) {
  const grow = wide ? 'flex-1 h-12 text-md' : '';
  if (round.phase === 'prep')
    return (
      <>
        <button type="button" disabled className={cn(primary, grow)}>
          {startSpeechLabel(round.speeches[round.liveIndex]?.name ?? 'speech')}
        </button>
      </>
    );
  if (round.phase === 'own-speech')
    return (
      <button type="button" disabled className={cn(primary, grow)}>
        End speech
      </button>
    );
  return null;
}

/**
 * Tech issue during the speeches, Report a problem while the ballots are
 * written. Neither has a backend yet (DEC-100): shown, never faked.
 */
function TechIssue({
  round,
  wide = false,
}: {
  readonly round: RoundSnapshot;
  readonly wide?: boolean;
}) {
  return (
    <button type="button" disabled className={cn(quiet, wide && 'h-12')}>
      {round.phase === 'judging' ? 'Report a problem' : 'Tech issue'}
    </button>
  );
}

/** Both sides' prep left, until the speeches end. */
function PrepClocks({ round }: { readonly round: RoundSnapshot }) {
  const prep = round.prepMs;
  if (!prep || round.phase === 'judging') return null;
  return (
    <span className="text-sm text-ink-muted tabular-nums">
      Your prep{' '}
      <strong className={sideInk[round.self.side]}>
        {formatCountdown(prep[round.self.side])}
      </strong>{' '}
      · {sideName[round.opponent.side]} prep{' '}
      <strong className={sideInk[round.opponent.side]}>
        {formatCountdown(prep[round.opponent.side])}
      </strong>
    </span>
  );
}

const idleLabel = (round: RoundSnapshot) => {
  if (round.phase !== 'judging') return 'Live';
  return round.judge ? 'Judging' : 'Finished';
};

function MainClock({ round }: { readonly round: RoundSnapshot }) {
  const { clock } = round;
  const center =
    'flex flex-col items-center leading-tight max-compact:items-end';
  if (!clock)
    return (
      <div className={center}>
        <span className="text-xs font-strong tracking-wider text-ink-muted uppercase">
          {idleLabel(round)}
        </span>
      </div>
    );
  return (
    <>
      <RoundClock
        label={clock.label}
        remainingMs={clock.remainingMs}
        className={center}
      />
      {clock.note ? (
        <p className="text-xs text-ink-muted">{clock.note}</p>
      ) : null}
    </>
  );
}

const micState: Record<
  Exclude<LocalPublication, null>,
  readonly [label: string, tinted: boolean]
> = {
  published: ['Mic live', true],
  muted: ['Mic muted', false],
  ill: ['Mic reconnecting', false],
  disconnected: ['Mic not connected', false],
  absent: ['Mic not captured', false],
};

/**
 * Three columns: the mic the server controls and both prep clocks; the
 * clock; the phase action and Tech issue. No Mute.
 */
export function RoundControls({
  round,
  actions,
  publication = null,
}: Props & {
  /** This device's actual microphone; null until a media session reports. */
  readonly publication?: LocalPublication;
}) {
  // Before a client media session reports, the seat's server grant is all
  // that is known: the label keeps carrying that phase-derived permission,
  // not capture health. A released connection matters only to a seat whose
  // turn it is; a seat without the floor has no microphone to lose.
  const released = publication === 'ill' || publication === 'disconnected';
  const shown = released && !round.micLive ? null : publication;
  const micLabel =
    shown === null
      ? round.micLive
        ? ('Mic permitted' as const)
        : ('Mic closed' as const)
      : micState[shown][0];
  const micTinted = shown === null ? false : micState[shown][1];
  return (
    <nav
      aria-label="Round controls"
      className="room-controls min-w-0 flex-1 max-compact:flex-none"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-round px-3 py-1 text-sm font-strong',
            micTinted
              ? 'bg-live-soft text-live'
              : 'bg-surface-raised text-ink-muted',
          )}
        >
          <Icon name="mic" size={14} />
          {micLabel}
        </span>
        <PrepClocks round={round} />
      </div>
      <MainClock round={round} />
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 max-compact:hidden">
        {actions ?? <PhaseActions round={round} />}
        <TechIssue round={round} />
      </div>
    </nav>
  );
}

/** A phone's actions, above its round tabs. */
export function PhoneActions(props: Props) {
  return (
    <div className="flex shrink-0 flex-wrap gap-2 border-t border-border bg-surface-raised px-4 py-2 compact:hidden">
      <TechIssue round={props.round} wide />
      {props.actions ?? <PhaseActions round={props.round} wide />}
    </div>
  );
}
