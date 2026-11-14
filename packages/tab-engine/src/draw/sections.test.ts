import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Section, Speakers, StageHistory } from '../shapes/competition';
import { draw } from './index';
import { schoolsOf } from './facts';
import {
  drawsOf,
  entries,
  entry,
  fixturesOf,
  request,
  seedOf,
  speakers,
  withSettings,
} from './draw.test-support';

setupRitewayBun();

const permutations = <T>(items: readonly T[]): T[][] =>
  items.length <= 1
    ? [[...items]]
    : items.flatMap((x, i) =>
        permutations(items.filter((_, j) => j !== i)).map((rest) => [
          x,
          ...rest,
        ]),
      );

const sameSchool = withSettings({ 'pairing.same_school': { force: 'rule' } });
const sectionsOf = (answer: ReturnType<typeof draw>) =>
  fixturesOf(drawsOf(answer)[0]!).filter(
    (f): f is Section => f.kind === 'section',
  );

describe('sections', () => {
  test('sizes differ by at most one, and no same-school rule is broken where the numbers allow', () => {
    const failures: string[] = [];
    for (let count = 8; count <= 30; count += 1) {
      const sections = Math.max(1, Math.round(count / 6));
      const field = entries(count, Math.ceil(count / sections));
      const answer = draw({
        call: 'windowed',
        event: request(speakers, { entries: field, settings: sameSchool }),
        judges: null,
        seed: seedOf(count),
      });
      if (answer.kind !== 'drawn') {
        failures.push(`${count}: ${answer.kind}`);
        continue;
      }
      const sizes = sectionsOf(answer).map((s) => s.speakers.length);
      if (Math.max(...sizes) - Math.min(...sizes) > 1)
        failures.push(`${count}: sizes ${sizes}`);
      const school = new Map(field.map((e) => [e.id, schoolsOf(e)[0]]));
      for (const s of sectionsOf(answer))
        if (
          new Set(s.speakers.map((e) => school.get(e))).size < s.speakers.length
        )
          failures.push(`${count}: school`);
    }
    assert({
      given:
        'fields of 8 to 30 speakers, as many to a school as there are sections, under a same-school rule',
      should:
        'make sections whose sizes differ by at most one, none holding two of a school',
      actual: failures,
      expected: [],
    });
  });

  test('a school with more entries than there are sections is infeasible, exactly', () => {
    const field = [
      ...['a', 'b', 'c', 'd'].map((id) => entry(id, 'big')),
      ...entries(8, 8, 'x'),
    ];
    const answer = draw({
      call: 'windowed',
      event: request(speakers, { entries: field, settings: sameSchool }),
      judges: null,
      seed: seedOf(1),
    });
    assert({
      given: 'twelve speakers in two sections, four of them from one school',
      should: 'answer infeasible on the same-school rule',
      actual:
        answer.kind === 'infeasible' && answer.cause === 'rules'
          ? answer.rules
          : answer.kind,
      expected: ['pairing.same_school'],
    });
  });

  test('within each section no other speaker order leaves position history more even', () => {
    const field = entries(12, 12);
    const first = sectionsOf(
      draw({
        call: 'windowed',
        event: request(speakers, { entries: field }),
        judges: null,
        seed: seedOf(3),
      }),
    );
    const history: StageHistory<Speakers> = {
      fixtures: first.map((fixture, i) => ({
        id: `s1-${i}`,
        tabRound: 1,
        fixture,
      })),
      results: [],
    };
    const second = sectionsOf(
      draw({
        call: 'windowed',
        event: request(speakers, { entries: field, tabRound: 2, history }),
        judges: null,
        seed: seedOf(4),
      }),
    );
    const placeBefore = new Map(
      first.flatMap((s) => s.speakers.map((e, p) => [e, p] as const)),
    );
    const spread = (order: readonly string[]) =>
      order.reduce((sum, e, p) => {
        const counts = order.map(
          (_, q) => (placeBefore.get(e) === q ? 1 : 0) + (q === p ? 1 : 0),
        );
        return sum + counts.reduce((s, c) => s + c * c, 0);
      }, 0);
    assert({
      given: 'a second round of sections after one where each spoke once',
      should: 'give each section an order no permutation improves on',
      actual: second.map(
        (s) =>
          spread(s.speakers) ===
          Math.min(...permutations(s.speakers).map(spread)),
      ),
      expected: second.map(() => true),
    });
  });
});
