'use client';
import { useCallback, useEffect, useState } from 'react';
import type { RoundTranscriptRead } from '@daisy/protocol';
import { browserSyncEdges } from '../../features/resource-sync/browser';
import { readTranscript } from '../../features/round-runtime/read-transcript';
import { createTranscriptHolder } from '../../features/round-runtime/transcript-sync';
import { useResourceSync } from '../resource-sync/use-resource-sync';
import { liveTranscriptSections, transcriptState } from './result-view';
import {
  TranscriptContent,
  transcriptStatusLabels as labels,
} from './transcript-content';

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
}: {
  readonly seed: RoundTranscriptRead;
  readonly socketUrl: string | null;
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
  if (synced.freshness === 'gone') return null;
  return (
    <section
      aria-labelledby="live-transcript"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="live-transcript" className="font-strong">
          Transcript
        </h2>
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
      </div>
      <TranscriptContent
        sections={liveTranscriptSections(synced.value)}
        empty="No speech was captured yet."
      />
    </section>
  );
}
