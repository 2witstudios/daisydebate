import type { FixtureChange } from '@daisy/protocol/lobby/command';

/** A fixture of a published version, with the people seated in it. */
export type SeatedFixture = {
  readonly fixtureId: string;
  /** Entry members and judges seated in it, as accounts. */
  readonly people: readonly string[];
};

/** One published version of a tab round's set of fixtures. */
export type PublishedVersion = {
  readonly tabRoundId: string;
  readonly drawVersion: number;
  readonly fixtures: readonly SeatedFixture[];
};

const peopleOf = (fixture: SeatedFixture): string[] =>
  [...new Set(fixture.people)].sort();

/**
 * Exactly the fixtures a published version added and withdrew since the
 * published version before it (TAB-5.22): added ones with the people seated
 * after, withdrawn ones with the people seated before. A first version
 * (`before` null) adds every fixture. A fixture in both is unchanged and is
 * not a change, whatever happened to its panel: officiating answers its
 * own change.
 */
export const fixtureChangesOf = (
  published: PublishedVersion,
  before: PublishedVersion | null,
): FixtureChange[] => {
  const earlier = new Set(before?.fixtures.map((f) => f.fixtureId) ?? []);
  const now = new Set(published.fixtures.map((f) => f.fixtureId));
  const change =
    (kind: 'added' | 'withdrawn') =>
    (fixture: SeatedFixture): FixtureChange => ({
      kind,
      fixtureId: fixture.fixtureId,
      tabRoundId: published.tabRoundId,
      drawVersion: published.drawVersion,
      people: peopleOf(fixture),
    });
  return [
    ...published.fixtures
      .filter((fixture) => !earlier.has(fixture.fixtureId))
      .map(change('added')),
    ...(before?.fixtures ?? [])
      .filter((fixture) => !now.has(fixture.fixtureId))
      .map(change('withdrawn')),
  ];
};
