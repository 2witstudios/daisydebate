import type { CompletionContext } from './completion-form';
import type {
  AudienceOpenings,
  BallotPart,
  EventResultsView,
  HostResultsView,
  ResultsCorrection,
} from '@daisy/protocol/lobby/results-read';
import type { BracketView } from '@daisy/protocol/lobby/standings-read';
import type { Audience } from '@daisy/protocol/lobby';
import type { HostNavigationView } from '@daisy/protocol/lobby/host-navigation-read';
import {
  commandAction,
  linkTo,
  unavailableAction,
  type TabAction,
} from './action';
import { hostRoutes, tabRoutes } from './routes';
import { hostNavigationRail } from './host-navigation';
import type { TimelineRail } from './tournament';
import type { EventSwitch } from './setup';
import { countWord, type WallClock } from './tab-round';
import { shownName } from './shown-entrant';

export type BracketSide = {
  readonly entryId: string;
  readonly seed: number | null;
  readonly name: string;
  readonly outcome: {
    readonly won: boolean | null;
    readonly rank: number | null;
    readonly ballotsWon: number | null;
  } | null;
};
type BracketFixture = {
  readonly fixtureId: string;
  readonly entries: readonly BracketSide[];
  readonly room: string | null;
  readonly watch: TabAction | null;
};

export type BracketStage = {
  readonly id: string;
  readonly name: string;
  readonly state: 'done' | 'live' | 'upcoming';
  readonly time: string | null;
  readonly fixtures: readonly BracketFixture[];
  /** What an empty stage waits on. */
  readonly note: string | null;
};

/** The elimination tree only. */
export type Bracket = { readonly stages: readonly BracketStage[] };

/** One audience of a ballot part, and whether it has opened. */
type AudienceOpening = {
  readonly id: string;
  readonly status: 'open' | 'openable' | 'closed';
  readonly audience: string;
  readonly detail: string;
  /** Null once a release records the opening. */
  readonly open: TabAction | null;
  readonly release?: readonly TabAction<CompletionContext>[];
};

type CertifyCheck = {
  readonly id: string;
  readonly kind: 'held_ballots' | 'correction' | 'sanction';
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction | null;
};

/** Where certifying the event stands for this host. */
export type Certification =
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'ready'; readonly certify: TabAction<CompletionContext> }
  | { readonly kind: 'certified'; readonly at: string };

export type EventResults = {
  readonly lede: string;
  readonly certification: Certification;
  readonly bracket: Bracket;
  readonly audiencesHeading: string;
  readonly postingOpenings?: readonly {
    readonly id: string;
    readonly label: string;
    readonly release: TabAction<CompletionContext>;
  }[];
  readonly audiences: readonly AudienceOpening[];
  readonly checks: readonly CertifyCheck[];
};

export type ResultsScreen = {
  readonly rail: TimelineRail;
  readonly event: EventSwitch;
  readonly results: EventResults;
};

export function hostResultsScreenOf(
  navigation: HostNavigationView & { readonly billing?: boolean },
  read: HostResultsView,
  nextId: () => string,
): ResultsScreen | null {
  const index = navigation.events.findIndex(
    (event) => event.eventId === read.results.eventId,
  );
  const selected = navigation.events[index];
  if (!selected || read.results.lobbyId !== navigation.id) return null;
  const address = hostRoutes.results(navigation.handle);
  const wallClock = (at: string) =>
    new Intl.DateTimeFormat('en', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(at)) + ' UTC';
  return {
    rail: hostNavigationRail(navigation),
    event: {
      current: selected.name,
      position: `${index + 1} of ${navigation.events.length}`,
      others: navigation.events
        .filter((event) => event.eventId !== selected.eventId)
        .map((event) =>
          linkTo(event.name, `${address}?event=${event.eventId}`),
        ),
    },
    results: eventResultsOf(read.results, {
      wallClock,
      bracket: {
        stages: read.stages.flatMap(
          (stage) => bracketOf(stage, wallClock).stages,
        ),
      },
      bind: (label, target) =>
        commandAction(
          label,
          {
            lobbyId: navigation.id,
            eventId: selected.eventId,
            handle: navigation.handle,
            commandId: nextId(),
            target,
          },
          target.type === 'certify-event',
        ),
    }),
  };
}

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
    const feeders = feeder?.fixtures.length ?? 0;
    return {
      id: tabRound.tabRoundId,
      name: tabRound.name,
      state: stageStates[tabRound.status],
      time:
        tabRound.status === 'scheduled' && tabRound.startsAt !== null
          ? wallClock(tabRound.startsAt)
          : null,
      fixtures: tabRound.fixtures.map((fixture): BracketFixture => ({
        fixtureId: fixture.fixtureId,
        entries: fixture.entries.map((entry) => ({
          entryId: entry.entryId,
          seed: entry.seed,
          name: shownName(entry.shown),
          outcome:
            fixture.state.kind === 'decided'
              ? (fixture.state.outcomes.find(
                  (one) => one.entryId === entry.entryId,
                ) ?? null)
              : null,
        })),
        room: fixture.state.kind === 'live' ? fixture.state.room.name : null,
        watch:
          fixture.state.kind === 'live' && fixture.state.watchable
            ? linkTo('Watch', tabRoutes.liveRoom(fixture.state.room.roomId))
            : null,
      })),
      note:
        waitsOn === null
          ? null
          : `Created when ${feeders === 2 ? 'both' : 'all'} ${waitsOn.feederTabRoundName.toLowerCase()} have ${countWord(waitsOn.ballotsNeeded)} ballots in. ${capitalized(countWord(waitsOn.panelSize))} judges.`,
    };
  }),
});

