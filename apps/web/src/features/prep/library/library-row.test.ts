import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleLibrary } from '../../../ui/mock/prep';
import { toRow, usedLabel } from './library-row';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';
const item = (id: string) => {
  const found = sampleLibrary(now).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no sample ${id}`);
  return found;
};

describe('toRow', () => {
  test('a brief', () => {
    assert({
      given: 'a team brief edited two days ago',
      should: 'read its subtitle, link and edit age',
      actual: (({ subtitle, href, meta }) => ({
        subtitle,
        href,
        meta,
      }))(toRow(item('rights-framework'), now)),
      expected: {
        subtitle: '[Motion A] · Aff · 3 contentions',
        href: '/prep/briefs/rights-framework',
        meta: 'Edited 2 days ago',
      },
    });
  });

  test('a card', () => {
    assert({
      given: 'a card used in three places',
      should: 'show its citation line and how often it is used',
      actual: (({ subtitle, meta, href }) => ({ subtitle, meta, href }))(
        toRow(item('cost-estimates'), now),
      ),
      expected: {
        subtitle: '[Author A], [Publication], [year] · Source: [Outlet]',
        meta: 'Used in 3',
        href: '/prep/cards/cost-estimates',
      },
    });
  });

  test('a case', () => {
    assert({
      given: 'a case at version 4',
      should: 'show its motion, side and version',
      actual: toRow(item('aff-rights'), now).subtitle,
      expected: '[Motion A] · Aff · v4',
    });
  });
});

describe('usedLabel', () => {
  test('none and some', () => {
    assert({
      given: '0 and 1 uses',
      should: 'say not used yet and used in 1',
      actual: [usedLabel(0), usedLabel(1)],
      expected: ['Not used yet', 'Used in 1'],
    });
  });
});
