import { judgeRegistrationCommand } from '../src/features/tab/operations/judge-registration';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { noopErrorReporter } from '@daisy/observability';
import { hostRosterViewSchema } from '@daisy/protocol/lobby/entry-read';
import {
  createHostRosterRoute,
  hostRosterPath,
} from '../src/features/tab/host-roster-route';
import { readHostRoster } from '../src/features/tab/reads/host-roster';
import { hostEntriesOf, hostJudgesOf } from '../src/features/tab/entries';
import { organizationCommand } from '../src/features/tab/operations/organization';
import {
  member,
  origin,
} from '../src/features/auth/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { createBots, type World } from './tab-tournament.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';

export async function proveRosterArea(world: World) {
  const { sql } = world,
    lobbyId = world.made.get('tournament-lobby')!,
    organizationId = world.made.get('league')!;
  const [viewer] = await createBots(sql, ['Entries only']);
  if (!viewer) throw new Error('Viewer missing');
  const store = createTabStore(world.database),
    read = readHostRoster({ store, authorize });
  const roleId = createId();
  await sql`insert into roles(id,organization_id,name,rank,preset) values(${roleId},${organizationId},'Entries only',58,false)`;
  await sql`insert into role_permissions(role_id,organization_id,permission) values(${roleId},${organizationId},'tournament.entries.manage')`;
  const command = organizationCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  const [before] = await sql`select version from lobbies where id=${lobbyId}`;
  const granted = await command(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(before!.version) },
    command: {
      type: 'give-grant',
      scope: { kind: 'lobby', lobbyId },
      userId: viewer.userId,
      roleId,
      expiresAt: null,
    },
  });
  const [pendingJudge] = await createBots(sql, ['Invited, not accepted']);
  if (!pendingJudge) throw new Error('Pending judge missing');
  const invitation = await judgeRegistrationCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
    minorsReleased: async () => false,
  })(as(world.bots.Director!), lobbyId, {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'invite-judge',
      actorId: pendingJudge.actorId,
      schoolOrganizationId: null,
      chairQualified: false,
      eventIds: [world.made.get('event')!],
    },
  });
  const route = createHostRosterRoute({
    read,
    released: async () => true,
    boundary: {
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => ({
        ...member,
        principal: { ...as(viewer), actorId: viewer.actorId },
      }),
    },
  });
  const request = () => new Request(`${origin}${hostRosterPath(lobbyId)}`);
  const response = await route(request());
  if (response.status !== 200)
    throw new Error(`Actual roster refused ${response.status}`);
  const view = hostRosterViewSchema.parse(await response.json());
  assert({
    given: 'an actual pending judge invitation',
    should: 'not count or list it as an accepted eligible judge',
    actual: [
      invitation.kind,
      view.judges.groups
        .flatMap((g) => g.judges)
        .some((j) => j.name === pendingJudge.name),
    ],
    expected: ['accepted', false],
  });
  const source = await store.hostRoster(
    { viewerUserId: viewer.userId, lobbyId },
    async (f) => f,
  );
  if (!source) throw new Error('Roster source missing');
  const selected = source.entries.filter(
    (e) => e.eventId === view.entries.eventId,
  );
  const actualMakers = [
    ...new Set(
      view.entries.groups.flatMap((g) => g.makers.map((m) => m.userId)),
    ),
  ].sort();
  const expectedMakers = [
    ...new Set(
      selected.flatMap((e) =>
        e.submittedByUserId ? [e.submittedByUserId] : [],
      ),
    ),
  ].sort();
  const entries = hostEntriesOf(view.entries, {
      current: 'Actual event',
      position: '',
      others: [],
    }),
    judges = hostJudgesOf(view.judges);
  assert({
    given: 'actual Entries-only authority and persisted roster sources',
    should:
      'return no-store actual counts and all immutable makers, with explicitly unconfigured obligations',
    actual: [
      granted.kind,
      response.headers.get('cache-control'),
      view.entries.groups.reduce((n, g) => n + g.entries.length, 0),
      actualMakers,
      view.entries.groups.every((g) => g.judgesOwed === null),
      view.judges.groups.every((g) => g.judgesOwed === null),
      view.judges.counts.judges,
      view.entries.counts.judges,
      judges.lede.includes('obligations unconfigured'),
      entries.groups.every((g) => g.summary.includes('unconfigured')),
    ],
    expected: [
      'accepted',
      'no-store',
      selected.length,
      expectedMakers,
      true,
      true,
      source.judges.filter(
        (j) =>
          j.status === 'accepted' &&
          source.accounts.some(
            (p) =>
              p.actorId === j.actorId &&
              p.account?.member &&
              !p.account.erased &&
              p.account.ageBand === 'adult',
          ),
      ).length,
      view.judges.groups.flatMap((g) => g.judges).length,
      true,
      true,
    ],
  });
  assert({
    given: 'foreign event identity',
    should: 'conceal rather than substitute a different event',
    actual: await read(as(viewer), { lobbyId, eventId: createId() }),
    expected: null,
  });
  const [grant] =
    await sql`select id from grants where lobby_id=${lobbyId} and user_id=${viewer.userId} and revoked_at is null`;
  const [current] = await sql`select version from lobbies where id=${lobbyId}`;
  const revoked = await command(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(current!.version) },
    command: {
      type: 'remove-grant',
      scope: { kind: 'lobby', lobbyId },
      grantId: String(grant!.id),
    },
  });
  assert({
    given: 'canonical roster role revocation',
    should: 'conceal the current roster read',
    actual: [revoked.kind, (await route(request())).status],
    expected: ['accepted', 404],
  });
}
