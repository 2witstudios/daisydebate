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
  test('an unquoted key, a parameter and a property read', () => {
    assert({
      given:
        'a product module with an object key, a parameter and a property read of a side',
      should: 'report each line',
      actual: sideLiteralIssues([
        {
          path: 'packages/db/src/x.ts',
          text: 'const a = { affirmative: 1 };\nconst f = (negative: string) => negative;\nrated.affirmative;\nconst y = { [affirmativeSide]: 1 };',
        },
      ]).map((issue) => issue.split(':')[1]),
      expected: ['1', '2', '3'],
    });
  });
  test('the pairwise rating code', () => {
    assert({
      given: 'the rating modules the header allow-lists',
      should: 'report nothing',
      actual: sideLiteralIssues([
        {
          path: 'packages/debate-engine/src/rating.ts',
          text: 'affirmative: 1',
        },
        {
          path: 'apps/web/src/features/ratings/read-round.ts',
          text: 'rated.negative',
        },
      ]),
      expected: [],
    });
  });
});
