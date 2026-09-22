import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';

/** True when the statement is refused by PostgreSQL; the error is the proof. */
export const rejected = async (attempt: () => Promise<unknown>) => {
  try {
    await attempt();
    return false;
  } catch {
    return true;
  }
};

type Row = Readonly<Record<string, unknown>>;

/** Cleanup order: children before parents; RESTRICT edges never fire. */
const purgeOrder: ReadonlyArray<readonly [table: string, key: string]> = [
  ['ballots', 'id'],
  ['rating_changes', 'id'],
  ['ratings', 'actor_id'],
  ['debate_participants', 'id'],
  ['debate_commands', 'command_id'],
  ['debates', 'id'],
  ['seasons', 'id'],
  ['role_grants', 'id'],
  ['actors', 'id'],
  ['users', 'id'],
  ['formats', 'id'],
];

const validRules =
  '{"version":1,"seats":{"affirmative":1,"negative":1,"judge":0},"clock":{"speechMs":1000,"prepMs":0}}';

/**
 * Per-test fixture over one connection. Every inserted key is tracked and
 * deleted in `finally`, so a failing assertion leaves no rows behind.
 */
export class Fixture {
  readonly tracked = new Map<string, string[]>();
  constructor(readonly sql: SQL) {}

  track(table: string, key: string) {
    const keys = this.tracked.get(table) ?? [];
    keys.push(key);
    this.tracked.set(table, keys);
  }

  /** Inserts one row with positional parameters; the key column is tracked. */
  insert(table: string, row: Row, key = 'id') {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const keyValue = row[key];
    if (typeof keyValue === 'string') this.track(table, keyValue);
    return this.sql.unsafe(
      `insert into ${table} (${columns.join(', ')}) values (${placeholders.join(', ')})`,
      Object.values(row),
    );
  }

  /** Same statement as `insert`; resolves to whether PostgreSQL refused it. */
  rejects(table: string, row: Row, key = 'id') {
    return rejected(() => this.insert(table, row, key));
  }

  async count(table: string, column: string, value: string): Promise<number> {
    const [row] = (await this.sql.unsafe(
      `select count(*)::int as c from ${table} where ${column} = $1`,
      [value],
    )) as Array<{ c: number }>;
    return row?.c ?? 0;
  }

  async user() {
    const id = createId();
    await this.insert('users', { id, username: `u-${id}` });
    return id;
  }

  async actor(userId?: string) {
    const id = createId();
    await this.insert('actors', {
      id,
      kind: 'human',
      user_id: userId ?? (await this.user()),
    });
    return id;
  }

  async format() {
    const id = `fmt-${createId()}`;
    await this.insert('formats', {
      id,
      name: 'Fixture format',
      rules: validRules,
      ranked_eligible: false,
    });
    return id;
  }

  /** A waiting debate; `overrides` set or null out lifecycle columns. */
  async debate(overrides: Row = {}) {
    const id = createId();
    await this.insert('debates', {
      id,
      created_by: null,
      resolution: 'r',
      format: await this.format(),
      snapshot: '{}',
      mode: 'casual',
      phase: 'waiting',
      visibility: 'public',
      ...overrides,
    });
    return id;
  }

  async participant(
    debateId: string,
    role: string,
    slot = 0,
    actorId?: string,
  ) {
    const id = createId();
    await this.insert('debate_participants', {
      id,
      debate_id: debateId,
      actor_id: actorId ?? (await this.actor()),
      role,
      slot,
      status: 'joined',
      joined_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    return id;
  }

  async purge() {
    for (const [table, key] of purgeOrder) {
      const keys = this.tracked.get(table);
      if (!keys || keys.length === 0) continue;
      // Positional placeholders: `unsafe` flattens an array argument to CSV.
      await this.sql.unsafe(
        `delete from ${table} where ${key} in (${keys.map((_, index) => `$${index + 1}`).join(', ')})`,
        keys,
      );
    }
  }
}

export const withFixture = async (
  url: string,
  body: (fixture: Fixture) => Promise<void>,
) => {
  const { SQL } = await import('bun');
  const sql = new SQL(url);
  const fixture = new Fixture(sql);
  try {
    await body(fixture);
  } finally {
    try {
      await fixture.purge();
    } finally {
      await sql.close();
    }
  }
};

export const at = new Date('2026-01-01T00:00:00.000Z');
/** A well-formed SHA3-256 hex digest. */
export const digest = 'a'.repeat(64);

export const indexDefinition = async (fixture: Fixture, name: string) => {
  const [row] = (await fixture.sql.unsafe(
    'select indexdef from pg_indexes where indexname = $1',
    [name],
  )) as Array<{ indexdef: string }>;
  return row?.indexdef ?? null;
};

export const columnNames = async (fixture: Fixture, table: string) =>
  (
    (await fixture.sql.unsafe(
      'select column_name from information_schema.columns where table_name = $1 order by column_name',
      [table],
    )) as Array<{ column_name: string }>
  ).map((row) => row.column_name);
