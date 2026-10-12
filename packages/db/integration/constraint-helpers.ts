import { SQL } from 'bun';
import {
  foundationDefinition,
  validConfig,
  validRules,
} from './round-fixtures';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src';
import { createTestOnlyOperations } from '../src/test-only-operations';
import { buildDebateTopic } from '@daisy/protocol';

type PostgresFailure = { errno?: unknown; constraint?: unknown };

/**
 * The constraint PostgreSQL named when refusing the statement (SQLSTATE class
 * 23, integrity constraint violation), or null when it was accepted. Any
 * other error is a broken test, not a rejection, and is rethrown.
 */
export const rejectedBy = async (
  attempt: () => Promise<unknown>,
): Promise<string | null> => {
  try {
    await attempt();
    return null;
  } catch (error) {
    const { errno, constraint } = error as PostgresFailure;
    if (typeof errno === 'string' && errno.startsWith('23'))
      return typeof constraint === 'string' ? constraint : errno;
    throw error;
  }
};

/**
 * The SQLSTATE PostgreSQL refused the statement with, or 'accepted': for
 * refusals that are not integrity violations (privileges, for one).
 */
export const sqlStateOf = async (attempt: () => Promise<unknown>) => {
  try {
    await attempt();
    return 'accepted';
  } catch (error) {
    const { errno } = error as PostgresFailure;
    if (typeof errno === 'string') return errno;
    throw error;
  }
};

/** True when an integrity constraint refused the statement. */
export const rejected = async (attempt: () => Promise<unknown>) =>
  (await rejectedBy(attempt)) !== null;

type Row = Readonly<Record<string, unknown>>;

/** Cleanup order: children before parents; RESTRICT edges never fire. */
const purgeOrder: ReadonlyArray<readonly [table: string, key: string]> = [
  ['ballots', 'id'],
  ['rating_changes', 'id'],
  ['ratings', 'actor_id'],
  // Agent runs and utterances hang off the seats and the live segments.
  ['agent_runs', 'id'],
  ['utterances', 'id'],
  ['round_commands', 'command_id'],
  ['round_segments', 'id'],
  ['round_participants', 'id'],
  ['usage_reservations', 'id'],
  ['round_document_refs', 'round_id'],
  ['rounds', 'id'],
  ['room_participants', 'id'],
  ['rooms', 'id'],
  ['documents', 'id'],
  ['seasons', 'id'],
  ['role_grants', 'id'],
  ['actors', 'id'],
  ['users', 'id'],
  // `formats.current_version` and `format_presets.format_version` both point
  // into `format_revisions`, so the pointer rows go first.
  ['formats', 'id'],
  ['format_presets', 'format_id'],
  ['format_revisions', 'format_id'],
];

