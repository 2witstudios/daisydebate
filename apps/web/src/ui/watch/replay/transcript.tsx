import Link from 'next/link';
import {
  replayHiddenFields,
  replayQueryHref,
  type ReplayQuery,
} from '../../../features/watch/replay-query';
import type { ReplayView } from '../../../features/watch/replay-build';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { controlClass } from '../../lobby/filter-bar/filter-bar-class';
import { MAX_SEARCH_LENGTH } from '../../../features/watch/live-query';

export type TranscriptProps = {
  readonly id: string;
  readonly query: ReplayQuery;
  readonly transcript: ReplayView['transcript'];
};

/** The transcript: search and jump as one GET form, each turn a link to it. */
export function Transcript({ id, query, transcript }: TranscriptProps) {
  return (
    <section aria-label="Transcript" className="flex flex-col gap-3">
      <h2 className="text-md font-strong text-ink">Transcript</h2>
      <form
        method="get"
        role="search"
        aria-label="Search the transcript"
        className="flex flex-wrap items-center gap-3"
      >
        {replayHiddenFields(query, ['q', 't']).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label
          className={cn(
            controlClass,
            'flex grow basis-1/4 items-center gap-2 text-ink-muted',
          )}
        >
          <Icon name="search" size={16} />
          <input
            type="search"
            name="q"
            defaultValue={transcript.q}
            maxLength={MAX_SEARCH_LENGTH}
            placeholder="Search the transcript"
            aria-label="Search the transcript"
            className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
          />
        </label>
        <select
          name="t"
          aria-label="Jump to a phase"
          defaultValue={String(transcript.jumpValue)}
          className={controlClass}
        >
          {transcript.jump.map((option) => (
            <option key={option.value} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass('secondary')}>
          Apply
        </button>
      </form>
      <ol
        tabIndex={0}
        aria-label="Turns"
        className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface shadow-1"
      >
        {transcript.rows.map((row) => (
          <li key={row.stamp}>
            <Link
              href={row.href}
              aria-current={row.current ? 'true' : undefined}
              className={cn(
                'flex gap-4 p-4 no-underline hover:no-underline',
                row.current && 'bg-accent-soft',
              )}
            >
              <span className="w-10 shrink-0 text-sm text-ink-faint tabular-nums">
                {row.stamp}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm">
                  <b className="text-ink">{row.speaker}</b>
                  <span className="text-ink-faint">{` ${row.phaseName}`}</span>
                </span>
                <span className="text-base text-ink-muted">{row.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {transcript.rows.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 text-base text-ink-muted">
          Nothing in this transcript matches.
          <Link
            href={replayQueryHref(id, { ...query, q: '' })}
            className="font-strong"
          >
            Clear search
          </Link>
        </div>
      ) : null}
    </section>
  );
}
