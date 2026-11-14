import type {
  DrawFindingSeverity,
  DrawView,
  DrawViewFixture,
} from '@daisy/protocol/lobby/draw-read';
import { choice, sampleAction, type Choice, type TabAction } from './action';
import { sampleDrawView } from './sample/draw';
import type { SampleScene } from './sample/scene';
import type { EventSwitch } from './setup';

/** What the engine reports about a fixture; a broken rule is never relaxed. */
export type FixtureFlag = {
  readonly severity: DrawFindingSeverity;
  readonly text: string;
};

export type DraftFixture = {
  readonly id: string;
  readonly title: string;
  readonly judges: string;
  readonly flags: readonly FixtureFlag[];
  readonly href: string;
  readonly selected: boolean;
};

/** The entries on the same record in this tab round's pairing. */
export type RecordGroup = {
  readonly record: string;
  readonly fixtures: readonly DraftFixture[];
};

/** What a different pairing of this fixture would cost. */
export type FixtureAlternative = {
  readonly heading: string;
  readonly cost: string;
  /** A rule the alternative breaks, which publishing must name and override. */
  readonly breaksRule: string | null;
  readonly show: TabAction;
};

export type FixtureDetail = {
  readonly title: string;
  readonly why: readonly string[];
  readonly seats: readonly Choice[];
  readonly alternative: FixtureAlternative | null;
};

/** A draft version of the plan for one tab round. */
export type DrawBoard = {
  readonly event: EventSwitch;
  readonly title: string;
  readonly version: number;
  readonly basis: string;
  readonly rulesBroken: number;
  readonly preferencesBent: number;
  readonly again: TabAction;
  readonly publish: TabAction;
  readonly groups: readonly RecordGroup[];
  readonly rest: string | null;
  readonly back: TabAction | null;
  readonly selected: FixtureDetail | null;
};

/** What the board needs beside the read: the event picker and its addresses. */
export type DrawBoardContext = {
  readonly event: EventSwitch;
  readonly selectedFixtureId: string | null;
  readonly fixtureAddress: (fixtureId: string) => string;
};

/** The record groups at the top of the draw are listed; the rest are summed up. */
const listedGroups = 2;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;
const recordOf = (wins: number) => plural(wins, 'win', 'wins');
const capitalized = (word: string) =>
  `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
const options = (first: string, rest: readonly string[]) =>
  [first, ...rest.filter((option) => option !== first)] as const;

const titleOf = (fixture: DrawViewFixture) =>
  fixture.entries.map((entry) => entry.name).join(' v ');

const judgesOf = (fixture: DrawViewFixture) =>
  fixture.judges.length === 0
    ? ''
    : `${fixture.judges.length === 1 ? 'Judge' : 'Judges'} ${fixture.judges
        .map((judge) => judge.name)
        .join(' and ')}`;

/** Each side's seat, its entry first; then the judge's, its judge first. */
const seatsOf = (read: DrawView, fixture: DrawViewFixture): Choice[] => {
  const names = fixture.entries.map((entry) => entry.name);
  const spare = read.spareJudges.map((judge) => judge.name);
  const sides = read.sides.flatMap((side) => {
    const seated = fixture.entries.find((entry) => entry.side === side);
    return seated === undefined
      ? []
      : [choice(capitalized(side), options(seated.name, names))];
  });
  const [judge] = fixture.judges;
  return judge === undefined
    ? sides
    : [
        ...sides,
        choice(
          'Judge',
          options(judge.name, [
            ...fixture.judges.map((seated) => seated.name),
            ...spare,
          ]),
        ),
      ];
};

const detailOf = (read: DrawView, fixture: DrawViewFixture): FixtureDetail => ({
  title: titleOf(fixture),
  why: fixture.reasons,
  seats: seatsOf(read, fixture),
  alternative:
    fixture.alternative === null
      ? null
      : {
          heading: fixture.alternative.change,
          cost: fixture.alternative.cost,
          breaksRule: fixture.alternative.breaksRule,
          show: sampleAction('Show that draw'),
        },
});

/** The groups past the listed ones, as one line: how many fixtures, and who has the bye. */
const restOf = (groups: DrawView['recordGroups']): string | null => {
  if (groups.length === 0) return null;
  const fixtures = groups.flatMap((group) => group.fixtures);
  const byes = fixtures.filter((fixture) => fixture.kind === 'bye');
  const others = fixtures.length - byes.length;
  return [
    groups.map((group) => recordOf(group.wins)).join(', '),
    ...(others === 0 ? [] : [plural(others, 'more fixture', 'more fixtures')]),
    ...(byes.length === 0
      ? []
      : [
          `${byes.map(titleOf).join(' and ')} ${byes.length === 1 ? 'has the bye' : 'have byes'}`,
        ]),
  ].join(' · ');
};

/** The draft draw board: a projection of the host's `DrawView`. */
export const drawBoardOf = (
  read: DrawView,
  context: DrawBoardContext,
): DrawBoard => {
  const fixtures = read.recordGroups.flatMap((group) => group.fixtures);
  const findings = fixtures.flatMap((fixture) => fixture.findings);
  const counted = (severity: DrawFindingSeverity) =>
    findings.filter((finding) => finding.severity === severity).length;
  const chosen =
    fixtures.find(
      (fixture) => fixture.fixtureId === context.selectedFixtureId,
    ) ?? null;
  const round = read.tabRound.number;
  return {
    event: context.event,
    title: `Round ${round} draw`,
    version: read.draw.version,
    basis:
      read.resultsThroughRound === null
        ? 'from the seeding'
        : `from results through round ${read.resultsThroughRound}`,
    rulesBroken: counted('rule_broken'),
    preferencesBent: counted('preference_bent'),
    again: sampleAction('Draw again'),
    publish: sampleAction(`Publish round ${round}`, read.capabilities.publish),
    groups: read.recordGroups.slice(0, listedGroups).map((group) => ({
      record: recordOf(group.wins),
      fixtures: group.fixtures.map((fixture) => ({
        id: fixture.fixtureId,
        title: titleOf(fixture),
        judges: judgesOf(fixture),
        flags: fixture.findings,
        href: context.fixtureAddress(fixture.fixtureId),
        selected: fixture.fixtureId === chosen?.fixtureId,
      })),
    })),
    rest: restOf(read.recordGroups.slice(listedGroups)),
    back:
      read.capabilities.edit && read.draw.basedOn !== null
        ? sampleAction(`Go back to draft ${read.draw.basedOn.version}`)
        : null,
    selected: chosen === null ? null : detailOf(read, chosen),
  };
};

export const readDrawBoard = (
  slug: string,
  event: string,
  round: string,
  fixture: string | null,
  scene: SampleScene,
): DrawBoard | null => {
  const sample = sampleDrawView(slug, event, round, scene);
  return sample === null
    ? null
    : drawBoardOf(sample.read, {
        ...sample.context,
        selectedFixtureId: sample.fixtureIdOf(fixture),
      });
};
