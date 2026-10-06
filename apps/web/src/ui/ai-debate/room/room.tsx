'use client';

import { aiDebateTurns, turnRoles } from '@daisy/debate-engine';
import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  botSelector,
  selectBotHref,
  type Bot,
} from '../../../features/train/bots';
import { trainDestinations } from '../../../features/train/actions';
import { PageHeader } from '../../components/page-header/page-header';
import { TrainPage } from '../../train/train-page/train-page';
import { createDocumentSync } from '../../debate-room/document-sync';
import { documentsApi } from '../../debate-room/documents-api';
import { RETRYING_NOTICE, refusedNotice } from '../../debate-room/save-notice';
import { DebateRoom } from '../../debate-room/room';
import { BallotCard, Controls, stageTitle } from './parts';
import { RoundClock } from './round-clock';
import { botRoundSnapshot } from './round-snapshot';
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
  const { state, status, caption, problem, headset } = snapshot;
  const live = state.phase === 'live';
  const cx =
    live && aiDebateTurns[state.turnIndex]?.kind === 'cross-examination';
  // The clock is not announced (it changes every second); what happens is.
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="text-sm font-strong text-ink">{stageTitle(state)}</h2>
      <div aria-live="polite" className="flex flex-col gap-1 text-sm">
        {status ? <p className="text-ink">{status}</p> : null}
        {caption && live ? (
          <blockquote className="rounded-sm border border-border bg-surface-sunken px-3 py-2 text-ink">
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

/** A debate against a Train bot, in the round room: voice above, files below. */
export function AiDebateRoom({ id }: { readonly id: string }) {
  const [store] = useState(() => createRoomStore({ id }));
  useEffect(() => store.start(), [store]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [conflicts, setConflicts] = useState(0);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const sync = useMemo(
    () =>
      createDocumentSync({
        api: documentsApi,
        aiDebateId: id,
        onConflict: () => setConflicts((n) => n + 1),
        onSaveFailed: () => setSaveProblem(RETRYING_NOTICE),
        onSaveRefused: (_id, status) => setSaveProblem(refusedNotice(status)),
        onSaved: () => setSaveProblem(null),
      }),
    // A conflict starts a fresh sync, which reloads the server's copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, conflicts],
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
  const listening = listeningOf(snapshot);
  const round = botRoundSnapshot({ view, state, bot, listening });
  return (
    <DebateRoom
      key={conflicts}
      round={round}
      sync={sync}
      notice={saveProblem}
      parts={{
        stage: (
          <Stage
            bot={bot}
            personSide={view.personSide}
            state={state}
            speaking={snapshot.speaking}
            level={snapshot.level}
            listening={listening}
          />
        ),
        controls: (layout) => (
          <nav
            aria-label="Round controls"
            className="grid grid-cols-3 items-center gap-x-4 gap-y-2 bg-background px-3 py-2"
          >
            <StageNotes snapshot={snapshot} bot={bot} />
            <RoundClock state={state} personSide={view.personSide} />
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Link
                href={selectBotHref(bot.id)}
                className="text-sm text-ink-muted no-underline hover:text-ink"
              >
                Train
              </Link>
              <Controls
                state={state}
                personSide={view.personSide}
                joined={snapshot.joined}
                busy={snapshot.busy}
                actions={{
                  onBegin: () => void store.join(true),
                  onRejoin: () => void store.join(false),
                  onStartSpeech: () =>
                    void store.command({ type: 'startSpeech' }),
                  onYield: () => {
                    if (turnIndex !== null) void store.finishTurn(turnIndex);
                  },
                  onAbort: () => void store.command({ type: 'abort' }),
                }}
              />
              {layout}
            </div>
          </nav>
        ),
        below: ballot ? (
          <div className="px-3 pb-2">
            <BallotCard
              ballot={ballot}
              personSide={view.personSide}
              opponent={bot.name}
            />
          </div>
        ) : null,
      }}
    />
  );
}
