import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleLibrary } from '../../ui/mock/prep';
import { getBrief } from './get-brief';

setupRitewayBun();

describe('getBrief', () => {
  test('known, new and unknown ids', () => {
    assert({
      given: 'a known id, "new" and an unknown id',
      should: 'find the brief, a blank brief, and nothing',
      actual: [
        getBrief('rights-framework')?.contentions.length,
        getBrief('new')?.title,
        getBrief('x'),
      ],
      expected: [3, '', undefined],
    });
  });

  test('every library brief opens and agrees with the library row', () => {
    assert({
      given: 'the brief items in the library',
      should:
        'each resolve with the same title, side, motion and contention count',
      actual: sampleLibrary('2026-09-30T12:00:00.000Z')
        .filter((item) => item.kind === 'brief')
        .filter((item) => {
          const brief = getBrief(item.id);
          return (
            brief === undefined ||
            brief.title !== item.title ||
            brief.side !== item.side ||
            brief.motion !== item.motion ||
            brief.contentions.length !== item.contentions
          );
        })
        .map((item) => item.id),
      expected: [],
    });
  });
});
