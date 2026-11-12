/**
 * Every speaker rubric Daisy has used, as data (ADR 0125). Ten categories in
 * four groups; each debater gets 1–5 in each. The anchors say what a 1, a 3
 * and a 5 look like; 2 and 4 sit between them.
 */
/** speaker-10@1: readable history; no new ballot is written on it. */
const speaker10v1 = [
  {
    id: 'construction',
    name: 'Construction',
    categories: [
      {
        id: 'thesis',
        name: 'Thesis',
        rewards: 'One clear claim carried through',
        anchors: [
          'No central claim',
          'Claim stated, drifts',
          'Every speech serves one claim',
        ],
      },
      {
        id: 'framework',
        name: 'Framework',
        rewards: 'Set the standard and won it',
        anchors: [
          'No standard offered',
          'Standard offered, not defended',
          'Set the terms the round was judged on',
        ],
      },
      {
        id: 'analysis',
        name: 'Analysis',
        rewards: 'Warranted why, not asserted',
        anchors: [
          'Assertions only, or invented evidence',
          'Some warrants and examples',
          'Every claim warranted, examples accurate',
        ],
      },
    ],
  },
  {
    id: 'clash',
    name: 'Clash',
    categories: [
      {
        id: 'refutation',
        name: 'Refutation',
        rewards: 'Answered theirs, dropped nothing',
        anchors: [
          'Ignored the opponent',
          'Answered some, dropped some',
          'Answered every key argument, extended the answers',
        ],
      },
      {
        id: 'impact',
        name: 'Impact',
        rewards: 'Said why each argument matters',
        anchors: [
          'No stakes',
          'Stakes stated, not developed',
          'Clear magnitude, likelihood and timeframe',
        ],
      },
      {
        id: 'weighing',
        name: 'Weighing',
        rewards: 'Compared: why mine outweighs',
        anchors: [
          'No comparison',
          'Asserted “we outweigh”',
          'Explicit comparison on the opponent’s terms',
        ],
      },
    ],
  },
  {
    id: 'cross-ex',
    name: 'Cross-ex',
    categories: [
      {
        id: 'questioning',
        name: 'Questioning',
        rewards: 'Questions that set up arguments',
        anchors: [
          'Aimless, or speeches as questions',
          'Some useful concessions',
          'Won concessions used later',
        ],
      },
      {
        id: 'answering',
        name: 'Answering',
        rewards: 'Direct, honest, no evasion',
        anchors: [
          'Evasive or stalling',
          'Mostly direct',
          'Concise, honest, kept position',
        ],
      },
    ],
  },
  {
    id: 'presentation',
    name: 'Presentation',
    categories: [
      {
        id: 'organization',
        name: 'Organization',
        rewards: 'Signposted, easy to flow',
        anchors: [
          'Impossible to follow',
          'Mostly followable',
          'Roadmap, signposts, clean flow',
        ],
      },
      {
        id: 'delivery',
        name: 'Delivery',
        rewards: 'Clear, paced, persuasive',
        anchors: [
          'Unclear or rushed',
          'Understandable',
          'Clear, confident, used the time',
        ],
      },
    ],
  },
] as const;

/**
 * speaker-10@2, the coherency rubric (ADR 0125): a case is a thesis, the
 * burdens that follow from it and the warrants for each burden, and an
 * attack matters by the level of the case it reaches.
 */
const speaker10v2 = [
  {
    id: 'case',
    name: 'Case',
    categories: [
      {
        id: 'thesis',
        name: 'Thesis',
        rewards: 'One clear answer to the resolution',
        anchors: [
          'No clear answer to the resolution',
          'Thesis stated, drifts',
          'Every speech serves one thesis',
        ],
      },
      {
        id: 'burdens',
        name: 'Burdens',
        rewards: 'Set what must be true, and won it',
        anchors: [
          'No burdens set',
          'Burdens set, not defended',
          'Set the burdens the round was decided on, and won the dispute over them',
        ],
      },
      {
        id: 'warrants',
        name: 'Warrants',
        rewards: 'Each burden backed by reasons',
        anchors: [
          'Assertions only, or invented evidence',
          'Some burdens warranted',
          'Every burden warranted with reasons or accurate examples',
        ],
      },
      {
        id: 'coherence',
        name: 'Coherence',
        rewards: 'Consistent with its own thesis',
        anchors: [
          'The case contradicts itself',
          'One damaging inconsistency or concession against its own thesis',
          'Fully consistent with its own thesis and burdens',
        ],
      },
    ],
  },
  {
    id: 'clash',
    name: 'Clash',
    categories: [
      {
        id: 'refutation',
        name: 'Refutation',
        rewards: 'Attacked what their case depends on',
        anchors: [
          'Ignored the opponent',
          'Answered surface arguments, left the premises they depend on standing',
          'Defeated the premises the opponent’s case depends on, and answered attacks on its own',
        ],
      },
      {
        id: 'weighing',
        name: 'Weighing',
        rewards: 'Compared what still stands',
        anchors: [
          'No comparison',
          'Asserted “we outweigh”',
          'Explicit comparison of what still stands, with magnitude and likelihood, under the governing burdens',
        ],
      },
    ],
  },
  {
    id: 'cross-ex',
    name: 'Cross-ex',
    categories: [
      {
        id: 'questioning',
        name: 'Questioning',
        rewards: 'Won concessions on their burdens',
        anchors: [
          'Aimless, or speeches as questions',
          'Useful concessions, not used',
          'Won concessions on the opponent’s burdens and used them',
        ],
      },
      {
        id: 'answering',
        name: 'Answering',
        rewards: 'Direct, and kept the case intact',
        anchors: [
          'Evasive or stalling',
          'Direct, but gave away part of its own case',
          'Direct and honest, and kept its thesis and burdens intact',
        ],
      },
    ],
  },
  {
    id: 'presentation',
    name: 'Presentation',
    categories: [
      {
        id: 'organization',
        name: 'Organization',
        rewards: 'Case structure easy to follow',
        anchors: [
          'Impossible to follow',
          'Mostly followable',
          'The case structure (thesis, burdens, signposts) is easy to follow',
        ],
      },
      {
        id: 'delivery',
        name: 'Delivery',
        rewards: 'Clear, paced, persuasive',
        anchors: [
          'Unclear or rushed',
          'Understandable',
          'Clear, confident, used the time',
        ],
      },
    ],
  },
] as const;

/** Every rubric Daisy has used, by the version stored on its ballots. */
export const ballotRubrics = {
  'speaker-10@1': speaker10v1,
  'speaker-10@2': speaker10v2,
} as const;
export type BallotRubricVersion = keyof typeof ballotRubrics;
