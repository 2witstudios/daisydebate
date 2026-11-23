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
        "eq(rounds.status, 'active');",
        "notInArray(rooms['status'], ['assembling', 'ready']);",
        "db.insert(rooms).values({ status: 'assembling' });",
        "db.update(rounds).set({ status: 'completed' });",
      ].join('\n'),
    ),
  ).toEqual([
    word(7, 'active', 'rounds.status'),
    word(8, 'assembling', 'rooms.status'),
    word(8, 'ready', 'rooms.status'),
    word(9, 'assembling', 'rooms.status'),
    word(10, 'completed', 'rounds.status'),
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
// column now counts, in SQL text, Drizzle calls and schema extras.
test('rejects a word of any stored vocabulary, not only Room and Round status', () => {
  expect(
    problems(
      [
        "sql`select * from rounds d join seasons s on s.id = d.season_id where s.status = 'active'`;",
        "eq(seasons.status, 'active');",
        "sql`update messaging_files set lifecycle = 'deleting' where id = ${id}`;",
        "sql`select 1 from actors a where a.kind = 'bot'`;",
        "db.update(friendships).set({ state: 'accepted' });",
      ].join('\n'),
    ),
  ).toEqual([
    word(2, 'active', 'seasons.status'),
    word(5, 'accepted', 'friendships.state'),
    word(1, 'active', 'seasons.status'),
    word(3, 'deleting', 'messaging_files.lifecycle'),
    word(4, 'bot', 'actors.kind'),
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

test('rejects aliased comparisons and lifecycle values built before the write', () => {
  const helper = 'packages/db/src/lifecycle-fixture-values.ts';
  const text = [
    "import { roomValues } from './lifecycle-fixture-values';",
    "const r = alias(rounds, 'r');",
    "eq(r.status, 'completed');",
    "db.insert(rounds).values({ status: opens ? 'opening' : 'active' });",
    'db.insert(rooms).values({ ...roomValues(room) });',
    "const copied = 'started'; db.update(rooms).set({ status: copied });",
  ].join('\n');
  expect(
    lifecycleLiteralIssues({ path, text }, (target) =>
      target === helper
        ? "export const roomValues = (room) => ({ id: room.id, status: 'assembling' as const });"
        : undefined,
    ),
  ).toEqual([
    word(3, 'completed', 'rounds.status'),
    word(4, 'opening', 'rounds.status'),
    word(4, 'active', 'rounds.status'),
    word(5, 'assembling', 'rooms.status'),
    word(6, 'started', 'rooms.status'),
  ]);
});
