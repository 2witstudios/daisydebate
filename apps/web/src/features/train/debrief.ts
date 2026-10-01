import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { savableArguments, speechNotes } from '../../ui/mock/train-practice';
import { drillHref } from './plan';
import { trainDestinations } from './actions';
import { practiceHref } from './practice';
import { withDone, withPlanContext, type HubQuery } from './query';
import { OWN_MOTION, type PracticeConfig } from './practice';
import { opponents } from './practice';
import { buildTurns, effectiveOpponent, type Side, type Turn } from './turns';
import { formatClock } from './speech-clock';

/** The debrief's URL state: how far the debate got and what was done here. */
export type DebriefQuery = {
  /** Speeches count only when their turn came before this position. */
  readonly upto: number;
  /** The speech whose notes are open, from zero. */
  readonly speech: number;
  /** Arguments saved to review, as the flow's stand-in for the library. */
  readonly saved: readonly string[];
  /** The save button was pressed (with or without a choice). */
  readonly saveAttempted: boolean;
  readonly feedbackSent: boolean;
};

export const defaultDebriefQuery: DebriefQuery = {
  upto: 99,
  speech: 0,
  saved: [],
  saveAttempted: false,
  feedbackSent: false,
};

const knownIds = new Set(savableArguments.map((a) => a.id));

const all = (value: string | readonly string[] | undefined): string[] =>
  typeof value === 'string' ? [value] : [...(value ?? [])];

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

const numberParam = (fallback: number) =>
  z
    .string()
    .regex(/^\d{1,2}$/)
    .transform(Number)
    .catch(fallback);

/** Reads the debrief's URL state; bad or missing values become defaults. */
export function parseDebriefQuery(params: SearchParams): DebriefQuery {
  return {
    upto: numberParam(defaultDebriefQuery.upto).parse(first(params['upto'])),
    speech: numberParam(0).parse(first(params['speech'])),
    saved: [...new Set(all(params['saved']))].filter((id) => knownIds.has(id)),
    saveAttempted: first(params['save']) === '1',
    feedbackSent: first(params['sent']) === '1',
  };
}

type SpeechRow = {
  readonly name: string;
  readonly used: string;
  readonly marks: readonly (readonly [label: string, ok: boolean])[];
  readonly selected: boolean;
  readonly index: number;
};

export type DebriefView = {
  readonly intro: string;
  /** No speech was given before the debate ended. */
  readonly empty: boolean;
  readonly stats: readonly {
    readonly label: string;
    readonly value: string;
    readonly detail: string;
  }[];
  readonly speeches: readonly SpeechRow[];
  readonly selected: {
    readonly name: string;
    readonly note: string;
    readonly fix: string;
  } | null;
  readonly work: readonly {
    readonly title: string;
    readonly detail: string;
    readonly href: string;
  }[];
  readonly arguments: readonly {
    readonly id: string;
    readonly text: string;
    readonly checked: boolean;
  }[];
  readonly savedCount: number;
  readonly saveError: boolean;
};

const pct = (used: number, length: number): number =>
  Math.min(100, Math.round((used / length) * 100));

const usedLabel = (length: number, delta: number): string =>
  delta < 0
    ? `${formatClock((length + delta) * 1000)} of ${formatClock(length * 1000)}`
    : delta === 0
      ? `${formatClock(length * 1000)} used`
      : `${formatClock(length * 1000)} used, ${delta} s over`;

const workItems = [
  {
    after: 1,
    title: 'Finish the impact',
    detail: 'Second argument had no stated impact.',
    drill: 'impact',
  },
  {
    after: 2,
    title: 'Answer the strongest point',
    detail: 'The freight point went unanswered.',
    drill: 'responding',
  },
  {
    after: 2,
    title: 'Finish inside the clock',
    detail: 'Turn 3 ran 12 seconds over.',
    drill: 'claim',
  },
] as const;

const opponentIntro: Readonly<Record<(typeof opponents)[number], string>> = {
  ai: 'against the AI debater',
  both: 'driving both sides',
  solo: 'working solo',
};

type Notes = NonNullable<(typeof speechNotes)[number]>;

const total = (
  notes: readonly (Notes | undefined)[],
  pick: (n: Notes) => number,
) => notes.reduce((sum, n) => sum + (n ? pick(n) : 0), 0);

