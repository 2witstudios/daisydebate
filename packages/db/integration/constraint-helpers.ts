import { causeChainMember } from '../src/capacity-refusal';
import { SQL } from 'bun';
import {
  foundationDefinition,
  validConfig,
  validRules,
} from './round-fixtures';
import { createId } from '@paralleldrive/cuid2';
import { pinRankedFixturePool } from '../src/testing-rating-pool';
import { createDatabase } from '../src';
import { daisyOrganizationId, publicLobbyId } from '../src/daisy-reference';
import { createTestOnlyOperations } from '../src/test-only-operations';
import {
  admitParticipants,
  removeUnowedBetaDigests,
} from '../src/beta-access-testing';
import {
  buildRoundTopic,
  buildUserInboxTopic,
  emptyRuntimeCheckpointFor,
} from '@daisy/protocol';
import { frozenJudgingFor } from '../src/round-judging-freeze';

type PostgresFailure = { errno?: unknown; constraint?: unknown };

/**
 * A fixture seat's columns: a seat kind other than a side's, or else the
 * side a side's seat belongs to.
 */
export const seatColumnsOf = (seat: string): Row =>
  seat === 'judge' || seat === 'speaker' || seat === 'moderator'
    ? { seat_kind: seat, side: null }
    : { seat_kind: 'side', side: seat };

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
    const failure = causeChainMember((candidate) => {
      const { errno } = candidate as PostgresFailure;
      return typeof errno === 'string' && errno.startsWith('23');
    }, error);
    if (!failure) throw error;
    const { errno, constraint } = failure as PostgresFailure;
    return typeof constraint === 'string' ? constraint : String(errno);
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
  ['rating_changes', 'id'],
  ['ratings', 'actor_id'],
  // Immutable competitive children erase only with their actual owning Round.
  ['rounds', 'id'],
  ['ballots', 'id'],
  // Agent runs and utterances hang off the seats and the live segments.
  ['agent_runs', 'id'],
  ['utterances', 'id'],
  ['round_commands', 'command_id'],
  ['round_segments', 'id'],
  ['round_participants', 'id'],
  ['usage_reservations', 'id'],
  ['room_participants', 'id'],
  ['challenges', 'id'],
  ['rooms', 'id'],
  ['documents', 'id'],
  ['tournaments', 'lobby_id'],
  ['seasons', 'id'],
  ['lobbies', 'id'],
  ['organizations', 'id'],
  ['actors', 'id'],
  ['guardian_links', 'id'],
  ['users', 'id'],
  // `formats.current_version` and `format_presets.format_version` both point
  // into `format_revisions`, so the pointer rows go first.
  ['formats', 'id'],
  ['format_presets', 'format_id'],
  ['format_revisions', 'format_id'],
];

// jsonb parameters are objects: Bun SQL JSON-encodes a string a second time.

const daisyKeys: Record<string, Row> = {
  rooms: { lobby_id: publicLobbyId },
  seasons: { organization_id: daisyOrganizationId },
};
/** A fixture Room is in the Open lobby unless it says otherwise (ADR 0156). */
const lobbyDivision: Row = { division: 'open' };

/**
 * Per-test fixture over one connection. Every inserted key is tracked and
 * deleted in `finally`, so a failing assertion leaves no rows behind.
 */
export class Fixture {
  private daisyKeyed: Promise<Set<string>> | undefined;
  constructor(
    readonly sql: SQL,
    readonly tracked = new Map<string, string[]>(),
  ) {}

  /**
   * A fixture Room or season that names no owner is Daisy's, as Daisy's own
   * writers name it; the columns have no default. Suites that migrate only
   * part of the history run before the key exists, so it is read once.
   */
  private async daisyKey(table: string): Promise<Row> {
    const key = daisyKeys[table];
    if (!key) return {};
    this.daisyKeyed ??= (
      this.sql.unsafe(
        `select table_name || '.' || column_name as found from information_schema.columns
         where table_schema = 'public'
           and (table_name, column_name) in (('rooms', 'lobby_id'), ('seasons', 'organization_id'), ('rooms', 'division'), ('seasons', 'lobby_id'))`,
      ) as Promise<Array<{ found: string }>>
    ).then((found) => new Set(found.map((row) => row.found)));
    const present = await this.daisyKeyed;
    const owner = present.has(`${table}.${Object.keys(key)[0]}`) ? key : {};
    return table === 'rooms' && present.has('rooms.division')
      ? { ...owner, ...lobbyDivision }
      : owner;
  }

