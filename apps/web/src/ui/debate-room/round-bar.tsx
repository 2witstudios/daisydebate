'use client';

import type { CompetitionType } from '@daisy/protocol';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import { DRAWER_ID, DRAWER_TOGGLE_ID } from './drawer';
import { LeaveRoom, type LeaveLinks } from './leave-room';
import type { RoundSnapshot } from './round';

const chip =
  'inline-flex shrink-0 items-center rounded-round px-3 py-1 text-xs font-strong whitespace-nowrap';

const kindChip: Readonly<
  Record<CompetitionType, { readonly label: string; readonly tone: string }>
> = {
  ranked: { label: 'Ranked', tone: 'bg-gold-soft text-gold' },
  practice: {
    label: 'Practice',
    tone: 'border border-border-strong text-ink-muted',
  },
  casual: {
    label: 'Casual',
    tone: 'border border-border-strong text-ink-muted',
  },
};

function speechTone(index: number, live: number) {
  if (index === live) return 'bg-accent text-accent-ink';
  if (live >= 0 && index < live) return 'text-ink-faint';
  return 'border border-border-strong text-ink-muted';
}

function drawerLabel(open: boolean, unread: number) {
  if (open) return 'Hide drawer';
  return unread > 0 ? `Show drawer, ${unread} unread in Chat` : 'Show drawer';
}

/**
 * The round bar: drawer toggle, kind, motion, speeches, judge, recording,
 * and Leave alone in the far corner. No app navigation in a round.
 */
export function RoundBar({
  round,
  drawerOpen,
  unread,
  onToggleDrawer,
  leave,
}: {
  readonly round: RoundSnapshot;
  readonly drawerOpen: boolean;
  readonly unread: number;
  readonly onToggleDrawer: () => void;
  readonly leave: LeaveLinks;
}) {
  const kind = kindChip[round.competition];
  return (
    <header className="flex min-h-round-bar shrink-0 items-center gap-3 border-b border-border px-4 py-1 max-narrow:gap-2">
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
      {round.recording ? (
        round.phase === 'judging' ? (
          <span
            className={cn(
              chip,
              'border border-border-strong text-ink-muted narrow:order-last',
            )}
          >
            Rec stopped
          </span>
        ) : (
          <span
            className={cn(chip, 'bg-live-soft text-live narrow:order-last')}
          >
            ● Rec
          </span>
        )
      ) : null}
      <span className={cn(chip, kind.tone, 'max-narrow:hidden')}>
        {kind.label}
      </span>
      <h1 className="min-w-0 flex-1 truncate font-display text-md">
        {round.resolution}
      </h1>
      <ol
        aria-label="Speeches"
        className="flex shrink-0 gap-1 text-xs font-strong max-compact:hidden"
      >
        {round.speeches.map((slot, index) => (
          <li
            key={slot.id}
            aria-current={index === round.liveIndex ? 'step' : undefined}
            className={cn(
              'rounded-sm px-2 py-1',
              speechTone(index, round.liveIndex),
            )}
          >
            {slot.code}
          </li>
        ))}
      </ol>
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
      <span className="order-last flex">
        <LeaveRoom links={leave} />
      </span>
    </header>
  );
}
