import type { StructurePart } from '../../features/train/summary';

/** Sample prompt for one round of a drill. */
type DrillPrompt = {
  readonly motion: string;
  readonly task: string;
};

type DrillContent = {
  readonly title: string;
  readonly rounds: readonly DrillPrompt[];
};

export const drillContent: Readonly<Record<StructurePart, DrillContent>> = {
  impact: {
    title: 'Impact drill',
    rounds: [
      {
        motion: 'Cities should fund public transit before roads.',
        task: 'You are Aff. Argue that access comes first.',
      },
      {
        motion: 'Schools should ban phones in class.',
        task: 'You are Aff. Argue that attention comes first.',
      },
    ],
  },
  responding: {
    title: 'Responding drill',
    rounds: [
      {
        motion: 'Cities should fund public transit before roads.',
        task: 'Their point: “Roads carry the buses, the ambulances and the trucks that transit depends on.” Answer it as a claim, a warrant and an impact.',
      },
      {
        motion: 'Schools should ban phones in class.',
        task: 'Their point: “A ban punishes every student for what a few do.” Answer it as a claim, a warrant and an impact.',
      },
    ],
  },
  claim: {
    title: 'Claim drill',
    rounds: [
      {
        motion: 'Voting should be compulsory.',
        task: 'You are Aff. State the one thing you ask the judge to believe.',
      },
      {
        motion: 'Schools should ban phones in class.',
        task: 'You are Neg. State the one thing you ask the judge to believe.',
      },
    ],
  },
  warrant: {
    title: 'Warrant drill',
    rounds: [
      {
        motion: 'Voting should be compulsory.',
        task: 'You are Aff. Give the reason compulsory voting widens who is heard.',
      },
      {
        motion: 'Cities should fund public transit before roads.',
        task: 'You are Neg. Give the reason roads cannot wait.',
      },
    ],
  },
};
