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
  | 'person'
  /** Exactly one organization, lobby or protected-person action-history scope. */
  | 'history';

/** The person a row is about, who may read it under the subject scope. */
export type TenantSubject =
  /** `user_id` is the person. */
  | 'user'
  /** `actor_id` is the person's actor. */
  | 'actor'
  /** `guardian_user_id` and `minor_user_id` are the two people. */
  | 'guardian'
  | 'friend-approval'
  | 'lobby-permission'
  | 'lobby-waiver'
  | 'consent-signer'
  | 'child-account-request'
  /** The funding account or the person who acted on its named consent. */
  | 'tournament-sponsorship'
  /** The funding account or acting official in immutable capture provenance. */
  | 'tournament-capture';

export type TenantTable = {
  readonly table: string;
  readonly key: TenantKey;
  /** The key column when it is not the conventional one: the row's own id. */
  readonly keyColumn?: 'id';
  /** Adds a read of the person's own rows across tenants. */
  readonly subject?: TenantSubject;
  /**
   * The subject also writes its own rows (a `person` table only): the
   * subject policy covers every command, with the same predicate as its
   * check, so a person writes rows about themselves and nobody else's.
   */
  readonly subjectWrites?: true;
  /** Any tenant may read the rows; writing still needs the key in scope. */
  readonly openRead?: true;
  /**
   * A second organization the row is about reads it under its own scope;
   * writing still needs the key in scope.
   */
  readonly counterpart?: 'school_id';
};

type TenantExemption = {
  readonly table: string;
  readonly reason: string;
};

/**
 * A registered `SECURITY DEFINER` function that reads tenant-owned tables
 * past their policies (ADR 0129 §4, ADR 0158): the one way a read crosses
 * tenants outside the policy shapes. It names who may run it and why its
 * output discloses no more than its callers may know.
 */
export type TenantDefiner = {
  readonly name: string;
  /** The roles besides its owner that may execute it; never `PUBLIC`. */
  readonly executors: readonly string[];
  readonly reason: string;
};

