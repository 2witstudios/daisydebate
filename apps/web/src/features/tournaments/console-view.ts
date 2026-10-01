import {
  assignJudges,
  consoleHref,
  consoleTabs,
  pairRound,
  publishChecklist,
  roundStateOf,
  roundStates,
  type Checklist,
  type ConsoleData,
  type ConsoleEntrant,
  type ConsoleQuery,
  type ConsoleTab,
  type Debate,
  type JudgeAssignment,
  type Pairings,
  type RoundState,
} from './console';
import { formatTime, shiftMinutes } from './dates';
import { CHECK_IN_MINUTES, roundLabels } from './schedule';

type ConsoleTabLink = {
  readonly id: ConsoleTab;
  readonly label: string;
  readonly href: string;
  readonly selected: boolean;
  readonly count?: number;
};

type RoundStep = {
  readonly n: number;
  readonly label: string;
  readonly enabled: boolean;
  /** Where the step goes: the next round state, through the driver. */
  readonly href: string;
};

type ResultRow = {
  readonly id: string;
  readonly matchup: string;
  readonly detail: string;
  readonly status:
    'Ballot in' | 'In progress' | 'Needs result' | 'Forfeit to confirm';
  readonly live: boolean;
};

type EnterResult = {
  readonly debate: string;
  readonly a: string;
  readonly b: string;
  readonly note: string;
};

export type ConsoleView = {
  readonly data: ConsoleData;
  readonly state: RoundState;
  readonly tab: ConsoleTab;
  readonly phaseLabel: string;
  readonly tabs: readonly ConsoleTabLink[];
  readonly entrantsHeading: string;
  readonly entrantsShown: readonly ConsoleEntrant[];
  readonly entrantsNote: string;
  readonly steps: readonly RoundStep[];
  readonly pairings: Pairings | null;
  readonly judges: readonly JudgeAssignment[] | null;
  readonly results: readonly ResultRow[];
  readonly enterResult: EnterResult | null;
  readonly forfeit: ResultRow | null;
  readonly publish: Checklist;
};

const tabLabels: Readonly<Record<ConsoleTab, string>> = {
  entrants: 'Entrants',
  rounds: 'Rounds',
  results: 'Results',
  moderation: 'Moderation',
  publish: 'Publish',
};

/** Entrants listed before the rest are summarized. */
const SHOWN = 9;

const phaseText = (state: RoundState, round: string, checkIn: string): string =>
  ({
    setup: `${round}: pairings not made`,
    generated: `${round}: pairings made, no judges yet`,
    assigned: `${round}: ready to release`,
    released: `${round}: released, check-in opens ${checkIn}`,
    running: `${round}: debates in progress`,
  })[state];

const stepsOf = (id: string, state: RoundState): readonly RoundStep[] =>
  [
    [1, 'Generate pairings', 'setup', 'generated'],
    [2, 'Assign judges', 'generated', 'assigned'],
    [3, 'Release to entrants', 'assigned', 'released'],
  ].map(([n, label, from, to]) => ({
    n: Number(n),
    label: String(label),
    enabled: state === from,
    href: consoleHref(id, { tab: 'rounds', round: to as RoundState }),
  }));

const judgeOf = (judges: readonly JudgeAssignment[], debate: Debate): string =>
  judges.find((item) => item.debate === debate.id)?.judge ?? '';

