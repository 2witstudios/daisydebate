import { expect, test } from 'bun:test';
import { lifecycleLiteralIssues } from './check-lifecycle-literals';

const path = 'packages/db/src/lifecycle-fixture.ts';
const problems = (text: string) => lifecycleLiteralIssues({ path, text });
const word = (line: number, value: string, column: string) =>
  `${path}:${line}: '${value}' is a ${column} word; read it from its vocabulary list`;

test('rejects SQL lifecycle literals in predicates and writes', () => {
  expect(
    problems(
      [
        "sql`select * from rounds d where d.status in ('opening', 'active')`;",
        "sql`select * from public.rooms as r where 'ready' = r.status`;",
        "sql`update rounds set status = 'completed' where id = ${id}`;",
        "sql.raw(`insert into rooms (id, status) values ('id', 'closed')`);",
        "sql`select * from rooms where status = any(array['assembling'])`;",
        "sql`select * from rounds where ${rounds.status} = ${'abandoned'}`;",
      ].join('\n'),
    ),
  ).toEqual([
    word(1, 'opening', 'rounds.status'),
    word(1, 'active', 'rounds.status'),
    word(2, 'ready', 'rooms.status'),
    word(3, 'completed', 'rounds.status'),
    word(4, 'closed', 'rooms.status'),
    word(5, 'assembling', 'rooms.status'),
    word(6, 'abandoned', 'rounds.status'),
  ]);
});

test('allows status values from protocol and unrelated lifecycle words', () => {
  expect(
    problems(
      [
        'sql`select * from rounds d where d.status in ${lifecycleSqlList(runningRoundStatuses)}`;',
        "sql`select * from round_judging_jobs r where r.status = 'completed'`;",
        'eq(rounds.status, roundStatus.active);',
        "sql`select * from rounds where visibility = ${listedWord(roundVisibilities, 'public')}`;",
      ].join('\n'),
    ),
  ).toEqual([]);
});

// RECON-3.11: the check covered two vocabularies; every CHECK-constrained
// column now counts, in SQL text and schema extras.
test('rejects a word of any stored vocabulary, not only Room and Round status', () => {
  expect(
    problems(
      [
        "sql`select * from rounds d join seasons s on s.id = d.season_id where s.status = 'active'`;",
        "sql`update messaging_files set lifecycle = 'deleting' where id = ${id}`;",
        "sql`select 1 from actors a where a.kind = 'bot'`;",
      ].join('\n'),
    ),
  ).toEqual([
    word(1, 'active', 'seasons.status'),
    word(2, 'deleting', 'messaging_files.lifecycle'),
    word(3, 'bot', 'actors.kind'),
  ]);
});

test("rejects a word in a schema table's own CHECK text", () => {
  const schema = 'packages/db/src/schema/messaging-social-fixture.ts';
  expect(
    lifecycleLiteralIssues({
      path: schema,
      text: [
        "export const messagingDmPairs = pgTable('messaging_dm_pairs', {}, (table) => [",
        "  check('x', sql`(${table.requestState} = 'pending') = (${table.decidedAt} is null)`),",
        ']);',
      ].join('\n'),
    }),
  ).toEqual([
    `${schema}:2: 'pending' is a messaging_dm_pairs.request_state word; read it from its vocabulary list`,
  ]);
});

test('rejects a lifecycle literal in a native Bun query', () => {
  expect(
    problems(
      "client`select r.id from rounds r where r.status in ('opening', 'active')`;",
    ),
  ).toEqual([
    word(1, 'opening', 'rounds.status'),
    word(1, 'active', 'rounds.status'),
  ]);
});

test('rejects a word compared with an aliased table column in SQL text', () => {
  expect(
    problems(
      [
        "const r = alias(rounds, 'r');",
        "sql`select 1 from ${r} where ${r.status} = 'completed'`;",
      ].join('\n'),
    ),
  ).toEqual([word(2, 'completed', 'rounds.status')]);
});

// Every CHECK-constrained column carries its list's union
// (packages/db/src/schema-vocabularies.test.ts), so a Drizzle call's
// literal is checked by the compiler and stays legal.
test('leaves typed Drizzle comparisons and writes to the compiler', () => {
  expect(
    problems(
      [
        "eq(seasons.status, 'active');",
        "notInArray(rooms.status, ['assembling', 'ready']);",
        "db.update(friendships).set({ state: 'accepted' });",
        "db.insert(rooms).values({ status: 'assembling' });",
      ].join('\n'),
    ),
  ).toEqual([]);
});

// A canonical function file is pinned byte for byte to an installed
// function and cannot import a list, so its words must belong to the list:
// renaming or removing one fails here until a migration updates the function.
test('holds a canonical .sql function file to its columns lists', () => {
  const file = 'packages/db/src/account-fence-fixture.sql';
  const fence = (kind: string) =>
    lifecycleLiteralIssues({
      path: file,
      text: [
        'SELECT a.id FROM actors a',
        `WHERE a.kind = '${kind}' AND a.user_id = $1;`,
      ].join('\n'),
    });
  expect([fence('human'), fence('robot')]).toEqual([
    [],
    [
      `${file}:2: 'robot' is not a actors.kind word; a canonical function file may compare or write only its list's words`,
    ],
  ]);
});
