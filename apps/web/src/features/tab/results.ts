import type {
  AudienceOpenings,
  BallotPart,
  EventResultsView,
  ResultsCorrection,
} from '@daisy/protocol/lobby/results-read';
import type { BracketView } from '@daisy/protocol/lobby/standings-read';
import type { Audience } from '@daisy/protocol/lobby';
import { sampleAction, type TabAction } from './action';
import { sampleBracketView, sampleEventResultsView } from './sample/results';
import type { SampleScene } from './sample/scene';
import { countWord, type WallClock } from './tab-round';

export type BracketSide = {
  readonly seed: number;
  readonly name: string;
};

type BracketTie = {
  readonly top: BracketSide;
  readonly bottom: BracketSide;
  /** Ballots each side won, once the fixture has a result. The panel is odd,
   * so the side with more ballots won. */
  readonly result: { readonly top: number; readonly bottom: number } | null;
  readonly room: string | null;
  readonly watch: TabAction | null;
};

export type BracketStage = {
  readonly name: string;
  readonly state: 'done' | 'live' | 'upcoming';
  readonly time: string | null;
  readonly ties: readonly BracketTie[];
  /** What an empty stage waits on. */
  readonly note: string | null;
};

/** The elimination tree only. */
export type Bracket = { readonly stages: readonly BracketStage[] };

/** One audience of a ballot part, and whether it has opened. */
type AudienceOpening = {
  readonly audience: string;
  readonly detail: string;
  /** Null once a release records the opening. */
  readonly open: TabAction | null;
};

type CertifyCheck = {
  readonly kind: 'held_ballots' | 'correction' | 'sanction';
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction | null;
};

/** Where certifying the event stands for this host. */
export type Certification =
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'ready'; readonly certify: TabAction }
  | { readonly kind: 'certified'; readonly at: string };

export type EventResults = {
  readonly lede: string;
  readonly certification: Certification;
  readonly bracket: Bracket;
  readonly audiencesHeading: string;
  readonly audiences: readonly AudienceOpening[];
  readonly checks: readonly CertifyCheck[];
};

