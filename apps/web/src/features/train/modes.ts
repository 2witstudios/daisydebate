import { trainDestinations } from './actions';
import type { TrainingSummary } from './summary';

export type ModeId = 'practice' | 'drills' | 'review';

export type ModeCard = {
  readonly id: ModeId;
  readonly title: string;
  readonly blurb: string;
  /** The small line beside the title: time, or where the account stands. */
  readonly status: string;
  /** Null when there is nothing to open yet. */
  readonly cta: { readonly label: string; readonly href: string } | null;
};

/** Where the account is in the hub: new, working the plan, or finished. */
export type HubStage = 'first' | 'plan' | 'done';

const reviewStatus = (summary: TrainingSummary, stage: HubStage): string => {
  if (summary.saved.total === 0) return 'Nothing saved yet';
  return stage === 'done' || summary.saved.due === 0
    ? 'All caught up'
    : `${summary.saved.due} due today`;
};

/** The three ways to train, worded for where the account stands. */
export const modeCards = (
  summary: TrainingSummary,
  stage: HubStage,
): readonly ModeCard[] => [
  {
    id: 'practice',
    title: 'Debate the AI',
    blurb:
      'A full IPDA round by voice: speeches, cross-examination and a ballot from an AI judge.',
    status: 'About 45 min',
    cta: { label: 'Start an AI debate', href: '/ai-debate' },
  },
  {
    id: 'drills',
    title: 'Argument drills',
    blurb:
      'Write or say one claim, warrant and impact. See what is missing, revise, save.',
    status: stage === 'first' ? 'Start here' : '5 to 10 min',
    cta: { label: 'Start a drill', href: trainDestinations.drill },
  },
  {
    id: 'review',
    title: 'Spaced review',
    blurb: 'Saved arguments come back just before you would forget them.',
    status: reviewStatus(summary, stage),
    cta:
      summary.saved.total === 0
        ? null
        : { label: 'Review', href: trainDestinations.review },
  },
];
