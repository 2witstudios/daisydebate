import type {
  BallotDefinitionValue,
  EventBallotView,
  JudgeBallotView,
} from '@daisy/protocol/lobby/ballot-read';
import { isScoreOnScale } from '@daisy/protocol';
import { linkTo, type TabAction } from './action';
import { hostRoutes } from './routes';
import { lockedSetting, type ResolvedSetting } from './settings';
import type { EventSwitch } from './setup';

type WrittenRule = 'required' | 'optional' | 'off';

/**
 * The typed settings of a ballot. Every field is something a host can
 * choose, and the judge's ballot is drawn from nothing else.
 */
export type BallotDefinition = BallotDefinitionValue;

/** Who a judge scores: a side's entry or a section's speaker. */
export type BallotSubject = {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
};

export type BallotDraft = {
  readonly winner: string | null;
  readonly points: Readonly<Record<string, number>>;
  readonly reason: string;
};

/** One judge's ballot for one fixture, before it is submitted. */
export type JudgeBallot = {
  readonly context: string;
  readonly resolution: string | null;
  readonly definition: BallotDefinition;
  readonly subjects: readonly BallotSubject[];
  readonly draft: BallotDraft;
  readonly reasonReaders: string;
};

/** What a host may choose for one part of the ballot, as labelled options. */
export type BallotOption = {
  readonly id: 'screening';
  readonly label: string;
  readonly detail: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly value: string;
};

export type BallotSettings = {
  readonly event: EventSwitch;
  readonly setup: TabAction;
  readonly lede: string;
  readonly saveLabel: string;
  /**
   * The ballot part by part. An event that follows a template has its whole
   * definition pinned, so every part is locked and only what is not in the
   * definition (text screening) is the host's to choose.
   */
  readonly sections: readonly {
    readonly heading: string;
    readonly locked: readonly ResolvedSetting[];
    readonly options: readonly BallotOption[];
  }[];
  readonly definition: BallotDefinition;
  readonly preview: {
    readonly lede: string;
    readonly subjects: readonly BallotSubject[];
    readonly draft: BallotDraft;
  };
};

const writtenLabels = {
  required: 'Required',
  optional: 'Optional',
  off: 'Off',
} as const satisfies Record<WrittenRule, string>;

const stepLabel = (step: number): string =>
  step === 0.5 ? 'Halves' : step === 1 ? 'Whole points' : `Steps of ${step}`;

/**
 * The parts of a pinned ballot definition, section by section, as the
 * settings screen lists them locked. One function, so the locked parts can
 * never disagree with the definition the preview draws.
 */
function pinnedBallotParts(
  definition: BallotDefinition,
  source: ResolvedSetting['source'],
): readonly {
  readonly heading: string;
  readonly locked: readonly ResolvedSetting[];
}[] {
  const part = (label: string, value: string): ResolvedSetting => ({
    keys: ['ballot.definition'],
    label,
    value,
    source,
    control: lockedSetting,
    attention: null,
  });
  const { points, written } = definition;
  return [
    {
      heading: 'Points',
      locked: [
        part(
          'Point scale',
          points === null
            ? 'None'
            : `${points.scale.min} to ${points.scale.max}`,
        ),
        ...(points === null
          ? []
          : [
              part('Step', stepLabel(points.scale.step)),
              part(
                'Winner may have fewer points',
                definition.decision.kind === 'winner' &&
                  definition.decision.lowPointWin
                  ? 'Yes'
                  : 'No',
              ),
            ]),
        part('Ranks', definition.speakerRanks ? 'On' : 'Off'),
        part(
          'Criteria',
          points?.criteria.kind !== 'grid'
            ? 'None, one score each'
            : points.criteria.groups
                .flatMap((group) =>
                  group.categories.map((category) => category.name),
                )
                .join(', '),
        ),
      ],
    },
    {
      heading: 'Outcomes',
      // An elimination fixture must advance someone, so a double loss is a
      // prelim's outcome only.
      locked: [
        part(
          'Double loss',
          definition.decision.kind === 'winner' &&
            definition.decision.doubleLoss
            ? 'Prelims only'
            : 'Never',
        ),
      ],
    },
    {
      heading: 'Written',
      locked: [
        part(
          'Reason for decision',
          writtenLabels[
            written.reason === null
              ? 'off'
              : written.reason.required
                ? 'required'
                : 'optional'
          ],
        ),
        part(
          'Feedback to each debater',
          writtenLabels[
            written.feedback === null
              ? 'off'
              : written.feedback.required
                ? 'required'
                : 'optional'
          ],
        ),
      ],
    },
  ];
}

