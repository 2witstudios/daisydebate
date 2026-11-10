'use client';
import '../../lib/zod-jitless';
import { FloorChat, type FloorChatProps } from '../round-floor/floor-chat';
import { OpeningStatus } from '../debate-room/opening-strike';
import { drawnTopicLabel } from '../../features/debate-room/vocabulary';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RoundView } from '@daisy/protocol';
import type { RoundRead } from '../../features/round-runtime/read-round';
import type { SpectatorKind } from '../../features/spectating/spectator-view';
import {
  observedRoundOf,
  type ObservedActivity,
  type ObservedRound,
  type ObservedSeat,
} from '../../features/round-runtime/observed-round';
import { RoundClock } from '../debate-room/round-clock';
import { ObservedSpeechOrder } from '../round-observed/speech-order';
import {
  observedActivityLabel,
  observedSideInk,
} from '../round-observed/observed-labels';
import { RoundEndedNotice } from '../debate-room/round-ended';
import { useLiveRoundView } from '../debate-room/use-live-round-view';
import { useRoundEndedRoute } from '../debate-room/use-round-ended';
import { useSecond } from '../debate-room/use-second';
import { useRoundTime } from '../debate-room/use-round-time';
import { RoundIncidentBanner } from '../debate-room/round-incident-banner';
import { RoundTimeNotice } from '../debate-room/round-time-notice';
import { initialsOf } from '../../lib/initials';
import { FreshnessNotice } from '../resource-sync/freshness-notice';

const spectatorKindLabel: Readonly<Record<SpectatorKind, string>> = {
  'undelayed-observer': 'You’re hosting · watching',
};

const spectatorKindRoster: Readonly<Record<SpectatorKind, string>> = {
  'undelayed-observer': 'host, watching',
};

const sideLabel = { affirmative: 'Affirmative', negative: 'Negative' } as const;

const eyebrowClass = 'text-xs font-bold tracking-wide text-ink-muted uppercase';
const cardClass = 'rounded-xl border border-border bg-surface-raised';

const onFloor = (activity: ObservedActivity) =>
  activity === 'speaking' || activity === 'asking';

function SeatTile({ seat }: { readonly seat: ObservedSeat }) {
  return (
    <li
      className={`flex flex-col justify-between gap-3 rounded-xl bg-surface-stage p-4 text-stage-ink ${
        onFloor(seat.activity)
          ? 'outline-3 outline-offset-2 outline-stage-accent'
          : ''
      }`}
    >
      <span
        className={`self-start rounded-round px-3 py-1 text-sm font-strong ${
          onFloor(seat.activity)
            ? 'bg-stage-accent text-stage-accent-ink'
            : 'text-stage-ink-muted'
        }`}
      >
        {observedActivityLabel[seat.activity]}
      </span>
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center self-center rounded-round border border-stage-ink-muted font-display text-2xl max-narrow:size-12 max-narrow:text-xl"
      >
        {initialsOf(seat.label)}
      </span>
      <span>
        <span className="block font-strong wrap-anywhere">{seat.label}</span>
        <span className="text-sm text-stage-ink-muted">
          {sideLabel[seat.side]}
          {seat.bot ? ' · Bot' : ''}
        </span>
      </span>
    </li>
  );
}

