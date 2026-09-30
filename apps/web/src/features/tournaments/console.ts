import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { roundLabels } from './schedule';
import { tournamentRoutes } from './routes';
import type { Tournament } from './tournament';

export const consoleTabs = [
  'entrants',
  'rounds',
  'results',
  'moderation',
  'publish',
] as const;
export type ConsoleTab = (typeof consoleTabs)[number];

/** How far the first round's preparation has gone. */
export const roundStates = [
  'setup',
  'generated',
  'assigned',
  'released',
  'running',
] as const;
export type RoundState = (typeof roundStates)[number];

export type ConsoleQuery = {
  readonly tab: ConsoleTab;
  /** Null: the tournament's own state decides. */
  readonly round: RoundState | null;
};

const schema = z.object({
  tab: z.enum(consoleTabs).catch('rounds'),
  round: z.enum(roundStates).nullable().catch(null),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the console URL; bad or missing values become defaults. */
export const parseConsoleQuery = (params: SearchParams): ConsoleQuery =>
  schema.parse({
    tab: first(params['tab']),
    round: first(params['round']) ?? null,
  });

export function consoleHref(
  id: string,
  query: { readonly tab: ConsoleTab; readonly round: RoundState | null },
): string {
  const params = new URLSearchParams();
  if (query.tab !== 'rounds') params.set('tab', query.tab);
  if (query.round !== null) params.set('round', query.round);
  const search = params.toString();
  const base = tournamentRoutes.console(id);
  return search === '' ? base : `${base}?${search}`;
}

export type ConsoleEntrant = {
  readonly seed: number;
  readonly handle: string;
  readonly rating: number;
  readonly status: 'Bye' | 'Checked in' | 'Not checked in';
};

export type Debate = {
  readonly id: string;
  readonly a: ConsoleEntrant;
  readonly b: ConsoleEntrant;
  readonly room: string;
};

export type Pairings = {
  readonly debates: readonly Debate[];
  /** Top seeds that skip round 1 when fewer than all places are taken. */
  readonly byes: readonly ConsoleEntrant[];
};

/**
 * Round 1 from the seeds: the top seeds take byes when fewer than `places`
 * entered, and the rest pair highest against lowest. Pure; the pairing
 * service replaces it.
 */
export function pairRound(
  entrants: readonly ConsoleEntrant[],
  places: number,
): Pairings {
  const ordered = [...entrants].sort((a, b) => a.seed - b.seed);
  const byeCount = Math.max(0, places - ordered.length);
  const byes = ordered.slice(0, byeCount);
  const rest = ordered.slice(byeCount);
  const debates = Array.from(
    { length: Math.floor(rest.length / 2) },
    (_, i) => {
      const a = rest[i];
      const b = rest[rest.length - 1 - i];
      return a && b ? [{ id: `D${i + 1}`, a, b, room: `Room ${i + 1}` }] : [];
    },
  ).flat();
  return { debates, byes };
}

export type JudgeAssignment = {
  readonly debate: string;
  readonly judge: string;
  readonly conflict: 'Clear' | 'Reassigned';
};

/**
 * One judge per debate from the volunteers, in order. A conflict check
 * can swap a judge; the organizer never chooses (a sample rule: every sixth
 * assignment reads as swapped).
 */
export const assignJudges = (
  debates: readonly Debate[],
): readonly JudgeAssignment[] =>
  debates.map((debate, index) => ({
    debate: debate.id,
    judge: `judge-${String(index + 1).padStart(2, '0')}`,
    conflict: index % 6 === 5 ? 'Reassigned' : 'Clear',
  }));

export type Outcome =
  | { readonly kind: 'ballot'; readonly winner: 'a' | 'b' }
  | { readonly kind: 'live'; readonly watching: number }
  | { readonly kind: 'needs-result'; readonly note: string }
  | {
      readonly kind: 'forfeit';
      readonly absent: 'a' | 'b';
      readonly note: string;
    };

export type ConsoleData = {
  readonly tournament: Tournament;
  readonly entrants: readonly ConsoleEntrant[];
  readonly withdrawn: number;
  readonly volunteers: number;
  /** Rounds finished so far. */
  readonly roundsDone: number;
  /** One sample outcome per debate, used once debates are running. */
  readonly outcomes: readonly Outcome[];
  /** Round state the tournament is in when the URL names none. */
  readonly defaultRound: RoundState;
  readonly report: { readonly debate: string; readonly by: string } | null;
  readonly moderators: readonly {
    readonly handle: string;
    readonly state: 'Active' | 'Invited';
  }[];
  readonly log: readonly { readonly at: string; readonly text: string }[];
};

/** The round state on screen: the URL's, else the tournament's own. */
export const roundStateOf = (
  data: ConsoleData,
  query: ConsoleQuery,
): RoundState => query.round ?? data.defaultRound;

export type Checklist = {
  readonly items: readonly { readonly ok: boolean; readonly text: string }[];
  readonly ready: boolean;
};

/** What stands between the organizer and publishing results. */
export function publishChecklist(
  data: ConsoleData,
  state: RoundState,
): Checklist {
  const total = roundLabels(
    data.tournament.structure,
    data.tournament.places,
  ).length;
  const running = state === 'running';
  const missing = running
    ? data.outcomes.filter((o) => o.kind === 'needs-result').length
    : 0;
  const reports = running && data.report ? 1 : 0;
  const done = data.roundsDone;
  const complete = done === total && missing === 0 && reports === 0;
  const items = [
    {
      ok: done === total,
      text: `All ${total} rounds complete (${done} of ${total} done${running ? `, round ${done + 1} in progress` : ''})`,
    },
    { ok: reports === 0, text: `No open conduct reports (${reports} open)` },
    {
      ok: missing === 0,
      text: `No debate is missing a result (${missing} missing)`,
    },
    { ok: complete, text: 'Final standings can be computed from ballots' },
  ];
  return { items, ready: items.every((item) => item.ok) };
}
