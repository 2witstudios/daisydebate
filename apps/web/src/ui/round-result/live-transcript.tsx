'use client';
import { useCallback } from 'react';
import type { RoundTranscriptRead } from '@daisy/protocol';
import type { ResourceRead } from '../../features/resource-sync/driver';
import { browserSyncEdges } from '../../features/resource-sync/browser';
import {
  createTranscriptSync,
  seedTranscript,
} from '../../features/round-runtime/transcript-sync';
import { useResourceSync } from '../resource-sync/use-resource-sync';
import { liveTranscriptSections, transcriptState } from './result-view';
import {
  TranscriptContent,
  transcriptStatusLabels as labels,
} from './transcript-content';

/** Authorized data only: this component has no reader identity or seat assumption. */
export function LiveTranscript({
  seed,
  read,
  socketUrl,
}: {
  readonly seed: RoundTranscriptRead;
  readonly read: () => Promise<ResourceRead<RoundTranscriptRead>>;
  readonly socketUrl: string | null;
}) {
  const start = useCallback(
    () =>
      createTranscriptSync({
        seed: seedTranscript(seed),
        read,
        ...browserSyncEdges(socketUrl),
      }),
    [seed, read, socketUrl],
  );
  const [synced] = useResourceSync(() => seedTranscript(seed), start);
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
        <p role="status" className="text-sm text-ink-muted">
          {synced.freshness === 'stale'
            ? 'Reconnecting to the transcript'
            : labels[transcriptState(synced.value)]}
        </p>
      </div>
      <TranscriptContent
        sections={liveTranscriptSections(synced.value)}
        empty="No speech was captured yet."
      />
    </section>
  );
}
