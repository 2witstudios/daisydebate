import type { Fixture, Id } from '../shapes/competition';
import type { EventRequest, ExistingFixture, Plan } from '../shapes/draw';
import { effectiveCutoff, placedOf, sidesOf } from './context';
import {
  countedResults,
  entriesIn,
  oneReading,
  pastFixtures,
  pastOf,
  pastResults,
  recordsBefore,
} from './past';
import type { Violation } from './verdict';

/** The active entries a preliminary round places outside its fixed fixtures. */
export const entriesToPlace = (request: EventRequest): ReadonlySet<Id> => {
  const fixed = new Set(
    (request.existing as readonly ExistingFixture<never>[])
      .filter((e) => e.hold === 'fixed')
      .flatMap((e) => entriesIn(e.fixture as Fixture)),
  );
  return new Set(
    request.entries
      .filter((e) => e.status === 'active' && !fixed.has(e.id))
      .map((e) => e.id),
  );
};

/**
 * How many byes the added fixtures of a preliminary round give: the remainder
 * of the entries they place over the fixture size. A kept fixture, fixed or
 * movable, is given (keeping a movable one outranks every setting), so its
 * own bye is too; with nothing kept this is the remainder of every entry to
 * place. Speech sections take everyone, so no bye.
 */
const byesExpected = (request: EventRequest, added: readonly Id[]) => {
  const sides = sidesOf(request);
  const placeable = entriesToPlace(request);
  return sides === null
    ? 0
    : added.filter((e) => placeable.has(e)).length % sides;
};

/** Whether `bye.recipient` decides who takes the bye: a two-sided preliminary round that is powered, or the first. */
const recipientApplies = (request: EventRequest) =>
  request.stage.kind === 'preliminary' &&
  sidesOf(request) === 2 &&
  (request.settings['pairing.method'].preliminary.structure === 'powered' ||
    request.tabRound === 1);

/**
 * Facts 2c and 2d: the number of byes a preliminary round gives, and who
 * takes a new one. It goes to an entry of the added fixtures with the fewest wins at the
 * effective cutoff (a bye a win only under `bye.result: win`); when
 * `bye.repeat` is weighed, to one with no earlier bye if any remain. Under
 * `bye.recipient: random` only who may take it is checked.
 */
export const byeViolations = (
  request: EventRequest,
  plan: Plan,
): Violation[] => {
  if (request.stage.kind !== 'preliminary') return [];
  const event = request.event;
  const fresh = placedOf(plan).filter((p) => p.added);
  const added = fresh.filter((p) => p.fixture.kind === 'bye');
  const violations: Violation[] = [];
  const expected = byesExpected(
    request,
    fresh.flatMap((p) => entriesIn(p.fixture)),
  );
  /**
   * A round robin's circle runs over the whole field, withdrawn entries
   * included, so a drop gives its scheduled opponent a bye: the schedule,
   * not the count, says who sits out.
   */
  const roundRobin =
    request.format.outcome === 'winner' &&
    request.settings['pairing.method'].preliminary.structure === 'round_robin';
  if (!roundRobin && added.length !== expected)
    violations.push({
      kind: 'bye_count',
      event,
      expected,
      actual: added.length,
    });
  /**
   * Keeping a movable fixture outranks every setting, so a kept bye is never
   * questioned, and a new bye is weighed only against the entries the plan
   * places afresh: those in added fixtures.
   */
  if (!recipientApplies(request) || added.length === 0) return violations;
  const placeable = entriesToPlace(request);
  const toPlace = fresh
    .flatMap((p) => entriesIn(p.fixture))
    .filter((e) => placeable.has(e));
  const fixtures = pastFixtures(request.history);
  const past = pastOf(fixtures, request.tabRound);
  const repeat = request.settings['bye.repeat'].force;
  const unbyed = toPlace.filter((e) => past.byes(e) === 0);
  const eligible =
    (repeat === 'rule' || repeat === 'preference') && unbyed.length > 0
      ? unbyed
      : toPlace;
  const cutoff = effectiveCutoff(request);
  const wins = recordsBefore(
    2,
    fixtures,
    oneReading(countedResults(fixtures, pastResults(request.history), cutoff)),
    request.settings,
    cutoff,
    request.tabRound,
  ).of;
  const fewest = Math.min(...eligible.map(wins));
  const lowest = request.settings['bye.recipient'].value === 'lowest';
  for (const { ref, fixture } of added) {
    const entry = entriesIn(fixture)[0]!;
    const reason = !toPlace.includes(entry)
      ? 'not_to_place'
      : !eligible.includes(entry)
        ? 'repeat_bye'
        : lowest && wins(entry) > fewest
          ? 'not_fewest_wins'
          : null;
    if (reason !== null)
      violations.push({
        kind: 'bye_recipient',
        event,
        entry,
        fixture: ref,
        reason,
      });
  }
  return violations;
};
