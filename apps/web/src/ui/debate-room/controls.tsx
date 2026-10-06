'use client';

import type { Dispatch } from 'react';
import {
  clockUrgency,
  formatClock,
  type ClockUrgency,
} from '../../features/debate-room/clock';
import {
  effectivePreset,
  type LayoutPreset,
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

const pill =
  'inline-flex h-10 cursor-pointer items-center gap-2 rounded-round border px-4 text-sm font-strong transition-colors';
const quiet = `${pill} border-border-strong bg-transparent text-ink-muted hover:text-ink`;
const primary = `${pill} border-transparent bg-accent text-accent-ink hover:bg-accent-strong`;

const sideInk = { aff: 'text-hue-sky', neg: 'text-hue-clay' } as const;

const endLabels = {
  idle: 'End speech',
  armed: 'Press again to end',
  ended: 'Speech ended',
} as const;

function PhaseActions({ round, state, dispatch }: Props) {
  if (round.phase === 'prep')
    return (
      <>
        <button type="button" className={quiet}>
          Save the rest
        </button>
        <button type="button" className={primary}>
          Start {round.speeches[round.liveIndex]?.code}
        </button>
      </>
    );
  if (round.phase !== 'own-speech') return null;
  return (
    <>
      <button
        type="button"
        disabled={state.endSpeech === 'ended'}
        onClick={() => dispatch({ type: 'end/press' })}
        className={cn(
          primary,
          state.endSpeech === 'armed' && 'bg-live hover:bg-live',
        )}
      >
        {endLabels[state.endSpeech]}
      </button>
      {state.endSpeech === 'armed' ? (
        <button
          type="button"
          className={quiet}
          onClick={() => dispatch({ type: 'end/cancel' })}
        >
          Keep speaking
        </button>
      ) : null}
    </>
  );
}

const presets: readonly LayoutPreset[] = ['stage', 'split', 'focus'];
const presetNames = {
  auto: 'Auto',
  stage: 'Stage',
  split: 'Split',
  focus: 'Focus',
} as const;

function LayoutGroup({ round, state, dispatch }: Props) {
  const shown = effectivePreset(state.layout, round.phase);
  const segment = (on: boolean, hinted: boolean) =>
    cn(
      'h-8 cursor-pointer rounded-sm px-2 text-sm font-strong transition-colors',
      on ? 'bg-surface-overlay text-ink' : 'text-ink-muted hover:text-ink',
      hinted && 'outline-1 outline-border-strong outline-dashed',
    );
  const panelButton = (open: boolean) =>
    cn(
      'flex size-8 cursor-pointer items-center justify-center rounded-sm',
      open ? 'bg-surface-overlay text-ink' : 'text-ink-faint',
    );
  return (
    <div
      role="group"
      aria-label="Layout"
      className="flex items-center gap-1 rounded-md border border-border bg-surface-sunken p-1"
    >
      <button
        type="button"
        aria-label="Files panel"
        aria-pressed={state.layout.treeOpen}
        className={panelButton(state.layout.treeOpen)}
        onClick={() => dispatch({ type: 'layout/panel', panel: 'tree' })}
      >
        <Icon name="panelLeftOpen" size={18} />
      </button>
      {(['auto', ...presets] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={state.layout.mode === mode}
          className={segment(
            state.layout.mode === mode,
            state.layout.mode === 'auto' && mode === shown,
          )}
          onClick={() => dispatch({ type: 'layout/mode', mode })}
        >
          {presetNames[mode]}
        </button>
      ))}
      <button
        type="button"
        aria-label="Sidebar"
        aria-pressed={state.layout.sidebarOpen}
        className={panelButton(state.layout.sidebarOpen)}
        onClick={() => dispatch({ type: 'layout/panel', panel: 'sidebar' })}
      >
        <Icon name="panelRightOpen" size={18} />
      </button>
    </div>
  );
}

type Props = {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
};

/** Mic and prep on the left, the clock centred and large, actions right. */
export function RoundControls({ round, state, dispatch }: Props) {
  const remaining = round.clock.remainingMs;
  return (
    <nav
      aria-label="Round controls"
      className="grid grid-cols-3 items-center gap-x-4 gap-y-2 bg-background px-3 py-1"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-round px-3 py-1 text-sm font-strong',
            round.micLive
              ? 'bg-live-soft text-live'
              : 'bg-surface-raised text-ink-faint',
          )}
        >
          <Icon name="mic" size={15} />
          {round.micLive ? 'Mic live' : 'Mic closed'}
        </span>
        <span className="text-sm text-ink-muted tabular-nums">
          Your prep{' '}
          <strong className={sideInk[round.self.side]}>
            {formatClock(round.prepMs[round.self.side])}
          </strong>{' '}
          · {round.opponent.side === 'aff' ? 'Aff' : 'Neg'} prep{' '}
          <strong className={sideInk[round.opponent.side]}>
            {formatClock(round.prepMs[round.opponent.side])}
          </strong>
        </span>
      </div>
      <div
        role="timer"
        aria-label={`${round.clock.label} ${formatClock(remaining)}`}
        className="flex flex-col items-center"
      >
        <span className="text-xs font-strong tracking-wider text-ink-muted uppercase">
          {round.clock.label}
        </span>
        <span
          className={cn(
            'font-display text-display-sm leading-display font-strong tabular-nums',
            urgencyInk[clockUrgency(remaining)],
          )}
        >
          {formatClock(remaining)}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <PhaseActions round={round} state={state} dispatch={dispatch} />
        <button type="button" className={quiet}>
          Tech issue
        </button>
        <button
          type="button"
          aria-label="Leave room"
          className="flex size-10 cursor-pointer items-center justify-center rounded-round border border-live text-live"
        >
          <Icon name="leave" size={18} />
        </button>
        <LayoutGroup round={round} state={state} dispatch={dispatch} />
      </div>
    </nav>
  );
}
