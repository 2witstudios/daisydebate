import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { digest } from './constraint-helpers';
import { integrationSuite } from './suite.test-support';
import {
  asRuntime,
  columnsOf,
  daisy,
  insertRow,
  recordCommand,
  refusedBy,
  sampleInstant as at,
  withSample,
} from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

const directorRole = 'ruxofzpyiy993hn97bbxfewb';

/** TAB-4.4 */
test('an organization keeps an owner, a membership grants nothing, and an organization grant needs a membership', async () => {
  await withSample(url, async (sql, ids) => {
    const grant = (rest: Record<string, unknown>) =>
      insertRow(sql, 'grants', {
        id: createId(),
        role_id: directorRole,
        granted_by_user_id: ids.owner,
        granted_at: at(0),
        ...rest,
      });
    assert({
      given:
        'an organization with no owner, the memberships table, and an organization-scope grant for a person with no membership row',
      should:
        'refuse the organization and the grant, and show a membership carries no role or permission',
      actual: {
        ownerless: await refusedBy(sql, () =>
          insertRow(sql, 'organizations', {
            id: createId(),
            kind: 'school',
            name: 'Ownerless',
            handle: `ownerless-${createId()}`,
          }),
        ),
        daisyHasNoOwnerRow: (
          await sql.unsafe(
            'select owner_user_id from organizations where id = $1',
            [daisy.organization],
          )
        )[0],
        membership: await columnsOf(sql, 'memberships'),
        withoutMembership: await refusedBy(sql, () =>
          grant({
            user_id: ids.coach,
            scope_kind: 'organization',
            organization_id: ids.league,
          }),
        ),
        withMembership: await refusedBy(sql, () =>
          grant({
            user_id: ids.staff,
            scope_kind: 'organization',
            organization_id: ids.league,
          }),
        ),
      },
      expected: {
        ownerless: 'organizations_has_owner',
        daisyHasNoOwnerRow: { owner_user_id: null },
        membership: [
          'created_at',
          'ended_at',
          'joined_at',
          'organization_id',
          'status',
          'updated_at',
          'user_id',
          'version',
        ],
        withoutMembership: 'grants_membership_fk',
        withMembership: null,
      },
    });
  });
});

/** TAB-4.5 */
test('a grant has exactly one scope, is revoked once and never deleted, and action history that names it resolves', async () => {
  await withSample(url, async (sql, ids) => {
    const grant = (rest: Record<string, unknown>) =>
      insertRow(sql, 'grants', {
        id: createId(),
        role_id: directorRole,
        user_id: ids.staff,
        granted_by_user_id: ids.owner,
        granted_at: at(0),
        ...rest,
      });
    const scopes = {
      both: await refusedBy(sql, () =>
        grant({
          scope_kind: 'lobby',
          organization_id: ids.league,
          lobby_id: ids.lobby,
        }),
      ),
      neither: await refusedBy(sql, () => grant({ scope_kind: 'lobby' })),
      mislabelled: await refusedBy(sql, () =>
        grant({ scope_kind: 'organization', lobby_id: ids.lobby }),
      ),
      duplicate: await refusedBy(sql, () =>
        grant({
          role_id: 'lih2kkdou2a93bd7f8tgciko',
          scope_kind: 'lobby',
          lobby_id: ids.lobby,
        }),
      ),
    };
    // Daisy's first grant is the operator's and names no granter.
    const byOperator = await refusedBy(sql, () =>
      grant({
        scope_kind: 'lobby',
        lobby_id: ids.otherLobby,
        granted_by_user_id: null,
      }),
    );
    const expiring = createId();
    await grant({
      id: expiring,
      scope_kind: 'lobby',
      lobby_id: ids.lobby,
      granted_at: '2020-01-01T00:00:00.000Z',
      expires_at: '2020-01-02T00:00:00.000Z',
    });
    const commandId = await recordCommand(sql, ids, {
      authority: 'grant',
      grant_id: ids.staffGrant,
    });
    await sql.unsafe(
      'update grants set revoked_at = $2, revoked_by_user_id = $3 where id = $1',
      [ids.staffGrant, at(30), ids.owner],
    );
    assert({
      given:
        'grants naming both scopes, neither and the wrong one, then an expired grant and a revoked one that action history names',
      should:
        'refuse the first three and a second live grant of one role, keep the expired and revoked rows readable, and refuse any later change or delete',
      actual: {
        ...scopes,
        byOperator,
        expiredStillThere: (
          await sql.unsafe(
            'select expires_at < now() as expired from grants where id = $1',
            [expiring],
          )
        )[0],
        historyResolves: (
          await sql.unsafe(
            `select g.id, g.revoked_at is not null as revoked
             from action_history h join grants g on g.id = h.grant_id
             where h.command_id = $1`,
            [commandId],
          )
        )[0],
        unrevoked: await refusedBy(sql, () =>
          sql.unsafe(
            'update grants set revoked_at = null, revoked_by_user_id = null where id = $1',
            [ids.staffGrant],
          ),
        ),
        regranted: await refusedBy(sql, () =>
          sql.unsafe('update grants set user_id = $2 where id = $1', [
            expiring,
            ids.owner,
          ]),
        ),
        deleted: await refusedBy(sql, () =>
          sql.unsafe('delete from grants where id = $1', [ids.staffGrant]),
        ),
        deletedAsRuntime: await asRuntime(sql, { lobbyId: ids.lobby }, () =>
          refusedBy(sql, () =>
            sql.unsafe('delete from grants where id = $1', [ids.staffGrant]),
          ),
        ),
      },
      expected: {
        both: 'grants_one_tenant_key',
        neither: 'grants_one_tenant_key',
        mislabelled: 'grants_scope_check',
        duplicate: 'grants_live_unique',
        byOperator: null,
        expiredStillThere: { expired: true },
        historyResolves: { id: ids.staffGrant, revoked: true },
        unrevoked: 'grants_only_revoked',
        regranted: 'grants_only_revoked',
        deleted: 'grants_never_deleted',
        deletedAsRuntime: '42501',
      },
    });
  });
});

