'use client';

import { aiDebateTurns, turnRoles } from '@daisy/debate-engine';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  botSelector,
  selectBotHref,
  type Bot,
} from '../../../features/train/bots';
import { trainDestinations } from '../../../features/train/actions';
import { Badge } from '../../components/badge/badge';
import { PageHeader } from '../../components/page-header/page-header';
import { TrainCard } from '../../train/card/train-card';
import { TrainPage } from '../../train/train-page/train-page';
import { BallotCard, Controls, Transcript, stageTitle } from './parts';
import { RoundClock } from './round-clock';
import { Stage } from './stage';
import { createRoomStore, type RoomSnapshot } from './store';

/** The microphone is open in the person's speeches and in cross-examination. */
function listeningOf({ view, state, joined }: RoomSnapshot) {
  if (!view || !joined || state.phase !== 'live') return false;
  const turn = aiDebateTurns[state.turnIndex]!;
  return (
    turn.kind === 'cross-examination' ||
    turnRoles(turn, view.personSide).speaker === 'person'
  );
}

function StageNotes({
  snapshot,
  bot,
}: {
  readonly snapshot: RoomSnapshot;
  readonly bot: Bot;
}) {
  const { view, state, status, caption, problem, headset } = snapshot;
  const live = state.phase === 'live';
  const cx =
    live && aiDebateTurns[state.turnIndex]?.kind === 'cross-examination';
  // The clock is not announced (it changes every second); what happens is.
  return (
    <div className="flex flex-col gap-3">
      {view ? (
        <RoundClock
          state={state}
          personSide={view.personSide}
          opponent={bot.name}
        />
      ) : null}
      <div aria-live="polite" className="flex flex-col gap-3">
        {status ? <p className="text-ink">{status}</p> : null}
        {caption && live ? (
          <blockquote className="rounded-md border border-border bg-surface-sunken p-4 text-lg text-ink">
            {caption}
          </blockquote>
        ) : null}
        {problem ? <p className="text-sm text-live">{problem}</p> : null}
        {cx && !headset ? (
          <p className="text-sm text-ink-muted">
            Tip: headphones stop {bot.name}&apos;s voice from echoing into your
            microphone.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A debate against a Train bot: a one-on-one round by voice. */
export function AiDebateRoom({ id }: { readonly id: string }) {
  const [store] = useState(() => createRoomStore({ id }));
  useEffect(() => store.start(), [store]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const { view, state, ballot } = snapshot;
  if (snapshot.missing)
    return (
      <TrainPage>
        <PageHeader title="This debate is not here" />
        <p className="text-ink-muted">
          It may have been removed, or it belongs to someone else.
        </p>
        <Link href={trainDestinations.bots}>Back to Train</Link>
      </TrainPage>
    );
  if (!view)
    return (
      <TrainPage>
        <p className="text-ink-muted">Loading your debate…</p>
        {snapshot.problem ? (
          <p className="text-sm text-live">{snapshot.problem}</p>
        ) : null}
      </TrainPage>
    );
  const bot = botSelector(view.opponent).selected;
  const turnIndex = state.phase === 'live' ? state.turnIndex : null;
  return (
    <TrainPage>
      <Link
        href={selectBotHref(bot.id)}
        className="inline-flex min-h-10 w-fit items-center gap-2 text-base font-strong text-ink-muted no-underline hover:text-ink hover:no-underline"
      >
        <span aria-hidden="true">&lsaquo;</span>
        Train
      </Link>
      <PageHeader
        title={view.resolution}
        lede={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Practice</Badge>
            <Badge tone="neutral">One on one · 4:00 prep</Badge>
          </span>
        }
      />
      <Stage
        bot={bot}
        personSide={view.personSide}
        state={state}
        speaking={snapshot.speaking}
        level={snapshot.level}
        listening={listeningOf(snapshot)}
      />
      <TrainCard title={stageTitle(state)}>
        <StageNotes snapshot={snapshot} bot={bot} />
        <Controls
          state={state}
          personSide={view.personSide}
          joined={snapshot.joined}
          busy={snapshot.busy}
          actions={{
            onBegin: () => void store.join(true),
            onRejoin: () => void store.join(false),
            onStartSpeech: () => void store.command({ type: 'startSpeech' }),
            onYield: () => {
              if (turnIndex !== null) void store.finishTurn(turnIndex);
            },
            onAbort: () => void store.command({ type: 'abort' }),
          }}
        />
      </TrainCard>
      {ballot ? (
        <BallotCard
          ballot={ballot}
          personSide={view.personSide}
          opponent={bot.name}
        />
      ) : null}
      <Transcript view={view} opponent={bot.name} />
    </TrainPage>
  );
}
