'use client';

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  clockMilestone,
  clockUrgency,
  formatClock,
  type ClockUrgency,
} from '../../features/debate-room/clock';
import {
  effectivePreset,
  layoutPresets,
  type LayoutMode,
} from '../../features/debate-room/layout';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import type { RoomAction, RoomState } from './room-state';
import type { RoundSnapshot } from './round';

const urgencyInk: Readonly<Record<ClockUrgency, string>> = {
  normal: 'text-ink',
  low: 'text-gold',
  critical: 'text-live',
  over: 'text-live',
};

const button =
  'inline-flex h-room-target shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm border px-4 text-sm font-strong whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60';
const quiet = `${button} border-border-strong bg-transparent text-ink hover:bg-surface-raised`;
const primary = `${button} border-transparent bg-accent text-accent-ink hover:bg-accent-strong`;

const sideInk = { aff: 'text-hue-sky', neg: 'text-hue-clay' } as const;
const sideName = { aff: 'Aff', neg: 'Neg' } as const;

type Props = {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
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
        <button type="button" disabled className={quiet}>
          Save the rest
        </button>
        <button type="button" disabled className={cn(primary, grow)}>
          Start {round.speeches[round.liveIndex]?.code}
        </button>
      </>
    );
  if (round.phase === 'own-speech')
    return (
      <button type="button" disabled className={cn(primary, grow)}>
        End speech
      </button>
    );
  if (round.phase === 'cross-ex')
    return (
      <button type="button" disabled className={cn(quiet, grow)}>
        Interrupt
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

const presetNames: Readonly<Record<LayoutMode, string>> = {
  auto: 'Auto',
  speaker: 'Speaker',
  stage: 'Stage',
  focus: 'Focus',
  conversation: 'Conversation',
};

/**
 * The video layout: Auto follows the phase; a preset, or resizing the
 * video, pins the preset shown. The sizes belong to the layout module.
 */
export function LayoutMenu({ round, state, dispatch }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const shown = effectivePreset(state.layout, round.phase);
  const label =
    state.layout.mode === 'auto'
      ? `Auto · ${presetNames[shown]}`
      : presetNames[state.layout.mode];
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
        ?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const key = (event: KeyboardEvent<HTMLUListElement>) => {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ) ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close();
    } else if (step !== undefined) {
      event.preventDefault();
      items[(at + step + items.length) % items.length]?.focus();
    }
  };
  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="round-layout-menu"
        aria-label={`Layout: ${label.replace(' · ', ', ')}`}
        onClick={() => setOpen(!open)}
        className={quiet}
      >
        {label}
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <ul
          ref={menu}
          id="round-layout-menu"
          role="menu"
          aria-label="Layout"
          onKeyDown={key}
          className="absolute right-0 bottom-full z-40 mb-2 flex w-room-menu flex-col rounded-md border border-border-strong bg-surface p-1 shadow-2"
        >
          {(['auto', ...layoutPresets] as const).map((mode) => (
            <li key={mode} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={state.layout.mode === mode}
                tabIndex={-1}
                className={cn(
                  'flex h-room-target w-full cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm hover:bg-surface-raised',
                  state.layout.mode === mode && 'font-strong',
                )}
                onClick={() => {
                  dispatch({ type: 'layout/mode', mode });
                  close();
                }}
              >
                <span className="w-4">
                  {state.layout.mode === mode ? (
                    <Icon name="check" size={14} />
                  ) : null}
                </span>
                {presetNames[mode]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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
        {formatClock(prep[round.self.side])}
      </strong>{' '}
      · {sideName[round.opponent.side]} prep{' '}
      <strong className={sideInk[round.opponent.side]}>
        {formatClock(prep[round.opponent.side])}
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
    'flex flex-col items-center leading-tight max-narrow:items-end';
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
      <div
        role="timer"
        aria-label={`${clock.label} ${formatClock(clock.remainingMs)}`}
        className={center}
      >
        <span className="text-xs font-strong tracking-wider text-ink-muted uppercase">
          {clock.label}
        </span>
        <span
          className={cn(
            'font-display text-3xl tabular-nums',
            urgencyInk[clockUrgency(clock.remainingMs)],
          )}
        >
          {formatClock(clock.remainingMs)}
        </span>
      </div>
      <p aria-live="polite" className="sr-only">
        {clockMilestone(clock.remainingMs)}
      </p>
    </>
  );
}

/**
 * Three columns: the mic the server controls and both prep clocks; the
 * clock; the phase action, Tech issue and the layout menu. No Mute.
 */
export function RoundControls({
  round,
  layout,
  actions,
}: Props & { readonly layout?: ReactNode }) {
  return (
    <nav
      aria-label="Round controls"
      className="grid min-h-round-controls shrink-0 grid-cols-3 items-center gap-4 border-y border-border px-4 py-2 max-narrow:grid-cols-2 max-narrow:border-y-0"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-round px-3 py-1 text-sm font-strong',
            round.micLive
              ? 'bg-live-soft text-live'
              : 'bg-surface-raised text-ink-muted',
          )}
        >
          <Icon name="mic" size={14} />
          {round.micLive ? 'Mic live' : 'Mic closed'}
        </span>
        <PrepClocks round={round} />
      </div>
      <MainClock round={round} />
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 max-narrow:hidden">
        {actions ?? <PhaseActions round={round} />}
        <TechIssue round={round} />
        {layout}
      </div>
    </nav>
  );
}

/** A phone's actions, above its round tabs. */
export function PhoneActions(props: Props) {
  return (
    <div className="flex shrink-0 gap-2 border-t border-border bg-surface-raised px-4 py-2 narrow:hidden">
      <TechIssue round={props.round} wide />
      {props.actions ?? <PhaseActions round={props.round} wide />}
    </div>
  );
}
