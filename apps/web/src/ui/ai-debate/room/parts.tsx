'use client';

import { speakerTotal } from '@daisy/protocol';
import type { Ballot } from '@daisy/ai-voice';
import type { DebateSide } from '@daisy/protocol';
import { useRef, useState } from 'react';
import { buttonClass } from '../../components/button/button-class';
import { TrainCard } from '../../train/card/train-card';
import {
  segmentAt,
  type AiDebateView,
  type UiSegment,
  type UiState,
} from '../../../features/ai-debate/context';

export const sideName = (side: string) =>
  side === 'affirmative' ? 'Affirmative' : 'Negative';

export function stageTitle(state: UiState, view: AiDebateView | null) {
  const segment =
    'segmentIndex' in state && view
      ? segmentAt(view, state.segmentIndex)
      : undefined;
  const titles: Record<UiState['phase'], string> = {
    waiting: 'Ready when you are',
    prep: `Prep before your ${segment?.name ?? 'speech'}`,
    countdown: `Up next: ${segment?.label ?? 'the next segment'}`,
    live: segment?.label ?? 'Live',
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

/** The live segment whose floor the controls are about, if one is running. */
const liveSegmentOf = (
  state: UiState,
  view: AiDebateView,
  personSide: DebateSide,
): { readonly segment: UiSegment; readonly yours: boolean } | null => {
  if (state.phase !== 'live') return null;
  const segment = segmentAt(view, state.segmentIndex);
  return {
    segment,
    yours: segment.kind === 'speech' && segment.side === personSide,
  };
};

function LiveControls({
  state,
  view,
  personSide,
  actions,
}: {
  readonly state: UiState;
  readonly view: AiDebateView;
  readonly personSide: DebateSide;
  readonly actions: ControlActions;
}) {
  const live = liveSegmentOf(state, view, personSide);
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
      {live?.yours ? (
        <EndButton
          key={`speech-${live.segment.index}`}
          label="End my speech"
          variant="primary"
          onConfirm={actions.onYield}
        />
      ) : null}
      {live !== null && live.segment.kind === 'cross-examination' ? (
        <EndButton
          key={`cx-${live.segment.index}`}
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
  view,
  personSide,
  joined,
  busy,
  actions,
}: {
  readonly state: UiState;
  readonly view: AiDebateView | null;
  readonly personSide: DebateSide;
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
  return view ? (
    <LiveControls
      state={state}
      view={view}
      personSide={personSide}
      actions={actions}
    />
  ) : null;
}

export function BallotCard({
  ballot,
  personSide,
  opponent,
}: {
  readonly ballot: Ballot;
  readonly personSide: DebateSide;
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
          Decision: {sideName(ballot.winner)} · Speakers{' '}
          {speakerTotal(ballot.scores.affirmative)}–
          {speakerTotal(ballot.scores.negative)}.
        </span>{' '}
        {ballot.reason}
      </p>
      <div className="flex flex-col gap-3">
        {(['affirmative', 'negative'] as const).map((side) =>
          ballot.feedback[side] ? (
            <div key={side} className="flex flex-col gap-1">
              <span className="text-xs font-strong tracking-wide text-ink-muted uppercase">
                {side === personSide ? 'You' : opponent} ·{' '}
                {speakerTotal(ballot.scores[side])}/50
              </span>
              <span className="text-ink">{ballot.feedback[side]}</span>
            </div>
          ) : null,
        )}
      </div>
    </TrainCard>
  );
}
