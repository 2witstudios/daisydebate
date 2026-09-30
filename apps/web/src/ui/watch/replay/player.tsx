import Link from 'next/link';
import {
  replayHiddenFields,
  type ReplayQuery,
} from '../../../features/watch/replay-query';
import type { ReplayView } from '../../../features/watch/replay-build';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { controlClass } from '../../lobby/filter-bar/filter-bar-class';
import { PlayToggle } from './play-toggle';

export type PlayerProps = {
  readonly view: ReplayView;
};

const step = cn(buttonClass('secondary'), 'no-underline hover:no-underline');

function HiddenFields({ query }: { query: ReplayQuery }) {
  return replayHiddenFields(query, ['t', 'speed']).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
}

/**
 * The replay player: the turn being played, step links, play/pause and one
 * GET form for the position and speed, so it is usable with no script.
 */
export function Player({ view }: PlayerProps) {
  const { player, query } = view;
  return (
    <section
      aria-label="Replay"
      className="flex flex-col gap-4 rounded-xl bg-surface-stage p-6 text-stage-ink shadow-2 max-compact:p-4"
    >
      <div className="flex items-center justify-between text-sm text-stage-ink-muted">
        <span>Now playing</span>
        <span>{`Turn ${player.turnNumber} of ${player.turnCount}`}</span>
      </div>
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-round bg-stage-accent font-bold text-stage-accent-ink"
        >
          {player.letter}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-base">
            <b>{player.speaker}</b>
            <span className="text-stage-ink-muted">{` ${player.seat}, ${player.phaseName}`}</span>
          </span>
          <p className="text-md">{player.text}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={player.nav.prevPhase}
          aria-label="Previous phase"
          className={step}
        >
          «
        </Link>
        <Link
          href={player.nav.prevTurn}
          aria-label="Previous turn"
          className={step}
        >
          ‹
        </Link>
        <PlayToggle tickHref={player.tickHref} tickMs={player.tickMs} />
        <Link
          href={player.nav.nextTurn}
          aria-label="Next turn"
          className={step}
        >
          ›
        </Link>
        <Link
          href={player.nav.nextPhase}
          aria-label="Next phase"
          className={step}
        >
          »
        </Link>
        <span className="ml-auto text-sm text-stage-ink-muted tabular-nums">
          {`${player.positionLabel} / ${player.totalLabel}`}
        </span>
      </div>
      <form
        method="get"
        className="flex flex-wrap items-center gap-3"
        aria-label="Position and speed"
      >
        <HiddenFields query={query} />
        <label htmlFor="scrub" className="sr-only">
          Position in the debate
        </label>
        <input
          id="scrub"
          type="range"
          name="t"
          min={0}
          max={player.total}
          step={1}
          defaultValue={player.position}
          className="min-w-0 flex-1"
        />
        <select
          name="speed"
          aria-label="Playback speed"
          defaultValue={player.speed}
          className={controlClass}
        >
          {player.speeds.map((speed) => (
            <option key={speed.value} value={speed.value}>
              {speed.label}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass('secondary')}>
          Go
        </button>
      </form>
    </section>
  );
}
