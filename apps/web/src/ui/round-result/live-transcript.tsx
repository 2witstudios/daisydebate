'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { LiveTranscriptRead } from '@daisy/protocol';
import { browserSyncEdges } from '../../features/resource-sync/browser';
import { readTranscript } from '../../features/round-runtime/read-transcript';
import { createTranscriptHolder } from '../../features/round-runtime/transcript-sync';
import { useResourceSync } from '../resource-sync/use-resource-sync';
import { liveTranscriptSections, transcriptState } from './result-view';
import {
  TranscriptContent,
  TranscriptSections,
  transcriptStatusLabels as labels,
} from './transcript-content';
import { TranscriptFollow } from './transcript-follow';

/**
 * Authorized data only: this component has no reader identity or seat
 * assumption. One driver holds a Round's transcript for as long as the page
 * shows it, reading the HTTP route, which survives a web deploy as a build's
 * server actions do not; a changed contract asks for a reload. A later server render's seed is offered to
 * it and never replaces newer text.
 */
export function LiveTranscript({
  seed,
  socketUrl,
  placement = 'card',
}: {
  readonly seed: LiveTranscriptRead;
  readonly socketUrl: string | null;
  /** A page card behind a disclosure, or always open in the Round sidebar. */
  readonly placement?: 'card' | 'sidebar';
}) {
  const roundId = seed.round.id;
  const [holder] = useState(() =>
    createTranscriptHolder(seed, () =>
      readTranscript(window.fetch.bind(window), roundId),
    ),
  );
  const start = useCallback(
    () => holder.start(browserSyncEdges(socketUrl)),
    [holder, socketUrl],
  );
  const [synced, driver] = useResourceSync(holder.seed, start);
  useEffect(() => holder.offer(seed), [holder, seed]);
  // Whatever rendered this page may be old: durable history decides.
  useEffect(() => driver?.signal(), [driver]);
  if (synced.freshness === 'gone')
    return placement === 'sidebar' ? (
      <p role="status" className="p-4 text-sm text-ink-muted">
        Transcript unavailable.
      </p>
    ) : null;
  const sections = liveTranscriptSections(synced.value);
  const status: ReactNode = (
    <div role="status" className="flex gap-2 text-sm text-ink-muted">
      <p>{labels[transcriptState(synced.value)]}</p>
      {synced.freshness !== 'stale' ? null : holder.outdated() ? (
        <button
          type="button"
          className="cursor-pointer font-strong underline"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      ) : (
        <p>Reconnecting</p>
      )}
    </div>
  );
  if (placement === 'sidebar')
    return (
      <section
        aria-labelledby="live-transcript"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
          <h2 id="live-transcript" className="sr-only">
            Transcript
          </h2>
          {status}
        </div>
        <TranscriptFollow>
          {sections.length ? (
            <TranscriptSections sections={sections} />
          ) : (
            <p className="pt-3 text-sm text-ink-muted">
              No speech was captured yet.
            </p>
          )}
        </TranscriptFollow>
      </section>
    );
  return (
    <section
      aria-labelledby="live-transcript"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="live-transcript" className="font-strong">
          Transcript
        </h2>
        {status}
      </div>
      <TranscriptContent
        sections={sections}
        empty="No speech was captured yet."
      />
    </section>
  );
}
