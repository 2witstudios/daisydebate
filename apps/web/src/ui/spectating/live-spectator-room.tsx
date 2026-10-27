'use client';
import '../debate-room/zod-jitless';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RoundView } from '@daisy/protocol';
import { formatClock } from '../../features/debate-room/clock';
import type { RoundRead } from '../../features/rooms/read-round';
import {
  spectatorViewOf,
  type SpectatorActivity,
  type SpectatorAudience,
  type SpectatorSeat,
  type SpectatorView,
} from '../../features/spectating/spectator-view';
import { RoundEndedNotice } from '../debate-room/round-ended';
import { useLiveRoundView } from '../debate-room/use-live-round-view';
import { useRoundEndedRoute } from '../debate-room/use-round-ended';
import { useSecond } from '../debate-room/use-second';
import { initialsOf } from '../components/avatar/initials';
import { FreshnessNotice } from '../resource-sync/freshness-notice';

const audienceLabel: Readonly<Record<SpectatorAudience, string>> = {
  host: 'You’re hosting · watching',
};

const audienceRoster: Readonly<Record<SpectatorAudience, string>> = {
  host: 'host, watching',
};

const activityLabel: Readonly<Record<SpectatorActivity, string>> = {
  speaking: 'Speaking',
  listening: 'Listening',
  asking: 'Asking',
  answering: 'Answering',
  preparing: 'Preparing',
  waiting: 'Waiting',
};

const sideLabel = { affirmative: 'Affirmative', negative: 'Negative' } as const;
const sideText = {
  affirmative: 'text-hue-sky',
  negative: 'text-hue-clay',
} as const;

const stateLabel = {
  done: 'Done',
  now: 'Now',
  next: 'Next',
  upcoming: null,
} as const;

const eyebrowClass = 'text-xs font-bold tracking-wide text-ink-muted uppercase';
const cardClass = 'rounded-xl border border-border bg-surface-raised';

const onFloor = (activity: SpectatorActivity) =>
  activity === 'speaking' || activity === 'asking';

function SeatTile({ seat }: { readonly seat: SpectatorSeat }) {
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
        {activityLabel[seat.activity]}
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

function SpeechOrder({ watched }: { readonly watched: SpectatorView }) {
  return (
    <section
      aria-labelledby="spectator-speeches"
      className={`${cardClass} flex flex-col gap-3 px-5 py-4`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="spectator-speeches" className={eyebrowClass}>
          Speech order
        </h2>
        {watched.clock ? (
          <>
            <p className="font-strong">{watched.clock.label}</p>
            <p className="ml-auto font-display text-3xl font-semibold tabular-nums">
              {formatClock(watched.clock.remainingMs)}
            </p>
          </>
        ) : null}
      </div>
      <ol className="grid grid-cols-3 gap-2 text-sm tiles:grid-cols-6">
        {watched.speeches.map((speech, index) => (
          <li
            key={`${index}-${speech.key}`}
            aria-current={speech.state === 'now' ? 'step' : undefined}
            className={`rounded-md p-2 ${
              speech.state === 'now'
                ? 'bg-surface-stage text-stage-ink'
                : speech.state === 'done'
                  ? 'bg-surface-overlay text-ink-faint'
                  : 'bg-surface-overlay'
            }`}
          >
            <span className="block font-strong">{speech.key}</span>
            <span className="sr-only">{speech.label}, </span>
            {stateLabel[speech.state] ? `${stateLabel[speech.state]} · ` : ''}
            {formatClock(speech.durationMs)}
          </li>
        ))}
      </ol>
    </section>
  );
}

const stageNote = (watched: SpectatorView): string | null => {
  if (watched.stage === 'starting')
    return 'The round is about to start. The first speech begins once both debaters check in.';
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
  readonly view: RoundView;
  readonly audience: SpectatorAudience;
  readonly renderedAtMs: number;
  readonly read: () => Promise<RoundRead>;
  readonly socketUrl: string | null;
}) {
  const [synced] = useLiveRoundView(props);
  const view = synced.value;
  const now = useSecond(props.renderedAtMs);
  const ended = useRoundEndedRoute(view);
  if (ended) return <RoundEndedNotice roundId={view.id} />;
  const watched = spectatorViewOf(view, now);
  const note = stageNote(watched);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-dash-column flex-col gap-4 px-6 py-6 max-narrow:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-round bg-live-soft px-3 py-1 text-sm font-strong text-live">
          <span aria-hidden="true" className="size-2 rounded-round bg-live" />
          Live
        </span>
        <span className="rounded-round bg-hue-teal-soft px-3 py-1 text-sm font-strong text-hue-teal">
          {audienceLabel[props.audience]}
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
          {view.topic}
        </p>
      </section>
      <FreshnessNotice freshness={synced.freshness} noun="round" />
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
              <span className={sideText[seat.side]}>
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
              · {audienceRoster[props.audience]}
            </span>
          </li>
        </ul>
      </section>
      <p className="text-sm text-ink-muted">
        Leaving this page doesn’t affect the round. When it ends you’ll go to
        the result.
      </p>
    </main>
  );
}
