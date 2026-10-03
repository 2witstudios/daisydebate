import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { privacySections, privacySettingRows } from './privacy';

setupRitewayBun();

const rows = privacySections.flatMap((section) => section.rows);

describe('privacy rows', () => {
  test('sections', () => {
    assert({
      given: 'the privacy sections',
      should: 'be public, private and hidden on purpose',
      actual: privacySections.map((section) => section.title),
      expected: ['Public', 'Private', 'Hidden on purpose'],
    });
  });

  test('every personal field has a visibility', () => {
    assert({
      given: 'every row tagged personal',
      should: 'carry public or private visibility (ADR 0036)',
      actual: rows
        .filter((row) => row.tag === 'personal')
        .every((row) => row.visibility !== undefined),
      expected: true,
    });
  });

  test('private rows are never public', () => {
    assert({
      given: 'the private section',
      should: 'list no public field',
      actual: privacySections[1]?.rows.some(
        (row) => row.visibility === 'public',
      ),
      expected: false,
    });
  });

  test('region is proposed', () => {
    assert({
      given: 'the region field',
      should: 'be marked proposed',
      actual: rows.filter((row) => row.proposed).map((row) => row.title),
      expected: ['Region'],
    });
  });
});

describe('privacySettingRows', () => {
  test('rows follow the account answers', () => {
    assert({
      given: 'the default answers and a changed set',
      should: 'show each setting as the account has it',
      actual: [
        privacySettingRows({ ladder: true, showRegion: false }).map((s) => [
          s.id,
          s.on,
        ]),
        privacySettingRows({ ladder: false, showRegion: true }).map(
          (s) => s.on,
        ),
      ],
      expected: [
        [
          ['show-region', false],
          ['appear-on-ladder', true],
        ],
        [true, false],
      ],
    });
  });
});