const capitalized = (word: string) =>
  `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
const listed = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;

const stageStates = {
  complete: 'done',
  running: 'live',
  scheduled: 'upcoming',
} as const;

/** The elimination tree: a projection of `BracketView`. */
export const bracketOf = (
  read: BracketView,
  wallClock: WallClock,
): Bracket => ({
  stages: read.tabRounds.map((tabRound) => {
    const feeder = read.tabRounds.find(
      (candidate) => candidate.name === tabRound.waitsOn?.feederTabRoundName,
    );
    const { waitsOn } = tabRound;
    const feeders = feeder?.ties.length ?? 0;
    return {
      name: tabRound.name,
      state: stageStates[tabRound.status],
      time:
        tabRound.status === 'scheduled' && tabRound.startsAt !== null
          ? wallClock(tabRound.startsAt)
          : null,
      ties: tabRound.ties.map((tie): BracketTie => {
        const top = { seed: tie.top.seed, name: tie.top.name };
        const bottom = { seed: tie.bottom.seed, name: tie.bottom.name };
        const { state } = tie;
        switch (state.kind) {
          case 'decided':
            return {
              top,
              bottom,
              result: { top: state.topBallots, bottom: state.bottomBallots },
              room: null,
              watch: null,
            };
          case 'live':
            return {
              top,
              bottom,
              result: null,
              room: state.room.name,
              watch: state.watchable ? sampleAction('Watch') : null,
            };
          case 'scheduled':
          case 'withheld':
            return { top, bottom, result: null, room: null, watch: null };
        }
      }),
      note:
        waitsOn === null
          ? null
          : `Created when ${feeders === 2 ? 'both' : 'all'} ${waitsOn.feederTabRoundName.toLowerCase()} have ${countWord(waitsOn.ballotsNeeded)} ballots in. ${capitalized(countWord(waitsOn.panelSize))} judges.`,
    };
  }),
});

const audienceLabels: Readonly<Record<Audience, string>> = {
  responsible_adults: 'Coaches and parents',
  competitors: 'Competitors',
  participants: 'Participants',
  link: 'Anyone with the link',
  public: 'Public',
};

const partNames: Readonly<Record<BallotPart, string>> = {
  decision: 'win or loss',
  scores: 'scores',
  reason: 'reasons',
  feedback: 'feedback',
};

const openedWhen = {
  at_once: 'at once',
  round_close: 'as each round closed',
  prelims_end: 'when prelims were certified',
  break: 'when the break was announced',
  certified: 'when the event was certified',
  manual: 'by hand',
} as const;

const partsOf = (parts: readonly BallotPart[]) =>
  capitalized(listed(parts.map((part) => partNames[part])));

const fullBallotsOf = (audience: Audience) => {
  switch (audience) {
    case 'responsible_adults':
      return "Their own entries' full ballots";
    case 'competitors':
      return 'Their own full ballots';
    case 'participants':
    case 'link':
    case 'public':
      return 'Full ballots';
  }
};

/** What an audience can see of a preliminary ballot, and whether it may be opened to it now. */
const openingOf = (
  read: EventResultsView,
  row: AudienceOpenings,
): AudienceOpening => {
  const open = row.openings.flatMap((opening) =>
    opening.state.kind === 'open'
      ? [{ part: opening.part, ...opening.state }]
      : [],
  );
  const openable = row.openings
    .filter((opening) => opening.state.kind === 'openable')
    .map((opening) => opening.part);
  const causes = new Set(open.map((opening) => opening.cause));
  const [first] = open;
  const held =
    read.ballotAccess === 'unreleased' && read.screeningHolds.count > 0
      ? [
          `${read.screeningHolds.count} ${read.screeningHolds.count === 1 ? 'ballot is' : 'ballots are'} held for review.`,
        ]
      : [];
  const latest = [...open].sort((a, b) =>
    b.openedAt.localeCompare(a.openedAt),
  )[0];
  const detail =
    openable.length > 0
      ? [
          ...(open.length === 0
            ? []
            : [
                `${partsOf(open.map((opening) => opening.part))} ${open.length === 1 ? 'is' : 'are'} open.`,
              ]),
          `${partsOf(openable)} ${
            read.prelimsCertifiedAt === null
              ? 'can be opened now.'
              : 'open now that prelims are certified.'
          }`,
          ...held,
        ].join(' ')
      : first !== undefined && open.length === 4 && causes.size === 1
        ? `${fullBallotsOf(row.audience)} · opened ${openedWhen[first.cause]}`
        : first !== undefined && open.length === 1 && first.part === 'decision'
          ? `Results only · opened ${openedWhen[first.cause]}`
          : latest === undefined
            ? 'Nothing is open yet'
            : `${partsOf(
                open
                  .filter((opening) => opening.cause === latest.cause)
                  .map((opening) => opening.part),
              )} opened ${openedWhen[latest.cause]}.`;
  const label = audienceLabels[row.audience];
  return {
    audience: label,
    detail,
    open:
      openable.length > 0 && read.capabilities.release
        ? sampleAction(`Open to ${label.toLowerCase()}`, true)
        : null,
  };
};

const correctionLine = (correction: ResultsCorrection): string => {
  const fixture = correction.fixture.entries
    .map((entry) => entry.name)
    .join(' v ');
  const confirmed =
    correction.confirmedBy === null
      ? ''
      : `, confirmed by ${correction.confirmedBy.viewer ? 'you' : correction.confirmedBy.name}`;
  const draws = correction.usedByPublishedDraws.map((draw) =>
    String(draw.tabRoundNumber),
  );
  return [
    `Round ${correction.tabRoundNumber}, ${fixture}: ${correction.changed} corrected by ${correction.recordedBy.name}${confirmed}.`,
    ...(draws.length === 0
      ? []
      : [
          draws.length === 1
            ? `Round ${draws[0] ?? ''}'s draw used the old result and stands as published.`
            : `Rounds ${listed(draws)}' draws used the old result and stand as published.`,
        ]),
    'Standings changed from that point.',
  ].join(' ');
};

