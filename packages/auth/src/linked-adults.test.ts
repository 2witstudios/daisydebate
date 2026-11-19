import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { linkedAdultsOfRound } from './linked-adults';
import {
  linkedAdultExpectationOf,
  linkedAdultFactsOf,
  linkedAdultFixtures,
  type LinkedAdultFixture,
} from './linked-adults.test-support';

setupRitewayBun();

/** Readable ids: each name is its own user id, and its actor's is prefixed. */
const idsOf = (fixture: LinkedAdultFixture) => ({
  people: Object.fromEntries(
    Object.keys(fixture.people).map((name) => [
      name,
      { userId: `user-${name}`, actorId: `actor-${name}` },
    ]),
  ),
  organizations: Object.fromEntries(
    (fixture.organizations ?? []).map((o) => [o.name, `org-${o.name}`]),
  ),
});

describe('linkedAdultsOfRound()', () => {
  for (const fixture of linkedAdultFixtures)
    test(fixture.given, () => {
      const { people, organizations } = idsOf(fixture);
      assert({
        given: fixture.given,
        should: fixture.should,
        actual: linkedAdultsOfRound(
          linkedAdultFactsOf(fixture, people, organizations),
        ),
        expected: linkedAdultExpectationOf(fixture, people),
      });
    });

  test('a Round seating nobody with a person behind them', () => {
    const fixture = linkedAdultFixtures[0]!;
    const { people, organizations } = idsOf(fixture);
    const facts = linkedAdultFactsOf(fixture, people, organizations);
    assert({
      given: 'a Youth Round whose debating seats name actors with no person',
      should: 'have no youth debaters',
      actual: linkedAdultsOfRound({
        ...facts,
        actors: facts.actors.map((actor) => ({ ...actor, userId: null })),
      }),
      expected: { debaters: [] },
    });
  });

  test('a judge seat its slot no longer names', () => {
    const fixture = linkedAdultFixtures[0]!;
    const { people, organizations } = idsOf(fixture);
    const facts = linkedAdultFactsOf(fixture, people, organizations);
    assert({
      given: 'a Youth Round whose debating seats are no longer current',
      should: 'have no youth debaters',
      actual: linkedAdultsOfRound({
        ...facts,
        seats: facts.seats.map((seat) => ({ ...seat, current: false })),
      }),
      expected: { debaters: [] },
    });
  });
});