  private async ratingScope(table: string, row: Row): Promise<Row> {
    if (
      ![
        'seasons',
        'rounds',
        'ratings',
        'rating_changes',
        'organizations',
      ].includes(table)
    )
      return row;
    const [current] = await this.sql`select 1 from information_schema.columns
      where table_schema='public' and table_name='seasons' and column_name='lobby_id'`;
    if (!current) return row;
    const { division, ladder_division, ...value } = row;
    if (table === 'organizations')
      return Object.fromEntries(
        Object.entries(value).filter(
          ([column]) => column !== 'league_division',
        ),
      );
    if (table === 'seasons' && value.lobby_id === undefined) {
      const [found] = await this
        .sql`select id from lobbies where kind='standing'
        and owner_organization_id=${value.organization_id}
        and (${division === undefined && value.organization_id !== daisyOrganizationId} or
          age_rule=${division === 'youth' ? 'under-18' : 'adults'}::lobby_age_rule)
        order by created_at,id limit 1`;
      if (found) return { ...value, lobby_id: found.id };
      const [league] = await this
        .sql`select id,name from organizations where id=${value.organization_id} and kind='league'`;
      if (!league) return value;
      const lobbyId = createId();
      await this.insert('lobbies', {
        id: lobbyId,
        kind: 'standing',
        handle: lobbyId,
        name: String(league.name),
        owner_organization_id: league.id,
      });
      return { ...value, lobby_id: lobbyId };
    }
    if (table === 'ratings' || table === 'rating_changes') {
      if (value.lobby_id !== undefined) return value;
      const [season] = await this
        .sql`select lobby_id from seasons where id=${value.season_id}`;
      if (!season) return value;
      if (value.ladder === 'freestyle' && division === 'youth') {
        const [ladder] = await this
          .sql`select id from ladders where lobby_id=${season.lobby_id} order by created_at,id limit 1`;
        return {
          ...value,
          lobby_id: season.lobby_id,
          ladder: ladder?.id ?? value.ladder,
        };
      }
      return { ...value, lobby_id: season.lobby_id };
    }
    if (
      table === 'rounds' &&
      value.ladder_id &&
      value.season_id === undefined &&
      ladder_division
    ) {
      const [pool] = await this
        .sql`select l.id as lobby_id, l.owner_organization_id,
          d.id as ladder_id, (select s.id from seasons s where s.lobby_id=l.id
            order by (s.status='active') desc, s.starts_at desc, s.id limit 1) as season_id
        from lobbies l join ladders d on d.lobby_id=l.id where l.kind='standing'
          and l.owner_organization_id=${daisyOrganizationId}
          and l.age_rule=${ladder_division === 'youth' ? 'under-18' : 'adults'}::lobby_age_rule
        order by l.created_at,l.id,d.created_at,d.id limit 1`;
      if (!pool) return value;
      const seasonId = pool.season_id ?? createId();
      if (!pool.season_id)
        await this.insert('seasons', {
          id: seasonId,
          organization_id: pool.owner_organization_id,
          lobby_id: pool.lobby_id,
          name: 'Historical fixture',
          starts_at: at,
          status: 'closed',
        });
      return {
        ...value,
        rating_lobby_id: pool.lobby_id,
        season_id: seasonId,
        ladder_id: pool.ladder_id,
        standing_age_rule: ladder_division === 'youth' ? 'under-18' : 'adults',
      };
    }
    return value;
  }

  track(table: string, key: string) {
    const keys = this.tracked.get(table) ?? [];
    keys.push(key);
    this.tracked.set(table, keys);
  }

  async pinRanked(roundId: string) {
    const archive = await pinRankedFixturePool(this.sql, roundId);
    if (archive) this.track('seasons', archive);
  }