export const audienceLabels: Readonly<Record<Audience, string>> = {
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

type BindCompletion = (
  label: string,
  target: CompletionContext['target'],
) => TabAction<CompletionContext>;

/** What an audience can see of a preliminary ballot, and whether it may be opened to it now. */
const openingOf = (
  read: EventResultsView,
  row: AudienceOpenings,
  bind?: BindCompletion,
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
    id: `${row.tabRoundId}:${row.audience}`,
    status: openable.length > 0 ? 'openable' : open.length ? 'open' : 'closed',
    audience: `${row.tabRoundName} · ${label}`,
    detail,
    ...(bind && read.capabilities.release
      ? {
          release: openable.map((part) =>
            bind(`Open ${part}`, {
              type: 'open-audience',
              tabRoundId: row.tabRoundId,
              thing: part,
              audience: row.audience,
            }),
          ),
        }
      : {}),
    open:
      !bind && openable.length > 0 && read.capabilities.release
        ? unavailableAction(`Open to ${label.toLowerCase()}`, true)
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
  bind?: BindCompletion,
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
    case 'waiting':
      return {
        kind: 'blocked',
        reason:
          certification.reason === 'screening-pending'
            ? 'Written feedback is still being screened or held. Review the ballots before certifying.'
            : 'Every published fixture needs a result first.',
      };
    case 'ready':
      return read.capabilities.certify
        ? {
            kind: 'ready',
            certify:
              bind?.('Certify current results', {
                type: 'certify-event',
                resultsVersion: read.resultsVersion,
              }) ?? unavailableAction('Certify the event', true),
          }
        : {
            kind: 'blocked',
            reason:
              'Every result is in; a host who may release results certifies.',
          };
  }
};

/** An event's results for its host: a projection of `EventResultsView`. */
export const eventResultsOf = (
  read: EventResultsView,
  context: {
    readonly bracket: Bracket;
    readonly wallClock: WallClock;
    readonly bind?: BindCompletion;
  },
): EventResults => {
  const { sanctions, corrections, wallClock } = { ...read, ...context };
  const { bind } = context;
  const certified = read.certification.kind === 'certified';
  const holds = read.ballotAccess === 'unreleased' ? read.screeningHolds : null;
  return {
    lede:
      certified &&
      sanctions.length > 0 &&
      sanctions.every((sanction) => sanction.sentAt !== null)
        ? `${listed(sanctions.map((sanction) => sanction.organizationName))} have the results.`
        : certified
          ? 'The event is certified.'
          : read.prelimsCertifiedAt === null
            ? read.certification.kind === 'ready'
              ? 'Current published results are ready to certify.'
              : read.certification.kind === 'waiting' &&
                  read.certification.reason === 'screening-pending'
                ? 'Written feedback needs review before certification.'
                : 'Results are still being recorded.'
            : `Prelims certified at ${wallClock(read.prelimsCertifiedAt)}. Elimination rounds are still running.`,
    certification: certificationOf(read, wallClock, context.bind),
    bracket: context.bracket,
    audiencesHeading: 'Who can see ballots',
    ...(bind && read.capabilities.release && read.postingOpenings?.length
      ? {
          postingOpenings: read.postingOpenings.map((opening) => ({
            id: `${opening.tabRoundId}:${opening.audience}`,
            label: `${opening.tabRoundName} · ${audienceLabels[opening.audience]}`,
            release: bind('Open posting', {
              type: 'open-audience',
              tabRoundId: opening.tabRoundId,
              thing: 'posting',
              audience: opening.audience,
            }),
          })),
        }
      : {}),
    audiences: [
      ...(read.ballotAccess === 'unreleased'
        ? [
            {
              id: 'tab-staff',
              status: 'open' as const,
              audience: 'Tab staff',
              detail: 'Everything, as ballots arrive',
              open: null,
            },
          ]
        : []),
      ...read.audiences.map((row) => openingOf(read, row, context.bind)),
    ],
    checks: [
      ...(holds === null || holds.count === 0
        ? []
        : [
            {
              id: 'held-ballots',
              kind: 'held_ballots' as const,
              title: `${holds.count} ${holds.count === 1 ? 'ballot' : 'ballots'} held by screening`,
              detail: holds.summary ?? '',
              action: unavailableAction('Review held ballots'),
            },
          ]),
      ...(corrections.length === 0
        ? []
        : [
            {
              id: 'corrections',
              kind: 'correction' as const,
              title: `${corrections.length} ${corrections.length === 1 ? 'correction' : 'corrections'} since certifying prelims`,
              detail: corrections.map(correctionLine).join(' '),
              action: null,
            },
          ]),
      ...sanctions.map((sanction, index) => ({
        id: `sanction-${index}`,
        kind: 'sanction' as const,
        title: `${sanction.organizationName} receives results`,
        detail:
          sanction.sentAt === null
            ? 'Receives certified results when you certify the event.'
            : 'Receives these certified results.',
        action: null,
      })),
    ],
  };
};
