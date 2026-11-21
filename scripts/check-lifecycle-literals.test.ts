import { expect, test } from 'bun:test';
import { lifecycleLiteralIssues } from './check-lifecycle-literals';

const path = 'packages/db/src/lifecycle-fixture.ts';
const problems = (text: string) => lifecycleLiteralIssues({ path, text });

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
    `${path}:7: read lifecycle status 'active' from @daisy/protocol`,
    `${path}:8: read lifecycle status 'assembling' from @daisy/protocol`,
    `${path}:8: read lifecycle status 'ready' from @daisy/protocol`,
    `${path}:9: read lifecycle status 'assembling' from @daisy/protocol`,
    `${path}:10: read lifecycle status 'completed' from @daisy/protocol`,
    `${path}:1: read lifecycle status 'opening' from @daisy/protocol`,
    `${path}:1: read lifecycle status 'active' from @daisy/protocol`,
    `${path}:2: read lifecycle status 'ready' from @daisy/protocol`,
    `${path}:3: read lifecycle status 'completed' from @daisy/protocol`,
    `${path}:4: read lifecycle status 'closed' from @daisy/protocol`,
    `${path}:5: read lifecycle status 'assembling' from @daisy/protocol`,
    `${path}:6: read lifecycle status 'abandoned' from @daisy/protocol`,
  ]);
});

test('allows status values from protocol and unrelated lifecycle words', () => {
  expect(
    problems(
      [
        'sql`select * from rounds d where d.status in ${lifecycleSqlList(runningRoundStatuses)}`;',
        "sql`select * from rounds d join seasons s on s.id = d.season_id where s.status = 'active'`;",
        "sql`select * from round_judging_jobs r where r.status = 'completed'`;",
        'eq(rounds.status, roundStatus.active);',
        "eq(seasons.status, 'active');",
      ].join('\n'),
    ),
  ).toEqual([]);
});

test('rejects a lifecycle literal in a native Bun query', () => {
  expect(
    problems(
      "client`select r.id from rounds r where r.status in ('opening', 'active')`;",
    ),
  ).toEqual([
    `${path}:1: read lifecycle status 'opening' from @daisy/protocol`,
    `${path}:1: read lifecycle status 'active' from @daisy/protocol`,
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
    `${path}:3: read lifecycle status 'completed' from @daisy/protocol`,
    `${path}:4: read lifecycle status 'opening' from @daisy/protocol`,
    `${path}:4: read lifecycle status 'active' from @daisy/protocol`,
    `${path}:5: read lifecycle status 'assembling' from @daisy/protocol`,
    `${path}:6: read lifecycle status 'started' from @daisy/protocol`,
  ]);
});
