import {
  clubChoices,
  experienceChoices,
  interestCategoryChoices,
  wantChoices,
  type Club,
  type Experience,
  type InterestCategory,
  type Want,
} from '@daisy/protocol';

type AboutAnswers = {
  readonly wants: readonly Want[];
  readonly club: Club | null;
  /** The club's name as the member wrote it, when they named one. */
  readonly clubName: string | null;
};
type ExperienceAnswers = {
  readonly experience: Experience | null;
  /** Leagues the member has been affiliated with, as they wrote them. */
  readonly leagues: readonly string[];
};
type TopicsAnswers = { readonly topics: readonly InterestCategory[] };

/** One questionnaire step's answers, as a member posts them. */
type StepAnswers =
  | ({ readonly step: 'about' } & AboutAnswers)
  | ({ readonly step: 'experience' } & ExperienceAnswers)
  | ({ readonly step: 'topics' } & TopicsAnswers);

export type QuestionStep = StepAnswers['step'];

/** Everything a member has answered, and when they finished (ISO, UTC). */
export type OnboardingAnswers = AboutAnswers &
  ExperienceAnswers &
  TopicsAnswers & { readonly completedAt: string | null };

export const emptyAnswers: OnboardingAnswers = {
  wants: [],
  club: null,
  clubName: null,
  experience: null,
  leagues: [],
  topics: [],
  completedAt: null,
};

type StepRefusal = 'unknown-step' | 'invalid-value' | 'repeated-value';

export type ParsedStep =
  | { readonly ok: true; readonly value: StepAnswers }
  | { readonly ok: false; readonly reason: StepRefusal };

class Refused {
  constructor(readonly reason: StepRefusal) {}
}

const isOneOf = <T extends string>(
  choices: readonly T[],
  value: unknown,
): value is T => typeof value === 'string' && choices.includes(value as T);

function one<T extends string>(choices: readonly T[], value: unknown) {
  if (value === undefined || value === null) return null;
  if (!isOneOf(choices, value)) throw new Refused('invalid-value');
  return value;
}

function many<T extends string>(choices: readonly T[], value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Refused('invalid-value');
  const picked = value.map((item: unknown) => {
    if (!isOneOf(choices, item)) throw new Refused('invalid-value');
    return item;
  });
  if (new Set(picked).size !== picked.length)
    throw new Refused('repeated-value');
  return picked;
}

/** How long one freely-written name (a club or league) may be. */
const NAME_MAX = 60;
/** How many freely-written leagues one answer may carry. */
const LEAGUES_MAX = 12;

/** One freely-written name, or null for nothing: trimmed, bounded, one line. */
function name(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Refused('invalid-value');
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > NAME_MAX || /\r|\n/.test(trimmed))
    throw new Refused('invalid-value');
  return trimmed;
}

/**
 * Free-text leagues: the checked chips plus whatever was typed, comma
 * separated. Empties are noise and drop; the same league spelled twice
 * (a chip and the field) merges into the first spelling; only a name
 * over the bound or too many leagues refuses.
 */
function manyOpen(items: readonly unknown[]): string[] {
  const picked = items.flatMap((item) =>
    typeof item === 'string'
      ? item
          .split(',')
          .map((league) => league.trim())
          .filter((league) => league !== '')
      : (() => {
          throw new Refused('invalid-value');
        })(),
  );
  if (picked.some((league) => league.length > NAME_MAX))
    throw new Refused('invalid-value');
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const league of picked) {
    const key = league.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(league);
  }
  if (unique.length > LEAGUES_MAX) throw new Refused('invalid-value');
  return unique;
}

/** Any supplied shape as a list of items for manyOpen to validate. */
function suppliedItems(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

const fieldsOf: Record<QuestionStep, readonly string[]> = {
  about: ['wants', 'club', 'clubName'],
  experience: ['experience', 'leagues', 'leagueOther'],
  topics: ['topics'],
};

export const isQuestionStep = (value: unknown): value is QuestionStep =>
  typeof value === 'string' && Object.hasOwn(fieldsOf, value);

function read(
  step: QuestionStep,
  input: Readonly<Record<string, unknown>>,
): StepAnswers {
  switch (step) {
    case 'about':
      return {
        step,
        wants: many(wantChoices, input.wants),
        club: one(clubChoices, input.club),
        clubName: input.club === 'joining' ? name(input.clubName) : null,
      };
    case 'experience':
      return {
        step,
        experience: one(experienceChoices, input.experience),
        leagues: manyOpen([
          ...suppliedItems(input.leagues),
          ...suppliedItems(input.leagueOther),
        ]),
      };
    case 'topics':
      return { step, topics: many(interestCategoryChoices, input.topics) };
  }
}

/**
 * One questionnaire step's answers from an untrusted body: `step` names
 * the step and the other keys are exactly that step's fields. A value off
 * its fixed list, a repeat or a field from another step refuses the whole
 * step; a field left out means nothing chosen.
 */
export function parseStepAnswers(input: unknown): ParsedStep {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { ok: false, reason: 'unknown-step' };
  const body = input as Readonly<Record<string, unknown>>;
  if (!isQuestionStep(body.step)) return { ok: false, reason: 'unknown-step' };
  const allowed = fieldsOf[body.step];
  if (Object.keys(body).some((key) => key !== 'step' && !allowed.includes(key)))
    return { ok: false, reason: 'invalid-value' };
  try {
    return { ok: true, value: read(body.step, body) };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    throw error;
  }
}
