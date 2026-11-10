'use client';
import '../../lib/zod-jitless';
import Link from 'next/link';
import { useCallback, useMemo, type ReactNode } from 'react';
import type { RoundView } from '@daisy/protocol';
import { drawnTopicLabel } from '../../features/debate-room/vocabulary';
import type { RoundRead } from '../../features/round-runtime/read-round';
import { observedRoundOf } from '../../features/round-runtime/observed-round';
import {
  judgeBallotDue,
  judgeRoomStageOf,
} from '../../features/judge/judge-room-stage';
import { roundMediaSlot } from '../../features/round-media/media-session';
import {
  clearAccountResumeRecords,
  leaveRound,
} from '../../features/rooms/resume-departure';
import { useSecond } from '../debate-room/use-second';
import { OpeningStatus } from '../debate-room/opening-strike';
import { useRoundTime } from '../debate-room/use-round-time';
import { RoundIncidentBanner } from '../debate-room/round-incident-banner';
import { RoundTimeNotice } from '../debate-room/round-time-notice';
import { useLiveRoundView } from '../debate-room/use-live-round-view';
import { RoundEndedNotice } from '../debate-room/round-ended';
import { useRoundMediaTab } from '../debate-room/use-round-media-tab';
import { useRoundEndedRoute } from '../debate-room/use-round-ended';
import { FreshnessNotice } from '../resource-sync/freshness-notice';
import { MediaPageLink } from '../round-media/media-page-link';
import { ObservedSpeechOrder } from '../round-observed/speech-order';
import { buttonClass } from '../components/button/button-class';
import { JudgeNow } from './judge-now';

const eyebrowClass = 'text-xs font-bold tracking-wide text-ink-muted uppercase';
const cardClass = 'rounded-xl border border-border bg-surface-raised';

/**
 * The judge's live room. The server admits an actual own judge assignment;
 * media grants remain server-authoritative. The judge follows every step
 * from the same position reader the debaters use: the stage, its clock, who
 * has the floor, the speech order and each side's prep. Once the speeches
 * end the ballot is the one action; once the Round ends, the judge goes to
 * its result.
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
  const now = useSecond(renderedAtMs, roundTime);
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
  if (ended)
    return (
      <RoundEndedNotice
        roundId={view.id}
        detail={
          view.status === 'completed'
            ? 'The result shows the decision and every ballot.'
            : undefined
        }
      />
    );
  const observed = observedRoundOf(view, now);
  const stage = judgeRoomStageOf(observed, {
    drawSize: view.opening?.draw?.drawSize ?? null,
    waitingOn: view.waitingOn?.state ?? null,
  });
  const ballotHref = `/judge/ballot/${view.id}`;
  const judging = observed.stage === 'judging';
  const ballotFirst = judging && judgeBallotDue(view.waitingOn?.state ?? null);
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-dash-column flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">
          You’re judging this round
        </h1>
        <Link
          href="/lobby"
          prefetch={false}
          onClick={() => leaveRound(actorId, view.id)}
          className="ml-auto inline-flex min-h-room-target items-center font-strong"
        >
          Back to the lobby
        </Link>
      </div>
      <section
        aria-labelledby="judge-resolution"
        className={`${cardClass} p-5`}
      >
        <h2 id="judge-resolution" className={eyebrowClass}>
          Resolution
        </h2>
        <p className="font-display text-xl wrap-anywhere">
          {view.topic ?? drawnTopicLabel}
        </p>
        <p className="text-sm text-ink-muted">
          The Affirmative argues for it; the Negative argues against it.
        </p>
      </section>
      <FreshnessNotice freshness={synced.freshness} noun="round" />
      <RoundTimeNotice roundTime={roundTime} />
      <RoundIncidentBanner checkpoint={view.checkpoint} nowMs={now} />
      <JudgeNow
        observed={observed}
        stage={stage}
        action={
          ballotFirst ? (
            <Link
              href={ballotHref}
              prefetch={false}
              className={`${buttonClass('primary')} self-start`}
            >
              Open your ballot
            </Link>
          ) : null
        }
      />
      {observed.stage === 'strike' ? (
        <OpeningStatus view={view} nowMs={now} />
      ) : null}
      {media(view)}
      <section
        aria-labelledby="judge-speeches"
        className={`${cardClass} flex flex-col gap-3 p-5`}
      >
        <h2 id="judge-speeches" className={eyebrowClass}>
          Speech order
        </h2>
        <ObservedSpeechOrder
          speeches={observed.speeches}
          labelledBy="judge-speeches"
        />
      </section>
      {transcript}
      <nav aria-label="Ballot and result" className="flex flex-wrap gap-4">
        {ballotFirst ? null : (
          <Link
            href={ballotHref}
            prefetch={false}
            className="inline-flex min-h-room-target items-center font-strong"
          >
            {judging ? 'Your ballot' : 'Preview your ballot'}
          </Link>
        )}
        <MediaPageLink
          href={`/rounds/${view.id}`}
          className="inline-flex min-h-room-target items-center font-strong"
        >
          View the round result
        </MediaPageLink>
      </nav>
    </div>
  );
}
