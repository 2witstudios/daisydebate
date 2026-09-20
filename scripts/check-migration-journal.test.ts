import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createMigrationCheckReport,
  findJournalProblems,
  parseJournal,
} from './check-migration-journal';

setupRitewayBun();

const base = [{ tag: '0000_init' }, { tag: '0001_add_debates' }];

describe('parseJournal', () => {
  test('reads tags and optional prevIds from a committed journal', () => {
    assert({
      given: 'a drizzle journal with entries lacking prevId',
      should: 'produce tag-only entries',
      actual: parseJournal(
        '{"entries":[{"idx":0,"tag":"0000_a"},{"idx":1,"tag":"0001_b","prevId":"0000_a"}]}',
      ),
      expected: [{ tag: '0000_a' }, { tag: '0001_b', prevId: '0000_a' }],
    });
  });

  test('rejects a journal without an entries array', () => {
    assert({
      given: 'malformed journal JSON',
      should: 'throw instead of silently passing',
      actual: (() => {
        try {
          parseJournal('{"nope":true}');
          return 'no throw';
        } catch {
          return 'threw';
        }
      })(),
      expected: 'threw',
    });
  });
});

describe('findJournalProblems', () => {
  test('accepts an appended tail of new migrations', () => {
    const head = [...base, { tag: '0002_new_thing' }];
    assert({
      given: 'a branch that only appends migrations',
      should: 'report no problems',
      actual: findJournalProblems(base, head),
      expected: [],
    });
  });

  test('accepts an unchanged journal', () => {
    assert({
      given: 'base and head identical',
      should: 'report no problems',
      actual: findJournalProblems(base, base),
      expected: [],
    });
  });

  test('flags a removed applied migration as truncated history', () => {
    const head = [{ tag: '0000_init' }];
    assert({
      given: 'a branch that dropped an applied migration',
      should: 'fail with TRUNCATED_HISTORY',
      actual: findJournalProblems(base, head).map(({ code }) => code),
      expected: ['TRUNCATED_HISTORY'],
    });
  });

  test('flags a reordering of shared migrations as rewritten history', () => {
    const head = [{ tag: '0001_add_debates' }, { tag: '0000_init' }];
    assert({
      given: 'a branch that reordered shared migrations',
      should: 'fail with REWRITTEN_HISTORY at each moved position',
      actual: findJournalProblems(base, head).map(({ code }) => code),
      expected: ['REWRITTEN_HISTORY', 'REWRITTEN_HISTORY'],
    });
  });

  test('flags duplicate tags from parallel generation', () => {
    const head = [
      ...base,
      { tag: '0002_add_thing' },
      { tag: '0002_add_thing' },
    ];
    assert({
      given: 'two branches that generated the same migration tag',
      should: 'fail with DUPLICATE_TAG',
      actual: findJournalProblems(base, head).map(({ code }) => code),
      expected: ['DUPLICATE_TAG'],
    });
  });

  test('flags a prevId chain break', () => {
    const head = [
      { tag: '0000_init' },
      { tag: '0001_add_debates', prevId: '0009_ghost' },
    ];
    assert({
      given: 'an entry whose prevId does not match its predecessor',
      should: 'fail with BROKEN_CHAIN',
      actual: findJournalProblems(base, head).map(({ code }) => code),
      expected: ['BROKEN_CHAIN'],
    });
  });

  test('flags a first entry that claims a predecessor', () => {
    const head = [{ tag: '0000_init', prevId: 'not-null' }];
    assert({
      given: 'a first migration declaring a prevId',
      should: 'fail with BROKEN_CHAIN',
      actual: findJournalProblems([], head).map(({ code }) => code),
      expected: ['BROKEN_CHAIN'],
    });
  });

  test('accepts an absent prevId chain (journal version without prevId)', () => {
    assert({
      given: 'entries without prevId fields',
      should: 'report no chain problems',
      actual: findJournalProblems(base, base),
      expected: [],
    });
  });
});

describe('createMigrationCheckReport', () => {
  test('ok tracks the absence of problems', () => {
    const problems = findJournalProblems(base, [{ tag: '0000_init' }]);
    assert({
      given: 'a truncated history',
      should: 'produce a failing report with counts',
      actual: createMigrationCheckReport(
        'origin/main',
        base,
        [{ tag: '0000_init' }],
        problems,
      ).ok,
      expected: false,
    });
  });
});
