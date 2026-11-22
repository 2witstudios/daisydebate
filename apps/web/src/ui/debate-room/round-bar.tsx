'use client';

import type { CompetitionType } from '@daisy/protocol/round';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import { LeaveRoom, type LeaveLinks } from './leave-room';
import type { RoundSnapshot } from './round';
import { toneChip } from './side-tone';
import { allDone, speechPosition, speechWindow } from './speech-window';

const chip =
  'inline-flex shrink-0 items-center rounded-round px-3 py-1 text-xs font-strong whitespace-nowrap';

const competitionName: Readonly<Record<CompetitionType, string>> = {
  ranked: 'Ranked',
  casual: 'Casual',
};

function speechState(index: number, live: number) {
  if (index === live) return 'Now';
  if (live >= 0 && index < live) return 'Done';
  return null;
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

const counter =
  'round-speech-wide shrink-0 items-center gap-1 px-1 text-ink-muted';

/**
 * Where the round is, in a strip that fits any width and any format: the
 * live speech by its full name and the next by its code, with counts for
 * the rest (speech-window.ts). Its own width, as a container, decides what
 * shows; the full order is the Speech order disclosure.
 */
function SpeechStrip({ round }: { readonly round: RoundSnapshot }) {
  const strip = speechWindow(round.speeches.length, round.liveIndex);
  const live = strip.live === null ? null : round.speeches[strip.live];
  const over = allDone(strip);
  return (
    <div className="@container/round-speeches flex min-w-0 grow basis-round-speech-strip items-center">
      <ol
        aria-label="Speeches"
        className="flex min-w-0 items-center gap-1 text-xs font-strong"
      >
        {strip.done > 0 && !over ? (
          <li className={counter}>
            <Icon name="check" size={12} />
            {strip.done}
            <span className="sr-only"> done</span>
          </li>
        ) : null}
        {live ? (
          <li
            aria-current="step"
            title={`${live.code} · ${live.name}`}
            className="min-w-0 truncate rounded-sm bg-accent px-2 py-1 text-accent-ink"
          >
            {`${live.code} · ${live.name}`}
          </li>
        ) : null}
        {strip.upcoming.map((index) => {
          const slot = round.speeches[index]!;
          return (
            <li
              key={slot.id}
              title={slot.name}
              className="round-speech-wide shrink-0 rounded-sm border border-border-strong px-2 py-1 text-ink-muted"
            >
              {slot.code}
            </li>
          );
        })}
        {strip.remaining > 0 ? (
          <li className={counter}>
            +{strip.remaining}
            <span className="sr-only"> more</span>
          </li>
        ) : null}
        <li
          className={cn(
            'shrink-0 px-1 text-ink-muted',
            over ? 'flex items-center gap-1' : 'round-speech-narrow',
          )}
        >
          {over ? <Icon name="check" size={12} /> : null}
          {speechPosition(strip)}
        </li>
      </ol>
    </div>
  );
}

/**
 * The round bar: the labelled resolution, the speech the
 * round is on by its full name, the viewer's side, judge, and
 * Leave round alone in the far corner. No app navigation in a round. A
 * room number (ISSUE-582) shows only once rounds carry one.
 */
export function RoundBar({
  round,
  roomNumber,
  leave,
}: {
  readonly round: RoundSnapshot;
  readonly roomNumber?: number;
  readonly leave: LeaveLinks;
}) {
  const side = {
    label: `You’re ${round.self.sideLabel}`,
    tone: toneChip[round.self.tone],
  };
  return (
    <header className="relative flex min-h-round-bar shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1 max-narrow:gap-x-2">
      <div className="flex min-w-0 grow basis-round-title flex-col">
        <p className="truncate text-xs text-ink-muted max-narrow:hidden">
          {roomNumber === undefined ? null : `Room ${roomNumber} · `}
          {competitionName[round.competition]}
        </p>
        <RoundDetails round={round} />
      </div>
      <SpeechStrip round={round} />
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
      <span className="flex">
        <LeaveRoom links={leave} />
      </span>
    </header>
  );
}
