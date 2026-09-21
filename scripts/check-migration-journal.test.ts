import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createMigrationCheckReport,
  excuseSanctionedSquash,
  findJournalProblems,
  findSharedFileProblems,
  journalFingerprint,
  parseBaseRef,
  parseJournal,
} from './check-migration-journal';

setupRitewayBun();

const base = [{ tag: '0000_init' }, { tag: '0001_add_debates' }];

describe('parseJournal', () => {
  test('reads tags and preserves metadata needed for immutability checks', () => {
    assert({
      given: 'a drizzle journal with timestamps and breakpoints',
      should: 'preserve the full entry fields',
      actual: parseJournal(
        '{"entries":[{"idx":0,"when":1000,"tag":"0000_a","breakpoints":true},{"idx":1,"when":2000,"tag":"0001_b","prevId":"0000_a"}]}',
      ),
      expected: [
        { idx: 0, when: 1000, tag: '0000_a', breakpoints: true },
        { idx: 1, when: 2000, tag: '0001_b', prevId: '0000_a' },
      ],
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

  test('flags an edited timestamp on a shared migration as rewritten metadata', () => {
    const timedBase = [
      { tag: '0000_init', when: 1000 },
      { tag: '0001_add_debates', when: 2000 },
    ];
    const head = [
      { tag: '0000_init', when: 9999 },
      { tag: '0001_add_debates', when: 2000 },
    ];
    assert({
      given: 'a branch that edited a shared migration timestamp',
      should: 'fail with REWRITTEN_METADATA',
      actual: findJournalProblems(timedBase, head).map(({ code }) => code),
      expected: ['REWRITTEN_METADATA'],
    });
  });

  test('accepts shared entries that differ only in JSON key order', () => {
    const timedBase = [{ tag: '0000_init', when: 1000 }];
    const head = [{ when: 1000, tag: '0000_init' }];
    assert({
      given: 'the same entry with reordered keys',
      should: 'report no problems',
      actual: findJournalProblems(timedBase, head),
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
      should: 'fail with BROKEN_CHAIN alongside the shared-metadata rewrite',
      actual: findJournalProblems(base, head).map(({ code }) => code),
      expected: ['REWRITTEN_METADATA', 'BROKEN_CHAIN'],
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

describe('findSharedFileProblems', () => {
  test('accepts unchanged shared SQL files', () => {
    assert({
      given: 'identical SQL content on base and head',
      should: 'report no problems',
      actual: findSharedFileProblems([
        { tag: '0000_init', base: 'CREATE TABLE a;', head: 'CREATE TABLE a;' },
      ]),
      expected: [],
    });
  });

  test('flags a rewritten shared SQL file', () => {
    assert({
      given: 'a branch that rewrote a shared migration file',
      should: 'fail with REWRITTEN_SQL',
      actual: findSharedFileProblems([
        { tag: '0000_init', base: 'CREATE TABLE a;', head: 'CREATE TABLE b;' },
      ]).map(({ code }) => code),
      expected: ['REWRITTEN_SQL'],
    });
  });

  test('flags a deleted shared SQL file', () => {
    assert({
      given: 'a shared migration whose SQL file is missing at head',
      should: 'fail with REWRITTEN_SQL',
      actual: findSharedFileProblems([
        { tag: '0000_init', base: 'CREATE TABLE a;', head: undefined },
      ]).map(({ code }) => code),
      expected: ['REWRITTEN_SQL'],
    });
  });

  test('accepts a newly appended SQL file', () => {
    assert({
      given: 'a new migration file that the base lacks',
      should: 'report no problems',
      actual: findSharedFileProblems([
        { tag: '0002_new', base: undefined, head: 'CREATE TABLE c;' },
      ]),
      expected: [],
    });
  });
});

describe('parseBaseRef', () => {
  test('defaults to origin/main when only flags are passed', () => {
    assert({
      given: 'argv containing only a --json flag',
      should: 'keep the default base ref',
      actual: parseBaseRef([
        'bun',
        'scripts/check-migration-journal.ts',
        '--json',
      ]),
      expected: 'origin/main',
    });
  });

  test('uses the first positional argument as the base ref', () => {
    assert({
      given: 'a positional ref followed by a flag',
      should: 'select the positional ref',
      actual: parseBaseRef([
        'bun',
        'scripts/check-migration-journal.ts',
        'origin/develop',
        '--json',
      ]),
      expected: 'origin/develop',
    });
  });
});

describe('journalFingerprint', () => {
  test('is stable across JSON key order and sensitive to content', () => {
    const timedBase = [{ tag: '0000_init', when: 1000 }];
    const reordered = [{ when: 1000, tag: '0000_init' }];
    const edited = [{ tag: '0000_init', when: 2000 }];
    assert({
      given: 'the same journal with reordered keys or edited content',
      should: 'hash equal only for identical history',
      actual: {
        reorderedEqual:
          journalFingerprint(timedBase) === journalFingerprint(reordered),
        editedEqual:
          journalFingerprint(timedBase) === journalFingerprint(edited),
      },
      expected: { reorderedEqual: true, editedEqual: false },
    });
  });
});

describe('excuseSanctionedSquash', () => {
  const baseline = {
    baseJournalHash: journalFingerprint(base),
    adr: 'docs/decisions/0023-greenfield-baseline.md',
  };

  test('excuses a full-history replacement only for the recorded base journal', () => {
    const head = [{ tag: '0000_fresh_baseline' }];
    const result = excuseSanctionedSquash(findJournalProblems(base, head), {
      base,
      head,
      baselines: [baseline],
    });
    assert({
      given: 'a squash whose base journal hash is sanctioned',
      should: 'excuse the rewrite and mark the report sanctioned',
      actual: result,
      expected: { problems: [], sanctioned: true },
    });
  });

  test('keeps the failure when no sanctioned baseline matches', () => {
    const head = [{ tag: '0000_fresh_baseline' }];
    const result = excuseSanctionedSquash(findJournalProblems(base, head), {
      base,
      head,
      baselines: [
        {
          baseJournalHash: journalFingerprint(head),
          adr: 'docs/decisions/0023-greenfield-baseline.md',
        },
      ],
    });
    assert({
      given: 'a squash whose base journal hash is not sanctioned',
      should: 'keep every rewrite problem and stay unsanctioned',
      actual: result.problems.map(({ code }) => code).sort(),
      expected: ['REWRITTEN_HISTORY', 'TRUNCATED_HISTORY'],
    });
  });

  test('keeps duplicate tags or chain breaks even when sanctioned', () => {
    const brokenHead = [
      { tag: '0000_fresh_baseline' },
      { tag: '0000_fresh_baseline' },
    ];
    const result = excuseSanctionedSquash(
      findJournalProblems(base, brokenHead),
      { base, head: brokenHead, baselines: [baseline] },
    );
    assert({
      given: 'a sanctioned squash whose head journal is internally broken',
      should: 'keep the structural problems',
      actual: {
        keepsDuplicateTag: result.problems.some(
          ({ code }) => code === 'DUPLICATE_TAG',
        ),
        sanctioned: result.sanctioned,
      },
      expected: { keepsDuplicateTag: true, sanctioned: false },
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
