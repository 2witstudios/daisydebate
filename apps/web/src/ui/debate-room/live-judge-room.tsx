'use client';
import './zod-jitless';
import Link from 'next/link';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useRoundTime } from './use-round-time';
import { RoundTimeNotice } from './round-time-notice';
import type { RoundView } from '@daisy/protocol';
import type { RoundRead } from '../../features/round-runtime/read-round';
import { roundMediaSlot } from '../../features/round-media/media-session';
import { FreshnessNotice } from '../resource-sync/freshness-notice';
import { useLiveRoundView } from './use-live-round-view';
import { MediaPageLink } from '../round-media/media-page-link';
import { RoundEndedNotice } from './round-ended';
import {
  clearAccountResumeRecords,
  markDeparture,
} from '../../features/rooms/resume-departure';
import { useRoundMediaTab } from './use-round-media-tab';
import { useRoundEndedRoute } from './use-round-ended';

/**
 * The server admits an actual own judge assignment; media grants remain
 * server-authoritative. Once the Round ends, the judge goes to its result.
 */
export function LiveJudgeRoom({
  actorId,
  transcript,
  view: seed,
  read,
  socketUrl,
  renderedAtMs,
}: {
  /** A judge's resume ends only by choosing to go; no command records that. */
  readonly actorId: string;
  readonly transcript?: ReactNode;
  readonly view: RoundView;
  readonly read: () => Promise<RoundRead>;
  readonly socketUrl: string | null;
  readonly renderedAtMs: number;
}) {
  const { roundTime, wakeClock } = useRoundTime({
    renderedAtMs,
    clockUrl: `/api/rounds/${seed.id}/ballots`,
  });
  const [synced, driver] = useLiveRoundView({
    view: seed,
    read,
    socketUrl,
    onConnectionOpen: wakeClock,
  });
  const refresh = useCallback(() => driver?.signal(), [driver]);
  const view = synced.value;
  const tab = useRoundMediaTab(actorId, view);
  const media = useMemo(
    () =>
      roundMediaSlot({
        onRefresh: refresh,
        roundTime,
        actorId,
        tab,
        onAccountChanged: clearAccountResumeRecords,
      }),
    [refresh, roundTime, actorId, tab],
  );
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
      <Link
        href="/lobby"
        prefetch={false}
        onClick={() => markDeparture(actorId, view.id)}
      >
        Back to the lobby
      </Link>
    </main>
  );
}