/** TAB-4.6 */
test('what happened is append-only, and the guardian tables are closed to the runtime role', async () => {
  await withSample(url, async (sql, ids) => {
    const appendOnly = [
      ['action_history', 'applied_at = applied_at'],
      ['results', 'recorded_at = recorded_at'],
      ['result_entries', 'won = won'],
      ['result_speakers', 'rank = rank'],
      ['certifications', 'certified_at = certified_at'],
      ['certification_results', 'result_id = result_id'],
      ['releases', 'opened_at = opened_at'],
      ['conflicts', 'detected_at = detected_at'],
      ['ballot_definition_versions', 'version = version'],
    ] as const;
    // One at a time: each attempt holds the connection's one savepoint.
    const attempts = async () => {
      const refusals: Record<string, Array<string | null>> = {};
      for (const [table, assignment] of appendOnly)
        refusals[table] = [
          await refusedBy(sql, () =>
            sql.unsafe(`update ${table} set ${assignment}`),
          ),
          await refusedBy(sql, () => sql.unsafe(`delete from ${table}`)),
        ];
      return refusals;
    };
    const link = {
      id: createId(),
      guardian_user_id: ids.owner,
      minor_user_id: ids.staff,
      kind: 'parent',
      status: 'pending',
    };
    assert({
      given:
        'an update and a delete of each append-only table, as the migration owner and as the runtime role, and an insert of a guardian link and a restriction as the runtime role',
      should:
        'refuse every one: by trigger for any role, and by privilege for the runtime role',
      actual: {
        owner: await attempts(),
        runtime: await asRuntime(
          sql,
          { lobbyId: ids.lobby, organizationId: ids.league },
          attempts,
        ),
        guardianLink: await asRuntime(sql, { subjectUserId: ids.owner }, () =>
          refusedBy(sql, () => insertRow(sql, 'guardian_links', link)),
        ),
        restriction: await asRuntime(sql, { subjectUserId: ids.owner }, () =>
          refusedBy(sql, () =>
            insertRow(sql, 'restrictions', {
              guardian_link_id: link.id,
              guardian_user_id: ids.owner,
              minor_user_id: ids.staff,
            }),
          ),
        ),
        restrictionLobby: await asRuntime(
          sql,
          { subjectUserId: ids.owner },
          () =>
            refusedBy(sql, () =>
              insertRow(sql, 'restriction_lobbies', {
                guardian_link_id: link.id,
                guardian_user_id: ids.owner,
                minor_user_id: ids.staff,
                lobby_id: ids.lobby,
              }),
            ),
        ),
        consentColumns: [
          ...(await columnsOf(sql, 'guardian_links')),
          ...(await columnsOf(sql, 'restrictions')),
        ].filter((column) => column.includes('consent')),
      },
      expected: {
        owner: Object.fromEntries(
          appendOnly.map(([table]) => [
            table,
            [`${table}_append_only`, `${table}_append_only`],
          ]),
        ),
        runtime: Object.fromEntries(
          appendOnly.map(([table]) => [table, ['42501', '42501']]),
        ),
        guardianLink: '42501',
        restriction: '42501',
        restrictionLobby: '42501',
        consentColumns: [],
      },
    });
  });
});

