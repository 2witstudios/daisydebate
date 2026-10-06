'use client';

import type { Dispatch } from 'react';
import {
  filterSections,
  formatOffset,
  liveSegmentId,
  type TranscriptSection,
} from '../../features/debate-room/transcript';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import type { RoomAction } from './room-state';

type Props = {
  readonly sections: readonly TranscriptSection[];
  readonly liveSpeechId: string | null;
  readonly filter: string;
  readonly dispatch: Dispatch<RoomAction>;
};

const sideInk = { aff: 'text-hue-sky', neg: 'text-hue-clay' } as const;

/** The round's transcript by speech, the line being spoken now lit. */
export function TranscriptView({
  sections,
  liveSpeechId,
  filter,
  dispatch,
}: Props) {
  const live = liveSegmentId(sections, liveSpeechId);
  const filters = [
    { id: 'all', code: 'All' },
    ...sections.map((s) => ({ id: s.speech.id, code: s.speech.code })),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-raised">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            className={cn(
              'h-6 cursor-pointer rounded-round border px-3 text-xs font-strong',
              filter === f.id
                ? 'border-transparent bg-surface-overlay text-ink'
                : 'border-border text-ink-muted',
            )}
            onClick={() =>
              dispatch({ type: 'transcript/filter', speechId: f.id })
            }
          >
            {f.code}
          </button>
        ))}
        {liveSpeechId ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-strong text-live">
            <span className="size-2 rounded-round bg-live" />
            Live
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {filterSections(sections, filter).map((section) => (
          <section key={section.speech.id} className="pt-2">
            <h3
              className={cn(
                'mb-1 text-sm font-strong',
                sideInk[section.speech.side],
              )}
            >
              {section.speech.code} · {section.speakerName}
            </h3>
            <ol className="flex flex-col">
              {section.segments.map((segment) => (
                <li
                  key={segment.id}
                  className={cn(
                    'flex items-start gap-2 rounded-sm px-2 py-1 text-sm',
                    segment.id === live
                      ? 'bg-surface-overlay text-ink'
                      : 'text-ink-muted',
                  )}
                >
                  <span className="w-10 shrink-0 pt-px text-xs text-ink-faint tabular-nums">
                    {formatOffset(segment.offsetMs)}
                  </span>
                  <span className="flex-1">{segment.text}</span>
                  <button
                    type="button"
                    aria-label="Add to Flow"
                    className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border text-hue-teal"
                  >
                    <Icon name="plus" size={13} />
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
