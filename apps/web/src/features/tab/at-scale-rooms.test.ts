import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { drawAtScale } from './at-scale-rooms';
import { sampleDrawView } from './sample/draw';
import type { SampleScene } from './sample/scene';

setupRitewayBun();

const large = (moment: SampleScene['moment']): SampleScene => ({
  viewer: 'host',
  moment,
  scale: 'large',
});

describe('the draw at scale', () => {
  test('fixtures with a finding come first; groups hold the rest', () => {
    const draw = sampleDrawView(
      'autumn-open',
      'varsity-debate',
      '4',
      large('prelims'),
    );
    const scaled = draw === null ? null : drawAtScale(draw.read);
    assert({
      given: 'the large round 4 draft',
      should:
        'list the seven fixtures with a finding, bent preferences first, and keep each group the rest',
      actual: [
        scaled?.lookFirst.length,
        scaled?.lookFirst[0]?.entries.map((entry) => entry.name).join(' v '),
        scaled?.lookFirst.at(-1)?.findings[0]?.severity,
        scaled?.groups.map(
          (group) =>
            `${group.record.value.n / group.record.value.d}: ${group.fixtures.length} + ${group.listedAbove} of ${group.total}`,
        ),
      ],
      expected: [
        7,
        'Doyle v Sato',
        'note',
        [
          '3: 12 + 1 of 13',
          '2: 33 + 4 of 37',
          '1: 35 + 2 of 37',
          '0: 13 + 0 of 13',
        ],
      ],
    });
  });
});