/** TAB-4.6: the shapes the closed tables hold for the migration that opens them. */
test('a guardian link is two different people, a coach through a school, with one open link per pair', async () => {
  await withSample(url, async (sql, ids) => {
    const link = (rest: Record<string, unknown>) =>
      insertRow(sql, 'guardian_links', {
        id: createId(),
        guardian_user_id: ids.coach,
        minor_user_id: ids.staff,
        kind: 'parent',
        status: 'active',
        ...rest,
      });
    const linkId = createId();
    await link({ id: linkId });
    assert({
      given:
        'a link of a person to themselves, a coach link through no school and through a league, a second open link for a pair, and a restriction naming other people than its link',
      should: 'refuse each',
      actual: {
        self: await refusedBy(sql, () => link({ minor_user_id: ids.coach })),
        coachWithoutSchool: await refusedBy(sql, () =>
          link({ kind: 'coach', minor_user_id: ids.owner }),
        ),
        coachThroughLeague: await refusedBy(sql, () =>
          link({
            kind: 'coach',
            minor_user_id: ids.owner,
            via_organization_id: ids.league,
          }),
        ),
        secondOpen: await refusedBy(sql, () => link({ status: 'pending' })),
        otherPeople: await refusedBy(sql, () =>
          insertRow(sql, 'restrictions', {
            guardian_link_id: linkId,
            guardian_user_id: ids.owner,
            minor_user_id: ids.staff,
          }),
        ),
        // Only a parent's link holds a restriction.
        coachRestriction: await refusedBy(sql, async () => {
          const coachLink = createId();
          await link({
            id: coachLink,
            kind: 'coach',
            minor_user_id: ids.owner,
            via_organization_id: ids.school,
          });
          await insertRow(sql, 'restrictions', {
            guardian_link_id: coachLink,
            guardian_user_id: ids.coach,
            minor_user_id: ids.owner,
          });
        }),
        restriction: await refusedBy(sql, () =>
          insertRow(sql, 'restrictions', {
            guardian_link_id: linkId,
            guardian_user_id: ids.coach,
            minor_user_id: ids.staff,
            limits_lobbies: true,
            video_audience_cap: 'officials',
          }),
        ),
      },
      expected: {
        self: 'guardian_links_two_people',
        coachWithoutSchool: 'guardian_links_coach_via_school',
        coachThroughLeague: 'guardian_links_via_school_fk',
        secondOpen: 'guardian_links_open_pair_unique',
        otherPeople: 'restrictions_guardian_link_fk',
        coachRestriction: 'restrictions_guardian_link_fk',
        restriction: null,
      },
    });
  });
});

/** TAB-4.24 */
test('a held command is stored whole, read in its lobby only, settled once and never by its proposer', async () => {
  await withSample(url, async (sql, ids) => {
    const settle = (status: string, by: string | null) =>
      sql.unsafe(
        'update pending_commands set status = $2, settled_at = $3, settled_by_user_id = $4 where command_id = $1',
        [ids.commands.held, status, at(40), by],
      );
    const read = () =>
      sql.unsafe(
        'select proposer_user_id, type, payload, payload_digest, expected from pending_commands where command_id = $1',
        [ids.commands.held],
      ) as Promise<unknown[]>;
    const stored = await asRuntime(sql, { lobbyId: ids.lobby }, read);
    const elsewhere = await asRuntime(sql, { lobbyId: ids.otherLobby }, read);
    const byProposer = await refusedBy(sql, () =>
      settle('confirmed', ids.staff),
    );
    const rewritten = await refusedBy(sql, () =>
      sql.unsafe(
        `update pending_commands set payload = '{"fixtureId":"other"}'::jsonb where command_id = $1`,
        [ids.commands.held],
      ),
    );
    // The confirmation is a new conflict row carrying the confirmer.
    await insertRow(sql, 'conflicts', {
      id: createId(),
      lobby_id: ids.lobby,
      user_id: ids.staff,
      fixture_id: ids.pairing,
      basis: 'school_entry',
      handling: 'second_confirms',
      confirmed_by_user_id: ids.owner,
      detected_at: at(41),
    });
    await settle('confirmed', ids.owner);
    assert({
      given:
        "a command held under its proposer's command id, settled by its proposer, rewritten, confirmed by a second person, then settled again",
      should:
        'store it whole in its own lobby, refuse the proposer, the rewrite and the second settlement, and leave the conflict row naming the confirmer',
      actual: {
        stored,
        elsewhere,
        byProposer,
        rewritten,
        again: await refusedBy(sql, () => settle('declined', ids.owner)),
        deleted: await refusedBy(sql, () =>
          sql.unsafe('delete from pending_commands where command_id = $1', [
            ids.commands.held,
          ]),
        ),
        selfConfirmedConflict: await refusedBy(sql, () =>
          insertRow(sql, 'conflicts', {
            id: createId(),
            lobby_id: ids.lobby,
            user_id: ids.staff,
            fixture_id: ids.pairing,
            basis: 'seated',
            handling: 'second_confirms',
            confirmed_by_user_id: ids.staff,
            detected_at: at(42),
          }),
        ),
        waiver: (
          await sql.unsafe(
            'select count(*)::int as rows from conflicts where fixture_id = $1 and user_id = $2 and confirmed_by_user_id = $3',
            [ids.pairing, ids.staff, ids.owner],
          )
        )[0],
      },
      expected: {
        stored: [
          {
            proposer_user_id: ids.staff,
            type: 'enter-result',
            payload: { fixtureId: ids.pairing },
            payload_digest: digest,
            expected: { fixture: 1 },
          },
        ],
        elsewhere: [],
        byProposer: 'pending_commands_second_person',
        rewritten: 'pending_commands_stored_whole',
        again: 'pending_commands_settled_once',
        deleted: 'pending_commands_never_deleted',
        selfConfirmedConflict: 'conflicts_confirmer_check',
        waiver: { rows: 1 },
      },
    });
  });
});