function SpeechOrder({ watched }: { readonly watched: ObservedRound }) {
  return (
    <section
      aria-labelledby="spectator-speeches"
      className={`${cardClass} flex flex-col gap-3 px-5 py-4`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="spectator-speeches" className={eyebrowClass}>
          Speech order
        </h2>
        {watched.clock ? (
          <RoundClock
            label={watched.clock.label}
            remainingMs={watched.clock.remainingMs}
            className="flex flex-col items-end leading-tight"
          />
        ) : null}
      </div>
      <ObservedSpeechOrder
        speeches={watched.speeches}
        labelledBy="spectator-speeches"
      />
    </section>
  );
}

const stageNote = (watched: ObservedRound): string | null => {
  if (watched.stage === 'starting') return null;
  if (watched.stage === 'judging')
    return watched.judge === 'ai'
      ? 'The speeches are over. The AI judge is deciding.'
      : 'The speeches are over. The judge is deciding.';
  return null;
};

/**
 * A live Round for someone without a seat: who is speaking, the clock and
 * the speech order, kept current by round sync, with no control of any
 * kind. Audio and video for spectators come with the spectating capability
 * (ADR 0053); once the Round ends the viewer goes to its result.
 */
export function LiveSpectatorRoom(props: {
  readonly transcript?: ReactNode;
  readonly floor?: FloorChatProps | undefined;
  readonly view: RoundView;
  readonly spectatorKind: SpectatorKind;
  readonly renderedAtMs: number;
  readonly read: () => Promise<RoundRead>;
  readonly socketUrl: string | null;
}) {
  const { roundTime, wakeClock } = useRoundTime({
    renderedAtMs: props.renderedAtMs,
    clockUrl: `/api/rounds/${props.view.id}`,
  });
  const [synced] = useLiveRoundView({ ...props, onConnectionOpen: wakeClock });
  const view = synced.value;
  const now = useSecond(props.renderedAtMs, roundTime);
  const ended = useRoundEndedRoute(view);
  if (ended) return <RoundEndedNotice roundId={view.id} />;
  const watched = observedRoundOf(view, now);
  const note = stageNote(watched);
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-dash-column flex-col gap-4 px-6 py-6 max-narrow:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-round bg-live-soft px-3 py-1 text-sm font-strong text-live">
          <span aria-hidden="true" className="size-2 rounded-round bg-live" />
          Live
        </span>
        <span className="rounded-round bg-hue-teal-soft px-3 py-1 text-sm font-strong text-hue-teal">
          {spectatorKindLabel[props.spectatorKind]}
        </span>
        <Link
          href="/lobby"
          className="ml-auto inline-flex min-h-room-target items-center font-strong"
        >
          Back to the lobby
        </Link>
      </div>
      <h1 className="sr-only">Watching the round</h1>
      <section
        aria-labelledby="spectator-resolution"
        className={`${cardClass} flex flex-col gap-2 px-6 py-5`}
      >
        <h2 id="spectator-resolution" className={eyebrowClass}>
          Resolution
        </h2>
        <p className="font-display text-2xl leading-tight font-semibold wrap-anywhere">
          {view.topic ?? drawnTopicLabel}
        </p>
      </section>
      {watched.stage === 'strike' ? (
        <OpeningStatus view={view} nowMs={now} />
      ) : null}
      <FreshnessNotice freshness={synced.freshness} noun="round" />
      <RoundTimeNotice roundTime={roundTime} />
      <RoundIncidentBanner checkpoint={view.checkpoint} nowMs={now} />
      {note ? <p role="status">{note}</p> : null}
      <ul
        aria-label="Debaters"
        className="grid grid-cols-2 gap-4 max-narrow:gap-3"
      >
        {watched.seats.map((seat) => (
          <SeatTile key={seat.side} seat={seat} />
        ))}
      </ul>
      <p className="text-sm text-ink-muted">
        Audio and video for spectators come with spectating. Until then you
        follow who’s speaking, the clock and the speech order.
      </p>
      <SpeechOrder watched={watched} />
      {props.transcript}
      {props.floor ? <FloorChat {...props.floor} /> : null}
      <section
        aria-labelledby="spectator-roster"
        className={`${cardClass} flex flex-col gap-3 px-5 py-4`}
      >
        <h2 id="spectator-roster" className={eyebrowClass}>
          In this round
        </h2>
        <ul className="flex flex-col gap-2">
          {watched.seats.map((seat) => (
            <li key={seat.side}>
              <span className="font-strong">{seat.label}</span>{' '}
              <span className={observedSideInk[seat.side]}>
                · {sideLabel[seat.side]}
              </span>
            </li>
          ))}
          {watched.judge ? (
            <li>
              <span className="font-strong">
                {watched.judge === 'ai' ? 'AI judge' : 'Judge'}
              </span>
            </li>
          ) : null}
          <li>
            <span className="font-strong">You</span>{' '}
            <span className="text-ink-muted">
              · {spectatorKindRoster[props.spectatorKind]}
            </span>
          </li>
        </ul>
      </section>
      <p className="text-sm text-ink-muted">
        Leaving this page doesn’t affect the round. When it ends you’ll go to
        the result.
      </p>
    </div>
  );
}
