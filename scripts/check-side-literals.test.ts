import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sideLiteralIssues } from './check-side-literals';

setupRitewayBun();

describe('sideLiteralIssues', () => {
  test('a side key spelled outside the preset', () => {
    assert({
      given: 'a product module comparing a role to a side literal',
      should: 'report the line',
      actual: sideLiteralIssues([
        {
          path: 'packages/db/src/x.ts',
          text: "a\nif (role === 'affirmative') {}",
        },
      ]),
      expected: [
        "packages/db/src/x.ts:2: a side key is read through @daisy/protocol's seats, never spelled",
      ],
    });
  });
  test('the preset, tests and prose', () => {
    assert({
      given: 'the protocol preset, a test file and a capitalised label',
      should: 'report nothing',
      actual: sideLiteralIssues([
        { path: 'packages/protocol/src/seats.ts', text: "key: 'affirmative'" },
        { path: 'apps/web/src/x.test.ts', text: "'negative'" },
        { path: 'apps/web/src/y.tsx', text: "label: 'Affirmative'" },
      ]),
      expected: [],
    });
  });
});
