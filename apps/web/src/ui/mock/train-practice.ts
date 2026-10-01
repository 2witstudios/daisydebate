import type { OpponentAdapter } from '../../features/train/opponent';

/** Sample coaching for one speech. */
export type CoachScript = {
  readonly prompts: readonly string[];
  readonly hint: string;
  readonly text: string;
};

/** The account's own speeches, in the order they are given. */
export const yourScripts: readonly CoachScript[] = [
  {
    prompts: [
      'State your claim in one sentence',
      'Give the reason it is true',
      'Say why it matters and to whom',
    ],
    hint: 'Start with the claim in one sentence. Give your reason next, and say who is affected before you move on.',
    text: 'A fair city funds the thing every other service depends on. My first argument is that access comes first, because a worker who cannot reach a clinic or a school loses more than the fare',
  },
  {
    prompts: [
      'Answer their points in the order they made them',
      'Extend your strongest argument',
      'Say why it outweighs',
    ],
    hint: 'Take their strongest point first. Say what it claims, why it fails, and what that means for the debate.',
    text: 'Their first point says roads and transit do not compete. But the budget in this motion is fixed, which means',
  },
  {
    prompts: [
      'Name the one issue the debate turns on',
      'Say why you win it',
      'End on the impact',
    ],
    hint: 'Pick the one issue you win and give the judge a reason to vote on it.',
    text: 'This debate comes down to one question: who can reach the services that every other budget line pays for',
  },
];

/** Coach prompts for listening turns; the opponent's words come from the adapter. */
export const listeningScripts: readonly Omit<CoachScript, 'text'>[] = [
  {
    prompts: [
      'Write down each claim it makes',
      'Mark the claim that hurts you most',
      'Note one point you can turn',
    ],
    hint: 'Number the opponent’s points as you hear them. You will answer them in order.',
  },
  {
    prompts: [
      'Listen for what it drops',
      'Note any new argument in this speech',
      'Plan your closing',
    ],
    hint: 'New arguments late in a debate are hard to answer. Note them so you can point them out.',
  },
  {
    prompts: [
      'Mark what it adds that is new',
      'Find the point it leans on most',
      'Decide what you answer first',
    ],
    hint: 'Whatever the opponent leans on most is where the debate will be decided.',
  },
];

const opponentTexts: readonly string[] = [
  'The motion assumes roads and transit compete for the same dollars. They do not. Roads carry the buses, the ambulances and the trucks that transit itself depends on. My first point is that',
  'The Aff never answered the freight point. Even if access matters, they need to show',
  'Nothing in the last speech changes the freight point. Even on their own framing, the motion asks us to',
];

/** A sample opponent: scripted speeches that always answer. */
export const mockOpponent: OpponentAdapter = ({ ordinal }) => ({
  ok: true,
  text: opponentTexts[ordinal % opponentTexts.length] ?? '',
});

/** Sample automated notes for one of the account's speeches. */
export type SpeechNotes = {
  readonly marks: readonly (readonly [label: string, ok: boolean])[];
  readonly note: string;
  readonly fix: string;
  /** Seconds over (+) or under (-) the speech length. */
  readonly deltaSeconds: number;
  readonly arguments: { readonly complete: number; readonly total: number };
  readonly answered: { readonly done: number; readonly total: number };
  /** The drill the note points at when something was missed. */
  readonly drill: 'impact' | 'responding' | 'claim';
};

export const speechNotes: readonly SpeechNotes[] = [
  {
    marks: [
      ['Claim', true],
      ['Warrant', true],
      ['Impact', false],
    ],
    note: 'Your first argument is complete. Your second states a claim and a reason, but never says why it matters or to whom.',
    fix: 'Add one sentence that starts with “This matters because”.',
    deltaSeconds: -36,
    arguments: { complete: 1, total: 2 },
    answered: { done: 0, total: 0 },
    drill: 'impact',
  },
  {
    marks: [
      ['Answers', true],
      ['Order', true],
      ['Weighing', false],
    ],
    note: 'You answered four of five opposing points, in order. You did not answer the freight point, and you ran 12 seconds over.',
    fix: 'Take the strongest point first, even if it is hard, and finish 15 seconds earlier.',
    deltaSeconds: 12,
    arguments: { complete: 0, total: 0 },
    answered: { done: 4, total: 5 },
    drill: 'responding',
  },
  {
    marks: [
      ['Issue named', true],
      ['Why you win', true],
      ['Impact', true],
    ],
    note: 'A clear final issue and a finished impact.',
    fix: 'Keep this shape for your next practice.',
    deltaSeconds: 0,
    arguments: { complete: 2, total: 2 },
    answered: { done: 0, total: 0 },
    drill: 'claim',
  },
];

/** Sample arguments the account may save from a debrief. */
export const savableArguments: readonly {
  readonly id: string;
  readonly text: string;
  /** The fewest speeches given before this argument exists. */
  readonly afterSpeeches: number;
}[] = [
  {
    id: 'a0',
    text: 'Access to services comes before any one budget line, because people cannot use what they cannot reach.',
    afterSpeeches: 1,
  },
  {
    id: 'a1',
    text: 'Fixed budgets force a choice, so funding roads first takes it away from transit riders.',
    afterSpeeches: 1,
  },
  {
    id: 'a2',
    text: 'The opponent’s freight point, with your answer (you did not make one yet).',
    afterSpeeches: 2,
  },
];