const certificationOf = (
  read: EventResultsView,
  wallClock: WallClock,
): Certification => {
  const { certification } = read;
  switch (certification.kind) {
    case 'certified':
      return { kind: 'certified', at: wallClock(certification.certifiedAt) };
    case 'blocked':
      return {
        kind: 'blocked',
        reason: `${capitalized(
          listed(
            certification.running.map(
              (round) => `the ${round.name.toLowerCase()}`,
            ),
          ),
        )} still ${certification.running.length === 1 ? 'runs' : 'run'}.`,
      };
    case 'ready':
      return read.capabilities.certify
        ? { kind: 'ready', certify: sampleAction('Certify the event', true) }
        : {
            kind: 'blocked',
            reason:
              'Every result is in; a host who may release results certifies.',
          };
  }
};

/** An event's results for its host: a projection of `EventResultsView`. */
const eventResultsOf = (
  read: EventResultsView,
  context: { readonly bracket: Bracket; readonly wallClock: WallClock },
): EventResults => {
  const { sanction, corrections, wallClock } = { ...read, ...context };
  const certified = read.certification.kind === 'certified';
  const holds = read.ballotAccess === 'unreleased' ? read.screeningHolds : null;
  return {
    lede:
      certified && sanction !== null && sanction.sentAt !== null
        ? `${sanction.organizationName} has the results.`
        : certified
          ? 'The event is certified.'
          : read.prelimsCertifiedAt === null
            ? 'Prelims are still running.'
            : `Prelims certified at ${wallClock(read.prelimsCertifiedAt)}. Elimination rounds are still running.`,
    certification: certificationOf(read, wallClock),
    bracket: context.bracket,
    audiencesHeading: 'Who can see prelim ballots',
    audiences: [
      {
        audience: 'Tab staff',
        detail: 'Everything, as ballots arrive',
        open: null,
      },
      ...read.audiences.map((row) => openingOf(read, row)),
    ],
    checks: [
      ...(holds === null || holds.count === 0
        ? []
        : [
            {
              kind: 'held_ballots' as const,
              title: `${holds.count} ${holds.count === 1 ? 'ballot' : 'ballots'} held by screening`,
              detail: holds.summary ?? '',
              action: sampleAction('Review held ballots'),
            },
          ]),
      ...(corrections.length === 0
        ? []
        : [
            {
              kind: 'correction' as const,
              title: `${corrections.length} ${corrections.length === 1 ? 'correction' : 'corrections'} since certifying prelims`,
              detail: corrections.map(correctionLine).join(' '),
              action: null,
            },
          ]),
      ...(sanction === null
        ? []
        : [
            {
              kind: 'sanction' as const,
              title: `${sanction.organizationName} receives results`,
              detail:
                sanction.sentAt === null
                  ? 'Sent when you certify the event.'
                  : 'Sent when you certified the event.',
              action: null,
            },
          ]),
    ],
  };
};

export const readEventResults = (
  slug: string,
  scene: SampleScene,
): EventResults | null => {
  const sample = sampleEventResultsView(slug, scene);
  return sample === null
    ? null
    : eventResultsOf(sample.read, {
        bracket: bracketOf(sample.bracket, sample.wallClock),
        wallClock: sample.wallClock,
      });
};

export const readBracket = (
  slug: string,
  event: string | null,
  scene: SampleScene,
): Bracket | null => {
  const sample = sampleBracketView(slug, event, scene);
  return sample === null ? null : bracketOf(sample.read, sample.wallClock);
};
