import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { debateHref, parseDebateQuery, placeholderOutcome } from './state';

setupRitewayBun();

describe('parseDebateQuery', () => {
  test('defaults', () => {
    assert({
      given: 'no query',
      should:
        'open on the affirmative speech, judged by a person, as a debater',
      actual: parseDebateQuery({}),
      expected: {
        turn: 2,
        judgeKind: 'person',
        viewer: 'debater',
        ruledBy: null,
      },
    });
  });

  test('nonsense', () => {
    assert({
      given: 'a turn past the end, an unknown judge and an unknown viewer',
      should: 'fall back to the defaults',
      actual: parseDebateQuery({
        turn: '9',
        kind: 'robot',
        as: 'admin',
        by: 'x',
      }),
      expected: {
        turn: 2,
        judgeKind: 'person',
        viewer: 'debater',
        ruledBy: null,
      },
    });
  });

  test('a round trip', () => {
    const query = {
      turn: 6,
      judgeKind: 'ai' as const,
      viewer: 'judge' as const,
      ruledBy: 'ai' as const,
    };
    const params = Object.fromEntries(
      new URL(debateHref('demo', query), 'https://x').searchParams,
    );
    assert({
      given: 'a state written to an address and read back',
      should: 'give the same state',
      actual: parseDebateQuery(params),
      expected: query,
    });
  });
});

describe('placeholderOutcome', () => {
  test('stable and two-sided', () => {
    const ids = ['a', 'b', 'room-newcomers', 'created', 'started'];
    assert({
      given: 'several debate ids',
      should: 'give the same pick every time and reach both sides',
      actual: [
        ids.map(placeholderOutcome).join() ===
          ids.map(placeholderOutcome).join(),
        new Set(ids.map(placeholderOutcome)).size,
      ],
      expected: [true, 2],
    });
  });
});