function resultRow(
  data: ConsoleData,
  debate: Debate,
  index: number,
  judge: string,
): ResultRow {
  const outcome = data.outcomes[index] ?? { kind: 'ballot', winner: 'a' };
  const matchup = `@${debate.a.handle} vs @${debate.b.handle}`;
  const by = `Judge @${judge}`;
  switch (outcome.kind) {
    case 'ballot':
      return {
        id: debate.id,
        matchup,
        detail: `${outcome.winner === 'a' ? 'Affirmative' : 'Negative'} won. ${by}`,
        status: 'Ballot in',
        live: false,
      };
    case 'live':
      return {
        id: debate.id,
        matchup,
        detail: `In progress, ${outcome.watching} watching. ${by}`,
        status: 'In progress',
        live: true,
      };
    case 'needs-result':
      return {
        id: debate.id,
        matchup,
        detail: `${outcome.note} ${by}`,
        status: 'Needs result',
        live: false,
      };
    case 'forfeit':
      return {
        id: debate.id,
        matchup,
        detail: `@${outcome.absent === 'a' ? debate.a.handle : debate.b.handle} ${outcome.note} ${by}`,
        status: 'Forfeit to confirm',
        live: false,
      };
  }
}

const tabLinks = (
  data: ConsoleData,
  query: ConsoleQuery,
): readonly ConsoleTabLink[] =>
  consoleTabs.map((id) => ({
    id,
    label: tabLabels[id],
    href: consoleHref(data.tournament.id, { tab: id, round: query.round }),
    selected: id === query.tab,
    ...(id === 'entrants' ? { count: data.entrants.length } : {}),
    ...(id === 'moderation' ? { count: data.moderators.length } : {}),
  }));

const enterResultOf = (
  results: readonly ResultRow[],
  debates: readonly Debate[],
): EnterResult | null => {
  const needs = results.find((row) => row.status === 'Needs result');
  const debate = debates.find((item) => item.id === needs?.id);
  return needs && debate
    ? {
        debate: debate.id,
        a: debate.a.handle,
        b: debate.b.handle,
        note: needs.detail,
      }
    : null;
};

type Plan = {
  readonly pairings: Pairings | null;
  readonly judges: readonly JudgeAssignment[] | null;
  readonly results: readonly ResultRow[];
};

/** Pairings, judges and results as far as the round state has got. */
function planOf(data: ConsoleData, state: RoundState): Plan {
  if (state === 'setup') return { pairings: null, judges: null, results: [] };
  const pairings = pairRound(data.entrants, data.tournament.places);
  const assigned = assignJudges(pairings.debates);
  const reached = (at: RoundState) =>
    roundStates.indexOf(state) >= roundStates.indexOf(at);
  return {
    pairings,
    judges: reached('assigned') ? assigned : null,
    results:
      state === 'running'
        ? pairings.debates.map((debate, index) =>
            resultRow(data, debate, index, judgeOf(assigned, debate)),
          )
        : [],
  };
}

/**
 * Everything the console shows for one tab and round state. The state comes
 * from the URL or the tournament; the real console reads it from the
 * pairing service. Judges are assigned by the system, never chosen here.
 */
export function consoleView(
  data: ConsoleData,
  query: ConsoleQuery,
): ConsoleView {
  const { tournament } = data;
  const state = roundStateOf(data, query);
  const plan = planOf(data, state);
  const checkIn = formatTime(
    shiftMinutes(tournament.startsAt, -CHECK_IN_MINUTES),
  );
  const first =
    roundLabels(tournament.structure, tournament.places)[0] ?? 'Round 1';
  return {
    data,
    state,
    tab: query.tab,
    phaseLabel: phaseText(state, first, checkIn),
    tabs: tabLinks(data, query),
    entrantsHeading: `${data.entrants.length} entered, ${data.withdrawn} withdrawn, waitlist empty`,
    entrantsShown: data.entrants.slice(0, SHOWN),
    entrantsNote: `Showing ${Math.min(SHOWN, data.entrants.length)} of ${data.entrants.length}. Removing an entrant before round 1 gives their opponent a bye. Removing or disqualifying after a round starts is recorded in the log and needs a reason.`,
    steps: stepsOf(tournament.id, state),
    ...plan,
    enterResult: enterResultOf(plan.results, plan.pairings?.debates ?? []),
    forfeit:
      plan.results.find((row) => row.status === 'Forfeit to confirm') ?? null,
    publish: publishChecklist(data, state),
  };
}
