/**
 * Which tables are fenced by row-level security, and how. A tenant-owned
 * row carries one of the two isolation keys, `organization_id` or
 * `lobby_id`, and its table's policies let the runtime role reach it only
 * while that key is the transaction's scope (`withScope`). The policies in
 * the migrations are exactly the ones this manifest describes;
 * `tenantIsolationProblems` compares the two.
 */

/** Which isolation key a table's rows carry. */
export type TenantKey =
  /** `organization_id`, on every row. */
  | 'organization'
  /** `lobby_id`, on every row. */
  | 'lobby'
  /** Exactly one of the two, by the `<table>_one_tenant_key` CHECK. */
  | 'either'
  /** Both, on every row: a league's row about a lobby's event. */
  | 'both'
  /** Neither: the row belongs to the people it names. */
  | 'person';

/** The person a row is about, who may read it under the subject scope. */
export type TenantSubject =
  /** `user_id` is the person. */
  | 'user'
  /** `actor_id` is the person's actor. */
  | 'actor'
  /** `guardian_user_id` and `minor_user_id` are the two people. */
  | 'guardian';

export type TenantTable = {
  readonly table: string;
  readonly key: TenantKey;
  /** The key column when it is not the conventional one: the row's own id. */
  readonly keyColumn?: 'id';
  /** Adds a read of the person's own rows across tenants. */
  readonly subject?: TenantSubject;
  /** Any tenant may read the rows; writing still needs the key in scope. */
  readonly openRead?: true;
};

export type TenantExemption = {
  readonly table: string;
  readonly reason: string;
};

export type TenantIsolationManifest = {
  readonly tables: readonly TenantTable[];
  readonly exempt: readonly TenantExemption[];
};

const organization = (
  table: string,
  rest: Omit<TenantTable, 'table' | 'key'> = {},
): TenantTable => ({ table, key: 'organization', ...rest });
const lobby = (
  table: string,
  rest: Omit<TenantTable, 'table' | 'key'> = {},
): TenantTable => ({ table, key: 'lobby', ...rest });
const either = (
  table: string,
  rest: Omit<TenantTable, 'table' | 'key'> = {},
): TenantTable => ({ table, key: 'either', ...rest });

/**
 * Identity rows (organizations, lobbies, tournaments, ladders) are listed
 * across tenants. Definitions (templates, settings, ballot definitions) are
 * read across tenants by design: one event's settings chain runs through
 * the organization that owns its template, the league that owns its
 * tournament, the lobby and the event, and a followed template pins another
 * organization's ballot definition. None of these rows is private; what
 * they configure is.
 */
export const tenantIsolationManifest: TenantIsolationManifest = {
  tables: [
    organization('organizations', { keyColumn: 'id', openRead: true }),
    organization('memberships', { subject: 'user' }),
    organization('roles'),
    organization('role_permissions'),
    either('grants', { subject: 'user' }),
    { table: 'guardian_links', key: 'person', subject: 'guardian' },
    { table: 'restrictions', key: 'person', subject: 'guardian' },
    { table: 'restriction_lobbies', key: 'person', subject: 'guardian' },
    either('action_history'),
    lobby('lobbies', { keyColumn: 'id', openRead: true }),
    organization('templates', { openRead: true }),
    lobby('lobby_templates'),
    either('settings', { openRead: true }),
    organization('ladders', { openRead: true }),
    lobby('tournaments', { openRead: true }),
    lobby('events'),
    lobby('stages'),
    lobby('time_slots'),
    lobby('tab_rounds'),
    lobby('entries'),
    lobby('entry_members', { subject: 'actor' }),
    lobby('tournament_judges', { subject: 'actor' }),
    lobby('judge_availability'),
    lobby('judge_events'),
    lobby('judge_strikes'),
    either('resolution_pools'),
    either('pool_resolutions'),
    lobby('draws'),
    lobby('draw_result_inputs'),
    lobby('draw_fixtures'),
    lobby('fixtures'),
    lobby('fixture_entries'),
    lobby('fixture_judges'),
    lobby('conflicts'),
    lobby('pending_commands'),
    either('ballot_definitions', { openRead: true }),
    either('ballot_definition_versions', { openRead: true }),
    lobby('results'),
    lobby('result_entries'),
    lobby('result_speakers'),
    lobby('certifications'),
    lobby('certification_results'),
    lobby('releases'),
    lobby('ballot_screenings'),
    { table: 'sanctions', key: 'both' },
    organization('season_standing_rules'),
  ],
  exempt: [
    {
      table: 'rooms',
      reason:
        'The Room aggregate is read by the Room evaluator path, which filters by lobby in the query; a Room listing is not fenced by a policy.',
    },
    {
      table: 'ballots',
      reason:
        "A ballot belongs to its Round and is protected by the Round evaluator; it only pins a ballot definition's version.",
    },
    {
      table: 'seasons',
      reason:
        "Daisy's rating seasons are public reference rows read by the ladder; a league's season is read with its standings.",
    },
    {
      table: 'ratings',
      reason: 'The public rating projection; it references a ladder only.',
    },
    {
      table: 'rating_changes',
      reason: 'The public rating ledger; it references a ladder only.',
    },
    {
      table: 'formats',
      reason:
        'Format identity is public catalogue data; the organization is ownership only.',
    },
    {
      table: 'agreement_signatures',
      reason:
        'Evidence of what one member agreed to, keyed and read by that member; the lobby is its scope, not its owner.',
    },
  ],
};
