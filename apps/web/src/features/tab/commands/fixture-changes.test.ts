import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixtureChangesOf } from './fixture-changes';

setupRitewayBun();

const round = 'r00000000000000000000001';
const f = (n: number) => `f${String(n).padStart(23, '0')}`;
const p = (n: number) => `p${String(n).padStart(23, '0')}`;

describe('fixtureChangesOf', () => {
  test('a first version adds every fixture', () => {
    assert({
      given: 'a first published version of two fixtures',
      should: 'answer both as added with the people seated after',
      actual: fixtureChangesOf(
        {
          tabRoundId: round,
          drawVersion: 1,
          fixtures: [
            { fixtureId: f(1), people: [p(2), p(1), p(2)] },
            { fixtureId: f(2), people: [p(3)] },
          ],
        },
        null,
      ),
      expected: [
        {
          kind: 'added',
          fixtureId: f(1),
          tabRoundId: round,
          drawVersion: 1,
          people: [p(1), p(2)],
        },
        {
          kind: 'added',
          fixtureId: f(2),
          tabRoundId: round,
          drawVersion: 1,
          people: [p(3)],
        },
      ],
    });
  });

  test('a later version answers exactly what it added and withdrew', () => {
    assert({
      given: 'a version keeping one fixture, re-pairing another and adding one',
      should: 'leave the kept fixture out and list the rest',
      actual: fixtureChangesOf(
        {
          tabRoundId: round,
          drawVersion: 3,
          fixtures: [
            { fixtureId: f(1), people: [p(1)] },
            { fixtureId: f(3), people: [p(2), p(4)] },
          ],
        },
        {
          tabRoundId: round,
          drawVersion: 1,
          fixtures: [
            { fixtureId: f(1), people: [p(1)] },
            { fixtureId: f(2), people: [p(2), p(3)] },
          ],
        },
      ),
      expected: [
        {
          kind: 'added',
          fixtureId: f(3),
          tabRoundId: round,
          drawVersion: 3,
          people: [p(2), p(4)],
        },
        {
          kind: 'withdrawn',
          fixtureId: f(2),
          tabRoundId: round,
          drawVersion: 3,
          people: [p(2), p(3)],
        },
      ],
    });
  });

  test('the same set answers no change', () => {
    const version = {
      tabRoundId: round,
      drawVersion: 2,
      fixtures: [{ fixtureId: f(1), people: [p(1)] }],
    };
    assert({
      given: 'two versions with the same fixtures',
      should: 'answer nothing',
      actual: fixtureChangesOf(version, { ...version, drawVersion: 1 }),
      expected: [],
    });
  });
});