  /** Inserts one row with positional parameters; the key column is tracked. */
  async insert(table: string, given: Row, key = 'id') {
    const row = await this.ratingScope(table, {
      ...(await this.daisyKey(table)),
      ...given,
    });
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
  async format(definition = foundationDefinition) {
    const id = `fmt-${createId()}`;
    await this.insert(
      'format_revisions',
      { format_id: id, version: 1, definition },
      'format_id',
    );
    await this.insert('formats', {
      id,
      name: 'Fixture format',
      current_version: 1,
    });
    return id;
  }

  /** A tracked assembling Room, with the same resolved foundation as Round fixtures. */
  async room(hostActorId: string, formatId: string, overrides: Row = {}) {
    const id = createId();
    await this.insert('rooms', {
      id,
      host_actor_id: hostActorId,
      title: 'Fixture Room',
      topic: 'Fixture topic',
      visibility: 'public',
      format_id: formatId,
      format_version: 1,
      competition_type: 'casual',
      config: validConfig,
      execution_plan: {},
      rules_snapshot: validRules,
      status: 'assembling',
      ...overrides,
    });
    return typeof overrides.id === 'string' ? overrides.id : id;
  }

  /**
   * A sanctioned ranked preset for a format. A ranked round is constructed
   * from one (ADR 0058 §4), so the `rounds_preset_provenance_fk` and the
   * ranked-preset equivalence both need this row to exist.
   */
  async preset(formatId: string, version = 1) {
    // Idempotent: several rounds may resolve from the one sanctioned preset
    // for a format, and `format_presets_pkey` is (format_id, version).
    // The config binds as an object: Bun SQL JSON-encodes a string twice.
    await this.sql.unsafe(
      `insert into format_presets (format_id, version, format_version, config, approved_at)
       values ($1, $2, 1, $3::jsonb, statement_timestamp())
       on conflict (format_id, version) do nothing`,
      [formatId, version, validConfig],
    );
    this.track('format_presets', formatId);
    return version;
  }

  /** Which of `names` the table has now: a proof migrates the same database on. */
  private async present(table: string, names: readonly string[]) {
    const found = (await this
      .sql`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${table}
        and column_name in ${this.sql([...names])}`) as {
      column_name: string;
    }[];
    return new Set(found.map((row) => row.column_name));
  }

  /**
   * Whether this database seats by kind and side (TAB-6): a predecessor
   * migration proof runs before the columns exist and still says role and
   * outcome.
   */
  private async seatsByKind() {
    return (await this.present('round_participants', ['seat_kind'])).has(
      'seat_kind',
    );
  }

  /**
   * The column a Round's winning side is stored in: `outcome` on a
   * predecessor a migration proof seeds (TAB-6 backfills from it), else
   * `winning_side`.
   */
  async winningSideColumn() {
    return (await this.present('rounds', ['outcome'])).has('outcome')
      ? 'outcome'
      : 'winning_side';
  }

  /** Whether this database still defaults a Round's checkpoint (before TAB-6). */
  private async checkpointHasDefault() {
    const [column] = (await this
      .sql`select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'rounds' and column_name = 'runtime_state'`) as {
      column_default: string | null;
    }[];
    return column?.column_default != null;
  }

  /** A seat's columns as this database stores them: by role, by kind and side, or both while a proof lends the new ones. */
  private async seatColumnsFor(seat: string): Promise<Row> {
    const columns = await this.present('round_participants', [
      'role',
      'seat_kind',
    ]);
    return {
      ...(columns.has('role') ? { role: seat } : {}),
      ...(columns.has('seat_kind') ? seatColumnsOf(seat) : {}),
    };
  }

  /** The not-yet-started status of this database: a predecessor still says scheduled. */
  private async unstartedStatus() {
    const [column] = await this.sql`select 1 from information_schema.columns
      where table_name = 'rounds' and column_name = 'pre_round_prep_ms'`;
    return column ? 'opening' : 'scheduled';
  }

  /**
   * An unstarted round carrying resolved rules; `overrides` set or null out
   * the lifecycle, ladder and provenance columns the CHECKs tie together.
   */
  async round(overrides: Row = {}, { rules = validRules } = {}) {
    const id = createId();
    const columns = await this.present('rounds', [
      'outcome',
      'winning_side',
      'judging',
    ]);
    await this.insert('rounds', {
      id,
      room_id: null,
      created_by_actor_id: null,
      resolution: 'A resolution',
      competition_type: 'casual',
      format_id:
        typeof overrides.format_id === 'string'
          ? overrides.format_id
          : await this.format(),
      format_version: 1,
      preset_version: null,
      rules_snapshot: rules,
      status: await this.unstartedStatus(),
      current_stage: null,
      // TAB-6 dropped the column's two-sided default; a predecessor keeps its own.
      ...((await this.checkpointHasDefault())
        ? {}
        : { runtime_state: emptyRuntimeCheckpointFor(rules) }),
      // A proof may lend the TAB-6 columns to a predecessor beside its own.
      ...(columns.has('outcome') ? { outcome: null } : {}),
      ...(columns.has('winning_side')
        ? { winning_side: null, ranking: null }
        : {}),
      ...(columns.has('judging') ? { judging: frozenJudgingFor(rules) } : {}),
      ladder_id: null,
      started_at: null,
      completed_at: null,
      ...overrides,
    });
    return id;
  }

  /** Construct a fixture's complete initial cast before it starts or completes. */
  async roundWithCast(
    overrides: Row,
    cast: readonly {
      readonly seat: string;
      readonly actorId?: string;
      readonly slot?: number;
    }[],
    options: { readonly rules?: typeof validRules } = {},
  ) {
    return this.sql.begin(async (tx) => {
      const fixture = new Fixture(tx as SQL, this.tracked);
      const lifecycle = new Set([
        'status',
        'current_stage',
        'started_at',
        'completed_at',
        'winning_side',
        'ranking',
        'outcome',
      ]);
      const initial = Object.fromEntries(
        Object.entries(overrides).filter(([key]) => !lifecycle.has(key)),
      );
      const id = await fixture.round(initial, options);
      const seats = [];
      for (const person of cast)
        seats.push(
          await fixture.seat(id, person.seat, person.slot ?? 0, person.actorId),
        );
      const changes = Object.entries(overrides).filter(([key]) =>
        lifecycle.has(key),
      );
      if (changes.length)
        await tx.unsafe(
          `update rounds set ${changes.map(([key], index) => `${key}=$${index + 2}`).join(',')} where id=$1`,
          [id, ...changes.map(([, value]) => value)],
        );
      return { id, seats };
    });
  }

  /**
   * Seats an actor (a new one by default) in one round, returning the actor id.
   * Use `seat` when the caller needs the participant row's own surrogate id
   * (ADR 0058 §2) — a ballot names its judge seat, not the judge actor.
   */
  async participant(roundId: string, role: string, slot = 0, actorId?: string) {
    return (await this.seat(roundId, role, slot, actorId)).actorId;
  }

  private async seatedHuman(userId?: string) {
    // A seated fresh human is an admitted participant (ADR 0075).
    await admitParticipants(this.sql, [(userId ??= await this.user())]);
    return this.actor(userId);
  }
  /**
   * The authoritative participant row, with its surrogate seat id. `seat`
   * names a seat kind other than a side's ('judge', 'speaker', 'moderator')
   * or else the side a side's seat belongs to.
   */
  async seat(roundId: string, seat: string, slot = 0, actorId?: string) {
    const seated = actorId ?? (await this.seatedHuman());
    const id = createId();
    await this.insert('round_participants', {
      id,
      round_id: roundId,
      actor_id: seated,
      ...(await this.seatColumnsFor(seat)),
      slot,
    });
    return { id, actorId: seated };
  }

  /** Commits a transcript freeze a ballot or judging job can name; erased with its Round. */
  /** A Round freezes only after its final speech ended, so it holds that end and its cutoffs. */
  async freeze(roundId: string, revision = 1) {
    await this.sql.unsafe(
      `update rounds set final_segment_ended_at=ended.at,
        transcript_admission_cutoff=ended.at+interval '120 seconds',
        attendance_resolution_cutoff_at=ended.at+interval '60 minutes'
        from (select date_trunc('milliseconds',clock_timestamp())-interval '1 minute' as at) ended
        where id=$1 and final_segment_ended_at is null`,
      [roundId],
    );
    await this.sql.unsafe(
      // The frontier is the durable counter, as the ISSUE-505 guard requires.
      "insert into round_transcript_freezes(round_id,revision,frontier,completeness) values($1,$2,coalesce((select revision from round_transcripts where round_id=$1),0),'incomplete')",
      [roundId, revision],
    );
    return revision;
  }

  async purge() {
    // Erasure routing intentionally survives account deletion. Remove only this fixture's requests.
    const [evidencePrivacy] = await this
      .sql`select to_regclass('public.necessary_evidence_erasure_requests') is not null as present`;
    if (evidencePrivacy?.present)
      await this.deleteWhere(
        'necessary_evidence_erasure_requests',
        'actor_id',
        this.tracked.get('actors'),
      );
    // A round may append canonical phase events through an accepted write.
    // Remove only this fixture's topics before deleting their owning rows.
    for (const roundId of this.tracked.get('rounds') ?? [])
      await this
        .sql`delete from outbox where topic=${buildRoundTopic(roundId)}`;
    // A beta revocation or session end pushes a control row to the actor's
    // inbox topic (ADR 0075); it goes with the fixture's actors too.
    for (const actorId of this.tracked.get('actors') ?? [])
      await this
        .sql`delete from outbox where topic=${buildUserInboxTopic(actorId)}`;
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
    // Claims made here owe their window an owner digest (ADR 0075).
    await removeUnowedBetaDigests(this.sql);
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
  const actorId = await fixture.actor();
  await fixture.sql`update users set email_verified=true where id=(select user_id from actors where id=${actorId})`;
  // Tracked before the row exists: the caller creates the round through the
  // adapter, so this is the only record the purge gets. Deleting the round
  // cascades to its participants, segments, commands and refs.
  fixture.track('rounds', roundId);
  return {
    roundId,
    actorId,
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
    createdByActorId: authoring.actorId,
    resolution,
    competitionType: 'casual',
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

/** A database over its own pool for one test, always closed afterwards. */
export const withDatabase = async <T>(
  url: string,
  run: (database: ReturnType<typeof createDatabase>) => Promise<T>,
): Promise<T> => {
  const database = createDatabase({ url, nextActorId: createId });
  try {
    return await run(database);
  } finally {
    await database.close();
  }
};
