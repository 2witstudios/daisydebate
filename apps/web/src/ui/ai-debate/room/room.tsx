'use client';

import { ipdaTurns } from '@daisy/debate-engine';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Badge } from '../../components/badge/badge';
import { TrainCard } from '../../train/card/train-card';
import { TrainColumns, TrainPage } from '../../train/train-page/train-page';
import {
  BallotCard,
  Controls,
  RoundList,
  Timer,
  Transcript,
  sideName,
  stageTitle,
} from './parts';
import { createRoomStore, type RoomSnapshot } from './store';

function StageNotes({ snapshot }: { readonly snapshot: RoomSnapshot }) {
  const { state, status, caption, problem, headset } = snapshot;
  const live = state.phase === 'live';
  const cx = live && ipdaTurns[state.turnIndex]?.kind === 'cross-examination';
  return (
    <div aria-live="polite" className="flex flex-col gap-3">
      <Timer state={state} />
      {status ? <p className="text-ink">{status}</p> : null}
      {caption && live ? (
        <blockquote className="rounded-md border border-border bg-surface-sunken p-4 text-lg text-ink">
          {caption}
        </blockquote>
      ) : null}
      {problem ? <p className="text-sm text-live">{problem}</p> : null}
      {cx && !headset ? (
        <p className="text-sm text-ink-muted">
          Tip: headphones stop your opponent&apos;s voice from echoing into your
          microphone.
        </p>
      ) : null}
    </div>
  );
}

/** The AI debate room: a strict IPDA round by voice against the AI. */
export function AiDebateRoom({ id }: { readonly id: string }) {
  const [store] = useState(() => createRoomStore({ id }));
  useEffect(() => store.start(), [store]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const { view, state, ballot } = snapshot;
  if (!view)
    return (
      <TrainPage>
        <p className="text-ink-muted">Loading your debate…</p>
      </TrainPage>
    );
  const aiSide = view.personSide === 'affirmative' ? 'negative' : 'affirmative';
  const turnIndex = state.phase === 'live' ? state.turnIndex : null;
  const main = (
    <>
      <TrainCard title={view.resolution}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <Badge tone="accent">You: {sideName(view.personSide)}</Badge>
          <Badge>AI: {sideName(aiSide)}</Badge>
          <span>Strict IPDA · 4:00 prep</span>
        </div>
      </TrainCard>
      <TrainCard title={stageTitle(state)}>
        <StageNotes snapshot={snapshot} />
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
              if (turnIndex !== null)
                void store.command({ type: 'yield', turnIndex });
            },
            onAbort: () => void store.command({ type: 'abort' }),
          }}
        />
      </TrainCard>
      {ballot ? (
        <BallotCard ballot={ballot} personSide={view.personSide} />
      ) : null}
      <Transcript view={view} />
    </>
  );
  return (
    <TrainPage>
      <TrainColumns
        main={main}
        aside={<RoundList state={state} personSide={view.personSide} />}
        asideLabel="Round order"
      />
    </TrainPage>
  );
}