test('action history names one tenant, one principal and the authority it ran under', async () => {
  await withSample(url, async (sql, ids) => {
    const record = (rest: Record<string, unknown>) =>
      refusedBy(sql, () => recordCommand(sql, ids, rest));
    assert({
      given:
        'history rows naming both tenants, both principals, a grant authority with no grant, a relationship with no relation, and a conflict of another lobby',
      should: 'refuse each, and accept a service and a relationship row',
      actual: {
        bothTenants: await record({ organization_id: ids.league }),
        bothPrincipals: await record({ service_id: 'tab-engine' }),
        grantWithoutGrant: await record({ authority: 'grant' }),
        relationshipWithoutRelation: await record({
          authority: 'relationship',
        }),
        conflictElsewhere: await record({
          lobby_id: ids.otherLobby,
          conflict_id: ids.conflict,
        }),
        service: await record({
          actor_user_id: null,
          service_id: 'tab-engine',
          authority: 'service',
        }),
        relationship: await record({
          authority: 'relationship',
          relation: 'guardian',
          conflict_id: ids.conflict,
        }),
      },
      expected: {
        bothTenants: 'action_history_one_tenant_key',
        bothPrincipals: 'action_history_one_principal',
        grantWithoutGrant: 'action_history_grant_authority',
        relationshipWithoutRelation: 'action_history_relationship_authority',
        conflictElsewhere: 'action_history_conflict_fk',
        service: null,
        relationship: null,
      },
    });
  });
});

test('Daisy and its preset roles are there after migrating, and only Daisy holds presets', async () => {
  await withSample(url, async (sql, ids) => {
    assert({
      given: 'a migrated database',
      should:
        'hold Daisy as a league with four ranked preset roles, and refuse a preset role or a second role of one rank elsewhere',
      actual: {
        daisy: (
          await sql.unsafe(
            'select kind, handle from organizations where id = $1',
            [daisy.organization],
          )
        )[0],
        presets: await sql.unsafe(
          `select r.name, r.rank, count(p.permission)::int as permissions
           from roles r left join role_permissions p on p.role_id = r.id
           where r.organization_id = $1 and r.preset group by r.name, r.rank order by r.rank`,
          [daisy.organization],
        ),
        presetElsewhere: await refusedBy(sql, () =>
          insertRow(sql, 'roles', {
            id: createId(),
            organization_id: ids.league,
            name: 'Preset',
            rank: 1,
            preset: true,
          }),
        ),
        sameRank: await refusedBy(sql, () =>
          insertRow(sql, 'roles', {
            id: createId(),
            organization_id: daisy.organization,
            name: 'Second director',
            rank: 1,
          }),
        ),
        unknownPermission: await refusedBy(sql, () =>
          insertRow(sql, 'role_permissions', {
            role_id: directorRole,
            organization_id: daisy.organization,
            permission: 'room.manage',
          }),
        ),
      },
      expected: {
        daisy: { kind: 'league', handle: 'daisy' },
        presets: [
          { name: 'Director', rank: 1, permissions: 13 },
          { name: 'Staff', rank: 2, permissions: 7 },
          { name: 'Coach', rank: 3, permissions: 2 },
          { name: 'Assistant', rank: 4, permissions: 1 },
        ],
        presetElsewhere: 'roles_preset_is_daisy',
        sameRank: 'roles_rank_unique',
        unknownPermission: 'role_permissions_permission_check',
      },
    });
  });
});