function statsFor(
  notes: readonly (Notes | undefined)[],
  length: number,
): DebriefView['stats'] {
  const given = notes.length;
  const used =
    given === 0
      ? 0
      : Math.round(
          total(notes, (n) => pct(length + n.deltaSeconds, length)) / given,
        );
  return [
    {
      label: 'Arguments complete',
      value: `${total(notes, (n) => n.arguments.complete)} of ${total(notes, (n) => n.arguments.total)}`,
      detail: 'claim, warrant and impact',
    },
    {
      label: 'Opposing points answered',
      value: `${total(notes, (n) => n.answered.done)} of ${total(notes, (n) => n.answered.total)}`,
      detail: 'across your speeches',
    },
    {
      label: 'Speaking time used',
      value: `${used}%`,
      detail: `across your ${given === 1 ? 'one speech' : `${given} speeches`}`,
    },
  ];
}

const yourName = (turn: Turn): string => turn.name.replace(': ', ': your ');

function candidateArguments(
  given: number,
  saved: readonly string[],
): DebriefView['arguments'] {
  return savableArguments
    .filter((arg) => given >= arg.afterSpeeches)
    .map((arg) => ({
      id: arg.id,
      text: arg.text,
      checked:
        saved.length > 0 ? saved.includes(arg.id) : arg.afterSpeeches === 1,
    }));
}

const introFor = (config: PracticeConfig, side: Side): string =>
  `You were ${side === 'aff' ? 'Aff' : 'Neg'}, ${opponentIntro[effectiveOpponent(config)]}, on ${config.motion === OWN_MOTION ? 'your own motion' : 'a sample motion'}.`;

/** The debrief for the speeches given so far in a practice. */
export function debriefView(
  config: PracticeConfig,
  side: Side,
  query: DebriefQuery,
): DebriefView {
  const mine = buildTurns(config, side).filter(
    (turn) => turn.speaker === 'you' && turn.seq < query.upto,
  );
  const length = config.rules.speechMinutes * 60;
  const notes = mine.map((_, index) => speechNotes[index % speechNotes.length]);
  const open = Math.min(query.speech, Math.max(0, mine.length - 1));
  const openTurn = mine[open];
  return {
    intro: introFor(config, side),
    empty: mine.length === 0,
    stats: statsFor(notes, length),
    speeches: mine.map((turn, index) => ({
      name: yourName(turn),
      used: usedLabel(length, notes[index]?.deltaSeconds ?? 0),
      marks: notes[index]?.marks ?? [],
      selected: index === open,
      index,
    })),
    selected: openTurn
      ? {
          name: yourName(openTurn),
          note: notes[open]?.note ?? '',
          fix: notes[open]?.fix ?? '',
        }
      : null,
    work: workItems
      .filter((item) => mine.length >= item.after)
      .map((item) => ({
        title: item.title,
        detail: item.detail,
        href: drillHref(item.drill),
      })),
    arguments: candidateArguments(mine.length, query.saved),
    savedCount: query.saved.length,
    saveError: query.saveAttempted && query.saved.length === 0,
  };
}

/** The debrief URL for a query with changes, written with only non-defaults. */
export function debriefHref(
  config: PracticeConfig,
  plan: HubQuery,
  query: DebriefQuery,
  change: Partial<DebriefQuery> = {},
): string {
  const next = { ...query, ...change };
  return practiceHref(
    trainDestinations.practiceDebrief,
    config,
    plan,
    debriefExtras(next),
  );
}

const debriefExtras = (query: DebriefQuery): Record<string, string> => ({
  ...(query.upto !== defaultDebriefQuery.upto
    ? { upto: String(query.upto) }
    : {}),
  ...(query.speech !== 0 ? { speech: String(query.speech) } : {}),
  ...(query.feedbackSent ? { sent: '1' } : {}),
});

/** Hidden fields that keep a debrief form's own state in its GET answer. */
export function debriefFields(
  config: PracticeConfig,
  plan: HubQuery,
  query: DebriefQuery,
  keep: { readonly saved: boolean },
): readonly (readonly [name: string, value: string])[] {
  const url = new URL(
    practiceHref(
      trainDestinations.practiceDebrief,
      config,
      plan,
      debriefExtras(query),
    ),
    'http://local',
  );
  const fields = [...url.searchParams.entries()];
  return keep.saved
    ? [...fields, ...query.saved.map((id) => ['saved', id] as const)]
    : fields;
}

/** Where "Back to Train" goes: a practice with a speech counts toward the plan. */
export const backToTrainHref = (plan: HubQuery, gaveSpeech: boolean): string =>
  withPlanContext(
    trainDestinations.hub,
    gaveSpeech ? withDone(plan, 'guided-practice') : plan,
  );
