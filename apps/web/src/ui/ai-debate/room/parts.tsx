import type { Ballot } from '@daisy/ai-voice';
import {
  ipdaTurns,
  turnRoles,
  type AiDebateSide,
  type AiDebateState,
} from '@daisy/debate-engine';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { TrainCard } from '../../train/card/train-card';
import type { RoomView } from './store';

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export const sideName = (side: string) =>
  side === 'affirmative' ? 'Affirmative' : 'Negative';

export function stageTitle(state: AiDebateState) {
  if (state.phase === 'waiting') return 'Ready when you are';
  if (state.phase === 'prep')
    return `Prep before your ${ipdaTurns[state.turnIndex]?.name ?? 'speech'}`;
  if (state.phase === 'live')
    return ipdaTurns[state.turnIndex]?.label ?? 'Live';
  if (state.phase === 'aborted') return 'Debate ended early';
  return 'Debate over';
}

export function Timer({ state }: { readonly state: AiDebateState }) {
  const style =
    'font-display text-display-sm font-strong text-ink tabular-nums';
  if (state.phase === 'live')
    return <p className={style}>{clock(state.remainingMs)}</p>;
  if (state.phase === 'prep')
    return (
      <p className={style}>
        {clock(state.prepLeftMs)}{' '}
        <span className="text-base text-ink-muted">prep left</span>
      </p>
    );
  return null;
}

export type ControlActions = {
  readonly onBegin: () => void;
  readonly onRejoin: () => void;
  readonly onStartSpeech: () => void;
  readonly onYield: () => void;
  readonly onAbort: () => void;
};

function LiveControls({
  state,
  personSide,
  actions,
}: {
  readonly state: AiDebateState;
  readonly personSide: AiDebateSide;
  readonly actions: ControlActions;
}) {
  const turn = state.phase === 'live' ? ipdaTurns[state.turnIndex] : undefined;
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
        <button
          type="button"
          className={buttonClass('primary')}
          onClick={actions.onYield}
        >
          End my speech
        </button>
      ) : null}
      {turn?.kind === 'cross-examination' ? (
        <button
          type="button"
          className={buttonClass('secondary')}
          onClick={actions.onYield}
        >
          End cross-examination
        </button>
      ) : null}
      <button
        type="button"
        className={buttonClass('ghost')}
        onClick={actions.onAbort}
      >
        End debate
      </button>
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
      <div className="flex flex-col gap-3">
        <p className="text-ink-muted">
          You will debate by voice. Daisy transcribes your speeches for the AI
          and the judge; no audio is kept. Headphones work best.
        </p>
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={busy}
          onClick={actions.onBegin}
        >
          Begin debate
        </button>
      </div>
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

export function RoundList({
  state,
  personSide,
}: {
  readonly state: AiDebateState;
  readonly personSide: AiDebateSide;
}) {
  const at =
    state.phase === 'live' || state.phase === 'prep' ? state.turnIndex : null;
  return (
    <TrainCard title="Round" level={3}>
      <ol className="flex flex-col gap-2">
        {ipdaTurns.map((turn) => {
          const roles = turnRoles(turn, personSide);
          const who = roles.speaker === 'person' ? 'You' : 'AI';
          const done =
            state.phase === 'ended' || (at !== null && turn.index < at);
          return (
            <li
              key={turn.index}
              className={cn(
                'flex items-center justify-between rounded-sm px-2 py-1 text-sm',
                at === turn.index
                  ? 'bg-accent-soft font-strong text-ink'
                  : done
                    ? 'text-ink-muted'
                    : 'text-ink',
              )}
            >
              <span>
                {turn.name} ·{' '}
                {turn.kind === 'cross-examination' ? `${who} asks` : who}
              </span>
              <span className="tabular-nums">{clock(turn.durationMs)}</span>
            </li>
          );
        })}
      </ol>
    </TrainCard>
  );
}

export function Transcript({ view }: { readonly view: RoomView }) {
  const lines = view.utterances.filter((line) => line.text);
  return (
    <TrainCard title="Transcript">
      {lines.length === 0 ? (
        <p className="text-ink-muted">
          What you and your opponent say will appear here.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {lines.map((line) => (
            <li key={line.id} className="flex flex-col gap-1">
              <span className="text-xs font-strong tracking-wide text-ink-muted uppercase">
                {ipdaTurns[line.turnIndex]?.name} ·{' '}
                {line.role === 'person' ? 'You' : 'AI'}
              </span>
              <span className="text-ink">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </TrainCard>
  );
}

export function BallotCard({
  ballot,
  personSide,
}: {
  readonly ballot: Ballot;
  readonly personSide: AiDebateSide;
}) {
  return (
    <TrainCard
      title={
        ballot.winner === personSide
          ? 'You won the round'
          : 'The AI won this round'
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
                {speech.turn} · {speech.side === personSide ? 'You' : 'AI'}
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
