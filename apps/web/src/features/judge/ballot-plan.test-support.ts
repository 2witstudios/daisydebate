import { fixtureRules, oneOnOneFormatFixture } from '@daisy/protocol/testing';
import { ballotPlanFor, type BallotPlan } from './ballot-plan';

/** The two debaters every sample ballot names, and their Round's rules. */
export const sampleBallotRound = {
  rules: fixtureRules(oneOnOneFormatFixture),
  participants: [
    {
      id: 'a'.repeat(24),
      label: 'Maya Singh',
      seat: { kind: 'side' as const, side: 'affirmative', slot: 0 },
    },
    {
      id: 'n'.repeat(24),
      label: 'Daniel Kim',
      seat: { kind: 'side' as const, side: 'negative', slot: 0 },
    },
  ],
};

/** The sample Round's ballot: Daisy's winner ballot over its two debaters. */
export const sampleBallotPlan: BallotPlan = ballotPlanFor(sampleBallotRound);