export type TenantIsolationManifest = {
  readonly tables: readonly TenantTable[];
  readonly exempt: readonly TenantExemption[];
  readonly definers: readonly TenantDefiner[];
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
 * across tenants. Roles and their permissions are read across tenants too:
 * the preset roles are Daisy's rows and are given in every organization and
 * lobby, so the evaluator reads them without Daisy's scope, which is also
 * Daisy's write key. Definitions (templates, settings, ballot definitions) are
 * read across tenants by design: one event's settings chain runs through
 * the organization that owns its template, the league that owns its
 * tournament, the lobby and the event, and a followed template pins another
 * organization's ballot definition. None of these rows is private; what
 * they configure is.
 */
export const tenantIsolationManifest: TenantIsolationManifest = {
  tables: [
    organization('organizations', { keyColumn: 'id', openRead: true }),
    organization('league_schools', { counterpart: 'school_id' }),
    organization('memberships', { subject: 'user' }),
    organization('membership_periods', { subject: 'user' }),
    organization('roles', { openRead: true }),
    organization('role_permissions', { openRead: true }),
    either('grants', { subject: 'user' }),
    {
      table: 'guardian_links',
      key: 'person',
      subject: 'guardian',
      subjectWrites: true,
    },
    {
      table: 'guardian_consent_evidence',
      key: 'person',
      subject: 'consent-signer',
      subjectWrites: true,
    },
    {
      table: 'child_account_requests',
      key: 'person',
      subject: 'child-account-request',
      subjectWrites: true,
    },
    {
      table: 'protection_levels',
      key: 'person',
      subject: 'user',
    },
    {
      table: 'friend_guardian_approvals',
      key: 'person',
      subject: 'friend-approval',
    },
    {
      table: 'restriction_lobbies',
      key: 'person',
      subject: 'lobby-permission',
    },
    {
      table: 'restriction_lobby_waivers',
      key: 'person',
      subject: 'lobby-waiver',
    },
    { table: 'action_history', key: 'history' },
    lobby('lobbies', { keyColumn: 'id', openRead: true }),
    organization('templates', { openRead: true }),
    lobby('lobby_templates'),
    either('settings', { openRead: true }),
    organization('ladders', { openRead: true }),
    lobby('ratings', { subject: 'actor' }),
    lobby('rating_changes', { subject: 'actor' }),
    lobby('tournaments', { openRead: true }),
    lobby('tournament_rating_snapshots'),
    lobby('tournament_sponsorship_versions', {
      subject: 'tournament-sponsorship',
    }),
    lobby('tournament_capture_admissions', { subject: 'tournament-capture' }),
    lobby('tournament_hosting_purchases'),
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
    lobby('fixture_room_sources'),
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
    organization('club_seats', { subject: 'user' }),
    organization('club_seat_invitations'),
    organization('media_release_club_attestations', { subject: 'user' }),
  ],
  exempt: [
    {
      table: 'billing_customers',
      reason:
        'The billing owner (ADR 0148): a Club plan’s organisation owns this row as its payer, read and written only under the billing fence (the organisation row locked after the acting account), never as tenant data a club scope may list.',
    },
    {
      table: 'billing_purchases',
      reason:
        'The billing owner (ADR 0148): a Club plan’s organisation owns this row as its payer, read and written only under the billing fence (the organisation row locked after the acting account), never as tenant data a club scope may list.',
    },
    {
      table: 'billing_subscriptions',
      reason:
        'The billing owner (ADR 0148): a Club plan’s organisation owns this row as its payer, read and written only under the billing fence (the organisation row locked after the acting account), never as tenant data a club scope may list.',
    },
    {
      table: 'account_entitlement_grants',
      reason:
        "An account's own grants, read by that account. An organization_seat grant names its paying club as provenance only (ADR 0148); it confers no club read authority.",
    },
    {
      table: 'mail_intents',
      reason:
        'Durable mail owned by the mail worker. A club seat invitation id says which offer to send; the worker reads that one invitation under its club scope at send time.',
    },
    {
      table: 'media_release_club_asks',
      reason:
        'A minor’s ask that their club confirm a media release (ADR 0151): it holds no release and grants nothing. Its recipients (the club’s owner and staff, decided when it is written) read it through their inbox for the club’s name and handle.',
    },
    {
      table: 'notifications',
      reason:
        'Fixture, lobby and command references convey provenance only. Guardian notices are additionally fenced to their recipient at storage. Other kinds retain the existing inbox authority checks.',
    },
    {
      table: 'challenges',
      reason:
        'Only the two challenged members may act on or read the offer through the Contacts fence. Its lobby pins exactly where its Room will open and grants no tenant read authority.',
    },
    {
      table: 'rooms',
      reason:
        'The Room aggregate is read by the Room evaluator path, which filters by lobby in the query; a Room listing is not fenced by a policy.',
    },
    {
      table: 'rounds',
      reason:
        'A Round is the existing competitive aggregate, authorized by the current Round evaluator. Its immutable ballot-source FK names only a version already admitted through the locked Room owner/template boundary; it conveys no tenant, Round, transcript or ballot read authority. Round reads use the frozen body, never a new tenant catalogue read.',
    },
    {
      table: 'recordings',
      reason:
        'Recording owns its existing Round-protected media/read lifecycle. Its tournament admission FK is finite capture provenance only, not a source of audience, download or sponsor read authority; the Recording capture adapter consumes only a named minimal admission output and rechecks its locked deadline before dispatch.',
    },
    {
      table: 'ballots',
      reason:
        "A ballot belongs to its Round and is protected by the Round evaluator; it only pins a ballot definition's version.",
    },
    {
      table: 'seasons',
      reason:
        'Seasons are competitive reference metadata. The leaderboard selects an official lobby before reading its seasons, and league season reads use the authorized organization and standing lobby.',
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
  definers: [
    {
      name: 'daisy_protection_guardians',
      executors: [],
      reason:
        'Private canonical lookup of a minor’s live guardians for scoped operations.',
    },
    {
      name: 'daisy_is_protection_guardian',
      executors: ['daisy_web'],
      reason: 'Checks the current subject’s authority for one child.',
    },
    {
      name: 'daisy_friend_guardian_holds',
      executors: ['daisy_web'],
      reason: 'Returns the required endpoint holds on a current contact pair.',
    },
    {
      name: 'daisy_hold_friend_request',
      executors: ['daisy_web'],
      reason:
        'Creates a scoped live hold and delivers its private in-app notice.',
    },
    {
      name: 'daisy_clear_friend_guardian_hold',
      executors: ['daisy_web'],
      reason:
        'Clears one hold on a waiting request using the subject’s current guardian authority.',
    },
    {
      name: 'daisy_retire_friend_guardian_holds',
      executors: [],
      reason: 'Retires hold metadata when the recipient accepts a friendship.',
    },
    {
      name: 'daisy_protection_level',
      executors: ['daisy_web'],
      reason: 'Reads the choice for its child or a current linked guardian.',
    },
    {
      name: 'daisy_effective_protection_choice',
      executors: [],
      reason: 'Private effective protection choice for policy decisions.',
    },
    {
      name: 'daisy_ranked_protection_allows',
      executors: ['daisy_web'],
      reason:
        'Returns only the ranked prerequisite across prospective entrants.',
    },
    {
      name: 'daisy_message_requests_friends_only',
      executors: ['daisy_web'],
      reason:
        'Returns only the effective incoming message-request restriction.',
    },
    {
      name: 'daisy_dm_request_access',
      executors: ['daisy_web'],
      reason:
        'Returns the offered action for an eligible new DM from the scoped sender.',
    },
    {
      name: 'daisy_prune_outbox_prefix',
      executors: ['daisy_web'],
      reason:
        'Prunes a final expired prefix, including private guardian signals, and returns only batch status and a count.',
    },
    {
      name: 'daisy_prune_read_notifications',
      executors: ['daisy_web'],
      reason:
        'Expires read notifications past the retention deadline without returning private notice data.',
    },
    {
      name: 'daisy_own_friend_guardian_hold_live',
      executors: ['daisy_web'],
      reason:
        'Returns standing for an approval owned by the child or their guardian.',
    },
    {
      name: 'daisy_friend_guardian_waiting',
      executors: ['daisy_web'],
      reason:
        'Projects the participant’s own hold and generic counterpart waiting.',
    },
    {
      name: 'daisy_lock_protection_accounts',
      executors: ['daisy_web'],
      reason:
        'Locks the child and active guardian accounts for a scoped protection change, returning no account data.',
    },
    {
      name: 'daisy_set_protection_level',
      executors: ['daisy_web'],
      reason:
        'Writes one child choice from an active guardian’s subject scope under the account fence.',
    },
    {
      name: 'daisy_erase_protection_choice',
      executors: ['daisy_web'],
      reason: 'Erases the subject’s choice only after the account has closed.',
    },
    {
      name: 'daisy_clear_unlinked_protection',
      executors: [],
      reason:
        'Guardian-link close trigger erases the choice when the final active link ends.',
    },
    {
      name: 'daisy_round_rating_posted',
      executors: ['daisy_web'],
      reason:
        'The rating sweep and completion check need one bit of posting state for a persisted Round across standing lobbies.',
    },
    {
      name: 'daisy_round_rating_release_facts',
      executors: ['daisy_web'],
      reason:
        'The spectator release sweep needs only ledger ids and posting times for one Round with an audience, across standing lobbies.',
    },
    {
      name: 'daisy_expire_child_account_requests',
      executors: ['daisy_web'],
      reason:
        'ADR 0163: bounded expiration and contact scrubbing across guardian invitations. Returns only a count.',
    },
    {
      name: 'daisy_room_is_youth',
      executors: ['daisy_web', 'daisy_realtime', 'daisy_audience_publisher'],
      reason:
        'Returns the age-rule classification needed by linked-adult, recording and spectator readers without granting those readers access to lobby rows.',
    },
    {
      name: 'daisy_room_youth_recording_cast',
      executors: ['daisy_web'],
      reason:
        'Freezes whether a standing Room has youth debaters at Start for recording reuse. It returns no person or chat authority.',
    },
    {
      name: 'daisy_round_reuse_age_unknown',
      executors: ['daisy_web'],
      reason:
        'Returns whether missing age evidence on a debating seat prevents reuse of a mixed-age Round or a standing adults-only Round with a frozen youth cast. It grants no viewing authority.',
    },
    {
      name: 'daisy_linked_adult_users',
      executors: ['daisy_web'],
      reason:
        "ADR 0150 §3, ADR 0158: a minor's linked adults (active guardian links, their open schools' owners and school.roster.manage staff), the rule's one SQL statement. It returns user ids only; media releases name who hears of a withdrawn release.",
    },
    {
      name: 'daisy_round_linked_adult_actors',
      executors: ['daisy_web', 'daisy_realtime'],
      reason:
        "ADR 0155, ADR 0158: a Youth Round's youth debaters and their linked adults' actor ids, over daisy_linked_adult_users; nothing for any other Round. Its Recording, the web's live audience and the realtime Round topic and floor permits decide who watches from it, so realtime holds no privilege on the tables it reads.",
    },
    {
      name: 'daisy_room_community_fact',
      executors: ['daisy_web', 'daisy_realtime'],
      reason:
        "Decision 84: a Room chat's authority fact, with whether the caller is a seated youth debater's school staff, read across the debater's schools. It returns booleans about the caller only.",
    },
    {
      name: 'daisy_erase_unused_hosting_versions',
      executors: ['daisy_web'],
      reason:
        "Account erasure: deletes a closed account's hosting versions that no tournament admission or sponsorship names; it refuses an open account.",
    },
    {
      name: 'daisy_nonranked_capture_capacity',
      executors: ['daisy_web'],
      reason:
        'Capture capacity: counts the unsettled tournament capture admissions that hold capacity, across lobbies; it returns counts only.',
    },
    {
      name: 'daisy_recording_tournament_admission',
      executors: ['daisy_web'],
      reason:
        "Recording capture: one Round's unsettled tournament capture admission (id, Round, deadline) for the Recording's own Round-protected lifecycle.",
    },
    {
      name: 'daisy_lock_recording_tournament_admission',
      executors: ['daisy_web'],
      reason:
        "Recording capture: locks one Round's unsettled tournament capture admission so its dispatch rechecks the deadline; it returns the same minimal output.",
    },
    {
      name: 'daisy_recording_settle_tournament_admission',
      executors: ['daisy_web'],
      reason:
        "Recording capture: settles one Round's tournament capture admission once its Recording dispatched; it returns whether it did.",
    },
    {
      name: 'daisy_recording_settle_undispatched_tournament_admission',
      executors: ['daisy_web'],
      reason:
        "Recording capture: settles one Round's tournament capture admission whose Recording never dispatched; it returns whether it did.",
    },
    {
      name: 'daisy_recording_expired_tournament_admissions',
      executors: ['daisy_web'],
      reason:
        'Recording capture: the Round ids of a bounded batch of expired unsettled tournament capture admissions, for the settlement sweep.',
    },
    {
      name: 'daisy_recording_admission_deadline',
      executors: [],
      reason:
        "Recording capture: a trigger function holding every Recording over an admitted Round to its admission's deadline; no runtime role executes it.",
    },
    {
      name: 'daisy_record_fixture_room_source',
      executors: [],
      reason:
        "Tab fixtures: a trigger function recording a fixture Room's immutable source row; no runtime role executes it.",
    },
  ],
};