/**
 * The settings preview's prelim, drawn with sample names. Every ballot
 * settings screen previews with these, the walk's and the stored event's.
 */
export const sampleBallotPreview: BallotSettings['preview'] = {
  lede: 'A prelim round, with sample names',
  subjects: [
    { id: 'jensen', name: 'Jensen', role: 'Affirmative' },
    { id: 'doyle', name: 'Doyle', role: 'Negative' },
  ],
  draft: { winner: 'jensen', points: { jensen: 28.5, doyle: 27 }, reason: '' },
};

/**
 * A preview's sample answers, fitted to the definition it draws: a sample
 * score off that definition's scale or step reads as its default instead,
 * so a 1 to 10 ballot never shows a 28.5.
 */
export function previewDraftOn(
  definition: BallotDefinition,
  draft: BallotDraft,
): BallotDraft {
  const points = definition.points;
  if (points === null) return draft;
  return {
    ...draft,
    points: Object.fromEntries(
      Object.entries(draft.points).map(([key, value]) => [
        key,
        isScoreOnScale(value, points.scale) ? value : points.default,
      ]),
    ),
  };
}

/** A host's ballot settings screen for one event. */
export function ballotSettingsOf(
  view: EventBallotView,
  event: EventSwitch,
  slug: string,
): BallotSettings {
  const { definition, pin, usedIn } = view;
  const source: ResolvedSetting['source'] =
    pin.kind === 'template'
      ? { scope: 'organization', name: pin.organizationName }
      : { scope: 'event', name: event.current };
  const used =
    usedIn === null ? '' : `, used in rounds ${usedIn.first} to ${usedIn.last}`;
  return {
    event,
    setup: linkTo('Setup', hostRoutes.setup(slug)),
    lede: `Version ${definition.revision}${used} · ${
      pin.kind === 'template'
        ? `pinned by ${pin.organizationName}'s template`
        : 'set for this event'
    }`,
    saveLabel: 'Save screening',
    sections: [
      ...pinnedBallotParts(definition, source).map((section) => ({
        ...section,
        options: [],
      })),
      {
        heading: 'Screening',
        locked: [],
        options: [
          {
            id: 'screening',
            label: 'Written text',
            detail:
              "Phone numbers, links and flagged language. The judge's original is kept.",
            options: [
              { value: 'hold', label: 'Hold for your review' },
              { value: 'release', label: 'Release unscreened' },
            ],
            value: view.screening === 'hold' ? 'hold' : 'release',
          },
        ],
      },
    ],
    definition,
    preview: sampleBallotPreview,
  };
}

const numberWords = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
] as const;

function reasonReaders(view: JudgeBallotView): string {
  const coaches = view.reasonAudiences.includes('responsible_adults');
  switch (view.subjectKind) {
    case 'debater':
      return `Both debaters${coaches ? ' and their coaches' : ''} read this.`;
    case 'speaker':
      return coaches
        ? 'Each speaker and their coach read this.'
        : 'Each speaker reads this.';
    case 'team':
      return `All ${numberWords[view.subjects.length] ?? view.subjects.length} teams${coaches ? ' and their coaches' : ''} read this.`;
  }
}

/** A judge's own ballot for one fixture. */
export function judgeBallotOf(view: JudgeBallotView): JudgeBallot {
  const { panel } = view;
  const seat =
    panel.size === 1
      ? 'the only judge'
      : panel.chair
        ? `you chair ${panel.size} judges`
        : `${panel.position} of ${panel.size} judges`;
  return {
    context: [
      view.tournamentName,
      ...(view.eventName === null ? [] : [view.eventName]),
      view.tabRoundName,
      view.placeName,
      seat,
    ].join(' · '),
    resolution:
      view.resolution.kind === 'released' ? view.resolution.text : null,
    definition: view.definition,
    subjects: view.subjects.map((subject) => ({
      id: subject.key,
      name: subject.name,
      role: subject.role,
    })),
    draft: view.draft,
    reasonReaders: reasonReaders(view),
  };
}