// jsonb parameters are objects: Bun SQL JSON-encodes a string a second time.

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

  /** Same statement as `insert`; resolves to whether a constraint refused it. */
  rejects(table: string, row: Row, key = 'id') {
    return rejected(() => this.insert(table, row, key));
  }

  /** Same statement as `insert`; resolves to the refusing constraint or null. */
  rejectedBy(table: string, row: Row, key = 'id') {
    return rejectedBy(() => this.insert(table, row, key));
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

  /**
   * A format plus its first definition revision. The revision is inserted
   * first: `formats_current_revision_fk` is DEFERRABLE, but each statement
   * here autocommits, so the target row has to exist before the pointer.
   */
  async format() {
    const id = `fmt-${createId()}`;
    await this.insert(
      'format_revisions',
      { format_id: id, version: 1, definition: foundationDefinition },
      'format_id',
    );
    await this.insert('formats', {
      id,
      name: 'Fixture format',
      current_version: 1,
    });
    return id;
  }

  /**
   * A sanctioned ranked preset for a format. A ranked round is constructed
   * from one (ADR 0058 §4), so the `rounds_preset_provenance_fk` and the
   * ranked-preset equivalence both need this row to exist.
   */
  async preset(
    formatId: string,
    length: 'full' | 'quick' = 'full',
    version = 1,
  ) {
    // Idempotent: several rounds may resolve from the one sanctioned preset
    // for a format, and `format_presets_pkey` is (format_id, length, version).
    // The config binds as an object: Bun SQL JSON-encodes a string twice.
    await this.sql.unsafe(
      `insert into format_presets (format_id, length, version, format_version, config, approved_at)
       values ($1, $2, $3, 1, $4::jsonb, statement_timestamp())
       on conflict (format_id, length, version) do nothing`,
      [formatId, length, version, validConfig],
    );
    this.track('format_presets', formatId);
    return version;
  }

  /**
   * A scheduled round carrying resolved rules; `overrides` set or null out
   * the lifecycle, ladder and provenance columns the CHECKs tie together.
   */
  async round(overrides: Row = {}) {
    const id = createId();
    await this.insert('rounds', {
      id,
      room_id: null,
      created_by_actor_id: null,
      resolution: 'A resolution',
      competition_type: 'casual',
      length: 'full',
      format_id: await this.format(),
      format_version: 1,
      preset_version: null,
      rules_snapshot: validRules,
      status: 'scheduled',
      current_stage: null,
      outcome: null,
      ladder_id: null,
      started_at: null,
      completed_at: null,
      ...overrides,
    });
    return id;
  }

  /**
   * Seats an actor (a new one by default) in one round, returning the actor id.
   * Use `seat` when the caller needs the participant row's own surrogate id
   * (ADR 0058 §2) — a ballot names its judge seat, not the judge actor.
   */
  async participant(roundId: string, role: string, slot = 0, actorId?: string) {
    return (await this.seat(roundId, role, slot, actorId)).actorId;
  }

  /** The authoritative participant row, with its surrogate seat id. */
  async seat(roundId: string, role: string, slot = 0, actorId?: string) {
    const seated = actorId ?? (await this.actor());
    const id = createId();
    await this.insert('round_participants', {
      id,
      round_id: roundId,
      actor_id: seated,
      role,
      slot,
    });
    return { id, actorId: seated };
  }

  async purge() {
    // A round may append canonical phase events through an accepted write.
    // Remove only this fixture's topics before deleting their owning rows.
    for (const roundId of this.tracked.get('rounds') ?? [])
      await this
        .sql`delete from outbox where topic=${buildDebateTopic(roundId)}`;
    // Documents are created through the adapter, never inserted here, and
    // they RESTRICT their owner. Clearing them by owner means every document
    // a fixture's actors own goes with the fixture, however it was written.
    await this.deleteWhere(
      'documents',
      'owner_actor_id',
      this.tracked.get('actors'),
    );
    for (const [table, key] of purgeOrder) {
      await this.deleteWhere(table, key, this.tracked.get(table));
    }
  }

  private async deleteWhere(
    table: string,
    column: string,
    keys: string[] | undefined,
  ) {
    if (!keys || keys.length === 0) return;
    // Positional placeholders: `unsafe` flattens an array argument to CSV.
    await this.sql.unsafe(
      `delete from ${table} where ${column} in (${keys.map((_, index) => `$${index + 1}`).join(', ')})`,
      keys,
    );
  }
}

export const withFixture = async (
  url: string,
  body: (fixture: Fixture) => Promise<void>,
) => {
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

/**
 * What a durable round test writes through the adapter: a tracked round id, an
 * author actor and a format, a database over the fixture's server and the
 * test-only operations on the fixture's connection. The caller closes
 * `database`; the fixture purges the rows.
 */
export const roundAuthoring = async (fixture: Fixture, url: string) => {
  const formatId = await fixture.format();
  const roundId = createId();
  // Tracked before the row exists: the caller creates the round through the
  // adapter, so this is the only record the purge gets. Deleting the round
  // cascades to its participants, segments, commands and refs.
  fixture.track('rounds', roundId);
  return {
    roundId,
    actorId: await fixture.actor(),
    formatId,
    rules: validRules,
    database: createDatabase({ url, nextActorId: createId }),
    testOnly: createTestOnlyOperations({ client: fixture.sql }),
  };
};

/** Create the scheduled durable round shared by execution and phase tests. */
export const createScheduledRound = async (
  authoring: Awaited<ReturnType<typeof roundAuthoring>>,
  resolution: string,
): Promise<void> => {
  await authoring.database.createRound({
    id: authoring.roundId,
    createdByActorId: null,
    resolution,
    competitionType: 'casual',
    length: 'full',
    formatId: authoring.formatId,
    formatVersion: 1,
    presetVersion: null,
    rules: authoring.rules,
  });
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
