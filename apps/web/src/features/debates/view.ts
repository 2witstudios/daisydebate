import type { RoundBallots } from '../judge/get-ballots';
import type { RoomInfo } from '../rooms/view';
import { presetFor, roomHref } from '../rooms/state';
import {
  debateHref,
  placeholderOutcome,
  type DebateQuery,
  type Outcome,
} from './state';
import {
  endedTurn,
  formatSeconds,
  remainingSeconds,
  turns,
  type Side,
} from './turns';

export type TimelineRow = {
  readonly label: string;
  readonly length: string;
  readonly state: 'done' | 'now' | 'next';
};

type Common = {
  readonly id: string;
  readonly title: string;
  /** The room this debate came from; null for a debate known only from history. */
  readonly roomHref: string | null;
  readonly timeline: readonly TimelineRow[];
  readonly demo: readonly { readonly label: string; readonly href: string }[];
};

export type DebateView =
  | { readonly kind: 'denied'; readonly lobbyHref: string }
  | (Common & {
      readonly kind: 'live';
      readonly now: {
        readonly label: string;
        readonly side: Side | 'both';
        readonly remaining: string;
        readonly yours: boolean;
      };
      readonly next: string | null;
    })
  | (Common & {
      readonly kind: 'awaiting';
      readonly judge: 'person' | 'ai';
      readonly action: { readonly label: string; readonly href: string } | null;
      readonly note: string;
    })
  | (Common & {
      readonly kind: 'completed';
      readonly winner: Outcome;
      readonly by: 'person' | 'ai';
      /** A person's ruling shows the ballots; otherwise one line says why. */
      readonly ruling:
        | { readonly kind: 'ballots'; readonly ballots: RoundBallots }
        | { readonly kind: 'reason'; readonly reason: string };
      readonly rematchHref: string | null;
    });

const timelineFor = (turn: number): readonly TimelineRow[] =>
  turns.map((row) => ({
    label: row.label,
    length: formatSeconds(row.seconds),
    state: row.number < turn ? 'done' : row.number === turn ? 'now' : 'next',
  }));

const drawReason = 'The judge scored both sides level, so neither side wins.';

const reasonFor = (by: 'person' | 'ai'): string =>
  by === 'ai'
    ? 'The placeholder AI judge chose at random. It did not hear the round.'
    : 'The affirmative tied the burden of proof to the resolution and the negative did not answer it.';

function completedView(
  info: RoomInfo,
  query: DebateQuery,
  common: Common,
  by: 'person' | 'ai',
  ballots: RoundBallots | null,
): DebateView {
  const ruled = {
    ...common,
    kind: 'completed' as const,
    by,
    rematchHref: info.fromHistory
      ? null
      : roomHref(info.id, {
          ...presetFor('rematch'),
          judgeKind: query.judgeKind,
        }),
  };
  // A person's ballot decides the debate, unless the demo asks for an outcome.
  if (by === 'person' && ballots !== null && query.outcome === null)
    return {
      ...ruled,
      winner: ballots.judge.winner,
      ruling: { kind: 'ballots', ballots },
    };
  return {
    ...ruled,
    winner:
      query.outcome ??
      (by === 'ai' ? placeholderOutcome(info.id) : 'affirmative'),
    ruling: {
      kind: 'reason',
      reason: query.outcome === 'draw' ? drawReason : reasonFor(by),
    },
  };
}

function awaitingAction(
  info: RoomInfo,
  query: DebateQuery,
  at: (change: Partial<DebateQuery>) => string,
): { label: string; href: string } | null {
  if (query.judgeKind === 'person')
    return query.viewer === 'judge'
      ? { label: 'Submit your ballot', href: `/judge/ballot/${info.id}` }
      : null;
  return query.viewer === 'debater'
    ? { label: 'Ask the AI judge', href: at({ ruledBy: 'ai' }) }
    : null;
}

const awaitingNote = (query: DebateQuery): string => {
  if (query.judgeKind === 'ai')
    return 'The speaking is over. The placeholder AI judge rules at random and does not hear the round. Ask for a ruling when you are ready.';
  return query.viewer === 'judge'
    ? 'The speaking is over. Your ballot decides the debate.'
    : 'The speaking is over. Waiting for the judge’s ballot.';
};

function liveView(query: DebateQuery, common: Common): DebateView {
  const row = turns[query.turn - 1];
  if (row === undefined) return { kind: 'denied', lobbyHref: '/lobby' };
  const nextRow = turns[query.turn];
  return {
    ...common,
    kind: 'live',
    now: {
      label: row.label,
      side: row.side,
      remaining: formatSeconds(remainingSeconds(row)),
      yours: row.side === 'affirmative' && query.viewer === 'debater',
    },
    next: nextRow
      ? `Next: ${nextRow.label}, ${formatSeconds(nextRow.seconds)}`
      : 'Next: the ballot',
  };
}

/**
 * What the debate page shows for a state. Pure: links carry the next state,
 * and a finished debate's ballots come in from the page's read.
 */
export function debateView(
  info: RoomInfo,
  query: DebateQuery,
  ballots: RoundBallots | null = null,
): DebateView {
  if (query.viewer === 'outsider')
    return { kind: 'denied', lobbyHref: '/lobby' };
  const at = (change: Partial<DebateQuery>) =>
    debateHref(info.id, { ...query, ...change });
  const common: Common = {
    id: info.id,
    title: info.title,
    roomHref: info.fromHistory ? null : roomHref(info.id, presetFor('started')),
    timeline: timelineFor(query.turn),
    demo: [
      {
        label: 'Next turn',
        href: at({ turn: Math.min(query.turn + 1, endedTurn) }),
      },
      {
        label: 'Skip to the end',
        href: at({ turn: endedTurn, ruledBy: null }),
      },
      { label: 'Start over', href: at({ turn: 1, ruledBy: null }) },
    ],
  };
  if (query.ruledBy !== null)
    return completedView(info, query, common, query.ruledBy, ballots);
  if (query.turn < endedTurn) return liveView(query, common);
  return {
    ...common,
    kind: 'awaiting',
    judge: query.judgeKind,
    action: awaitingAction(info, query, at),
    note: awaitingNote(query),
  };
}
