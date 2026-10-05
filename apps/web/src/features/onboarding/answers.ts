import {
  clubChoices,
  experienceChoices,
  formatChoices,
  lengthChoices,
  topicChoices,
  wantChoices,
  type Club,
  type Experience,
  type Format,
  type Length,
  type Topic,
  type Want,
} from '@daisy/protocol';

export type AboutAnswers = {
  readonly wants: readonly Want[];
  readonly club: Club | null;
};
export type ExperienceAnswers = {
  readonly experience: Experience | null;
  readonly formats: readonly Format[];
  readonly length: Length | null;
};
export type TopicsAnswers = { readonly topics: readonly Topic[] };

/** One questionnaire step's answers, as a member posts them. */
export type StepAnswers =
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
  experience: null,
  formats: [],
  length: null,
  topics: [],
  completedAt: null,
};

export type StepRefusal = 'unknown-step' | 'invalid-value' | 'repeated-value';

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

const fieldsOf: Record<QuestionStep, readonly string[]> = {
  about: ['wants', 'club'],
  experience: ['experience', 'formats', 'length'],
  topics: ['topics'],
};

const isQuestionStep = (value: unknown): value is QuestionStep =>
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
      };
    case 'experience':
      return {
        step,
        experience: one(experienceChoices, input.experience),
        formats: many(formatChoices, input.formats),
        length: one(lengthChoices, input.length),
      };
    case 'topics':
      return { step, topics: many(topicChoices, input.topics) };
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
