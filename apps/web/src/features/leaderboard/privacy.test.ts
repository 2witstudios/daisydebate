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
});

describe('privacySettingRows', () => {
  test('rows follow the account answers', () => {
    assert({
      given: 'the account on the ladder and then off it',
      should:
        'show the one ladder setting as the account has it, and no region setting',
      actual: [
        privacySettingRows({ ladder: true }).map((s) => [s.id, s.on]),
        privacySettingRows({ ladder: false }).map((s) => s.on),
      ],
      expected: [[['appear-on-ladder', true]], [false]],
    });
  });
});

describe('privacySections', () => {
  test('no band or region', () => {
    const titles = privacySections.flatMap((section) =>
      section.rows.map((row) => row.title),
    );
    assert({
      given: 'every row the privacy page lists',
      should: 'list no band and no region',
      actual: titles.some((title) => /band|region/i.test(title)),
      expected: false,
    });
  });
});
