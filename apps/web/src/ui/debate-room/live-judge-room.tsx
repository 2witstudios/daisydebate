'use client';
import { RoundTimeNotice } from './round-time-notice';
import './zod-jitless';
import Link from 'next/link';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useRoundTime } from './use-round-time';
import type { RoundView } from '@daisy/protocol';
import type { RoundRead } from '../../features/round-runtime/read-round';
import { roundMediaSlot } from '../../features/round-media/media-session';
import { FreshnessNotice } from '../resource-sync/freshness-notice';
import { useLiveRoundView } from './use-live-round-view';
import { MediaPageLink } from '../round-media/media-page-link';
import { RoundEndedNotice } from './round-ended';
import { useRoundEndedRoute } from './use-round-ended';

/**
 * The server admits an actual own judge assignment; media grants remain
 * server-authoritative. Once the Round ends, the judge goes to its result.
 */
export function LiveJudgeRoom({
  transcript,
  view: seed,
  read,
  socketUrl,
  renderedAtMs,
}: {
  readonly transcript?: ReactNode;
  readonly view: RoundView;
  readonly read: () => Promise<RoundRead>;
  readonly socketUrl: string | null;
  readonly renderedAtMs: number;
}) {
  const { roundTime, sampledRead } = useRoundTime({
    renderedAtMs,
    read,
  });
  const [synced, driver] = useLiveRoundView({
    view: seed,
    read: sampledRead,
    socketUrl,
  });
  const refresh = useCallback(() => driver?.signal(), [driver]);
  const media = useMemo(
    () => roundMediaSlot(refresh, roundTime),
    [refresh, roundTime],
  );
  const view = synced.value;
  const ended = useRoundEndedRoute(view);
  if (ended) return <RoundEndedNotice roundId={view.id} />;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-dash-column flex-col gap-4 p-4">
      <h1 className="font-display text-2xl font-semibold">
        You’re judging this round
      </h1>
      <section
        aria-labelledby="judge-resolution"
        className="rounded-xl border border-border bg-surface-raised p-5"
      >
        <h2
          id="judge-resolution"
          className="text-xs font-bold tracking-wide text-ink-muted uppercase"
        >
          Resolution
        </h2>
        <p className="font-display text-xl wrap-anywhere">{view.topic}</p>
      </section>
      <p>
        You can watch and listen. Your ballot opens once the speeches are over
        and the transcript is saved.
      </p>
      <FreshnessNotice freshness={synced.freshness} noun="round" />
      <RoundTimeNotice roundTime={roundTime} />
      {media(view)}
      {transcript}
      <Link href={`/judge/ballot/${view.id}`} prefetch={false}>
        Open your ballot
      </Link>
      <MediaPageLink href={`/rounds/${view.id}`}>
        View the round result
      </MediaPageLink>
    </main>
  );
}
