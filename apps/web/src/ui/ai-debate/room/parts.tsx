'use client';

import type { Ballot } from '@daisy/ai-voice';
import {
  aiDebateTurns,
  turnRoles,
  type AiDebateSide,
  type AiDebateState,
} from '@daisy/debate-engine';
import { useRef, useState } from 'react';
import { buttonClass } from '../../components/button/button-class';
import { TrainCard } from '../../train/card/train-card';

export const sideName = (side: string) =>
  side === 'affirmative' ? 'Affirmative' : 'Negative';

export function stageTitle(state: AiDebateState) {
  const turn =
    'turnIndex' in state ? aiDebateTurns[state.turnIndex] : undefined;
  const titles: Record<AiDebateState['phase'], string> = {
    waiting: 'Ready when you are',
    prep: `Prep before your ${turn?.name ?? 'speech'}`,
    countdown: `Up next: ${turn?.label ?? 'the next turn'}`,
    live: turn?.label ?? 'Live',
    ended: 'Debate over',
    aborted: 'Debate ended early',
  };
  return titles[state.phase];
}

export type ControlActions = {
  readonly onBegin: () => void;
  readonly onRejoin: () => void;
  readonly onStartSpeech: () => void;
  readonly onYield: () => void;
  readonly onAbort: () => void;
};

/**
 * A button that ends something: the first press arms it, a second within
 * three seconds confirms, so a stray tap never ends a speech.
 */
function EndButton({
  label,
  variant,
  onConfirm,
}: {
  readonly label: string;
  readonly variant: 'primary' | 'secondary' | 'ghost';
  readonly onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const disarm = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <button
      type="button"
      className={buttonClass(variant)}
      onClick={() => {
        clearTimeout(disarm.current);
        if (armed) {
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
        disarm.current = setTimeout(() => setArmed(false), 3_000);
      }}
    >
      {armed ? 'Tap again to confirm' : label}
    </button>
  );
}

function LiveControls({
  state,
  personSide,
  actions,
}: {
  readonly state: AiDebateState;
  readonly personSide: AiDebateSide;
  readonly actions: ControlActions;
}) {
  const turn =
    state.phase === 'live' ? aiDebateTurns[state.turnIndex] : undefined;
  const yours =
    turn?.kind === 'speech' && turnRoles(turn, personSide).speaker === 'person';
  return (
    <div className="flex flex-wrap gap-3">
      {state.phase === 'prep' ? (
        <button
          type="button"
          className={buttonClass('primary')}
          onClick={actions.onStartSpeech}
        >
          Start my speech
        </button>
      ) : null}
      {yours ? (
        <EndButton
          key={`speech-${turn.index}`}
          label="End my speech"
          variant="primary"
          onConfirm={actions.onYield}
        />
      ) : null}
      {turn?.kind === 'cross-examination' ? (
        <EndButton
          key={`cx-${turn.index}`}
          label="End cross-examination"
          variant="secondary"
          onConfirm={actions.onYield}
        />
      ) : null}
      <EndButton
        label="End debate"
        variant="ghost"
        onConfirm={actions.onAbort}
      />
    </div>
  );
}

export function Controls({
  state,
  personSide,
  joined,
  busy,
  actions,
}: {
  readonly state: AiDebateState;
  readonly personSide: AiDebateSide;
  readonly joined: boolean;
  readonly busy: boolean;
  readonly actions: ControlActions;
}) {
  if (state.phase === 'ended' || state.phase === 'aborted') return null;
  if (state.phase === 'waiting')
    return (
      <button
        type="button"
        className={buttonClass('primary')}
        disabled={busy}
        onClick={actions.onBegin}
      >
        Begin debate
      </button>
    );
  if (!joined)
    return (
      <button
        type="button"
        className={buttonClass('primary')}
        disabled={busy}
        onClick={actions.onRejoin}
      >
        Rejoin with your microphone
      </button>
    );
  return (
    <LiveControls state={state} personSide={personSide} actions={actions} />
  );
}

export function BallotCard({
  ballot,
  personSide,
  opponent,
}: {
  readonly ballot: Ballot;
  readonly personSide: AiDebateSide;
  readonly opponent: string;
}) {
  return (
    <TrainCard
      title={
        ballot.winner === personSide
          ? 'You won the round'
          : `${opponent} won this round`
      }
    >
      <p className="text-ink">
        <span className="font-strong">
          Decision: {sideName(ballot.winner)}.
        </span>{' '}
        {ballot.reason}
      </p>
      {ballot.speeches.length ? (
        <ul className="flex flex-col gap-3">
          {ballot.speeches.map((speech) => (
            <li
              key={`${speech.turn}-${speech.side}`}
              className="flex flex-col gap-1"
            >
              <span className="text-xs font-strong tracking-wide text-ink-muted uppercase">
                {speech.turn} · {speech.side === personSide ? 'You' : opponent}
              </span>
              <span className="text-ink">Worked: {speech.strengths}</span>
              <span className="text-ink">Next time: {speech.improvements}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {ballot.tips.length ? (
        <div className="flex flex-col gap-1">
          <span className="font-strong text-ink">Tips for your next round</span>
          <ul className="list-disc pl-5 text-ink">
            {ballot.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </TrainCard>
  );
}
