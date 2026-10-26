'use client';

import type { CompetitionType } from '@daisy/protocol';
import type { Side } from '../../features/debate-room/documents/documents';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import { DRAWER_ID, DRAWER_TOGGLE_ID } from './drawer';
import { LeaveRoom, type LeaveLinks } from './leave-room';
import type { RoundSnapshot } from './round';

const chip =
  'inline-flex shrink-0 items-center rounded-round px-3 py-1 text-xs font-strong whitespace-nowrap';

const competitionName: Readonly<Record<CompetitionType, string>> = {
  ranked: 'Ranked',
  casual: 'Casual',
};

const sideChip: Readonly<
  Record<Side, { readonly label: string; readonly tone: string }>
> = {
  aff: { label: 'You’re Affirmative', tone: 'bg-hue-sky-soft text-hue-sky' },
  neg: { label: 'You’re Negative', tone: 'bg-hue-clay-soft text-hue-clay' },
};

function speechTone(index: number, live: number) {
  if (index === live) return 'bg-accent text-accent-ink';
  if (live >= 0 && index < live) return 'text-ink-faint';
  return 'border border-border-strong text-ink-muted';
}

function speechState(index: number, live: number) {
  if (index === live) return 'Now';
  if (live >= 0 && index < live) return 'Done';
  return null;
}

function drawerLabel(open: boolean, unread: number) {
  if (open) return 'Hide drawer';
  return unread > 0 ? `Show drawer, ${unread} unread in Chat` : 'Show drawer';
}

/**
 * The resolution, labelled, and the speech order: one disclosure, so the
 * whole statement and every speech's full name are a click away without
 * script.
 */
function RoundDetails({ round }: { readonly round: RoundSnapshot }) {
  return (
    <details className="group min-w-0 flex-1">
      <summary className="flex min-h-room-target min-w-0 cursor-pointer list-none items-center gap-2">
        <h1 className="flex min-w-0 items-baseline gap-2 font-display text-md">
          <span className="shrink-0 font-body text-xs font-bold tracking-wide text-ink-muted uppercase">
            Resolution
          </span>
          <span className="min-w-0 truncate">{round.resolution}</span>
        </h1>
        <Icon
          name="chevron-down"
          size={14}
          className="shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="absolute inset-x-0 top-full z-30 flex flex-wrap gap-6 border-b border-border bg-surface-raised px-6 py-5 shadow-2">
        <div className="flex min-w-0 grow basis-round-details flex-col gap-2">
          <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">
            Resolution
          </p>
          <p className="font-display text-xl leading-tight wrap-anywhere">
            {round.resolution}
          </p>
          <p className="text-sm text-ink-muted">
            The Affirmative argues for it; the Negative argues against it.
          </p>
        </div>
        <ol
          aria-label="Speech order"
          className="flex min-w-0 grow basis-round-speeches flex-col gap-1 text-sm"
        >
          {round.speeches.map((slot, index) => {
            const state = speechState(index, round.liveIndex);
            return (
              <li
                key={slot.id}
                aria-current={index === round.liveIndex ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-sm px-2 py-1',
                  index === round.liveIndex && 'bg-accent text-accent-ink',
                  state === 'Done' && 'text-ink-faint',
                )}
              >
                <span className="w-10 shrink-0 text-xs font-bold">
                  {slot.code}
                </span>
                <span className="flex-1">{slot.name}</span>
                {state ? <span className="text-xs">{state}</span> : null}
              </li>
            );
          })}
        </ol>
      </div>
    </details>
  );
}

/**
 * The round bar: drawer toggle, the labelled resolution, the speech the
 * round is on by its full name, the viewer's side, judge, recording, and
 * Leave round alone in the far corner. No app navigation in a round. A
 * room number (ISSUE-582) shows only once rounds carry one.
 */
export function RoundBar({
  round,
  roomNumber,
  drawerOpen,
  unread,
  onToggleDrawer,
  leave,
}: {
  readonly round: RoundSnapshot;
  readonly roomNumber?: number;
  readonly drawerOpen: boolean;
  readonly unread: number;
  readonly onToggleDrawer: () => void;
  readonly leave: LeaveLinks;
}) {
  const side = sideChip[round.self.side];
  return (
    <header className="relative flex min-h-round-bar shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1 max-narrow:gap-x-2">
      <button
        id={DRAWER_TOGGLE_ID}
        type="button"
        aria-label={drawerLabel(drawerOpen, unread)}
        aria-expanded={drawerOpen}
        aria-controls={DRAWER_ID}
        onClick={onToggleDrawer}
        className={cn(
          'relative flex size-room-target shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border max-narrow:hidden',
          drawerOpen && 'bg-surface-raised',
        )}
      >
        <Icon name="drawer" size={18} />
        {!drawerOpen && unread > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-4 rounded-round bg-live px-1 text-center text-xs font-bold text-background tabular-nums">
            {unread}
          </span>
        ) : null}
      </button>
      <div className="flex min-w-0 grow basis-round-title flex-col">
        <p className="truncate text-xs text-ink-muted max-narrow:hidden">
          {roomNumber === undefined ? null : `Room ${roomNumber} · `}
          {competitionName[round.competition]}
        </p>
        <RoundDetails round={round} />
      </div>
      <ol
        aria-label="Speeches"
        className="flex shrink-0 items-center gap-1 text-xs font-strong max-compact:hidden"
      >
        {round.speeches.map((slot, index) => (
          <li
            key={slot.id}
            aria-current={index === round.liveIndex ? 'step' : undefined}
            title={slot.name}
            className={cn(
              'rounded-sm px-2 py-1',
              speechTone(index, round.liveIndex),
            )}
          >
            {index === round.liveIndex
              ? `${slot.code} · ${slot.name}`
              : slot.code}
          </li>
        ))}
      </ol>
      <span className={cn(chip, side.tone)}>{side.label}</span>
      {round.judge ? (
        <span
          className={cn(
            chip,
            'border border-border-strong text-ink-muted max-narrow:hidden',
          )}
        >
          {round.judge === 'ai' ? 'AI judge' : 'Judge present'}
        </span>
      ) : null}
      {round.recording ? (
        round.phase === 'judging' ? (
          <span
            className={cn(chip, 'border border-border-strong text-ink-muted')}
          >
            Recording stopped
          </span>
        ) : (
          <span className={cn(chip, 'bg-live-soft text-live')}>
            ● Recording
          </span>
        )
      ) : null}
      <span className="flex">
        <LeaveRoom links={leave} />
      </span>
    </header>
  );
}
