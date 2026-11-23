import { hostWaits } from '@daisy/worker/host';
import { grantHostReader } from './tab-host-reader-grant.test-support';
import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore, type TabStore } from '@daisy/db/tab';
import {
  scratchDatabase,
  withRuntimeTestTransaction,
  committingRuntimeTestDatabase,
  finishedOrBlockedBehind,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { readOrganizationPeople } from '../src/features/tab/reads/organization-people';
import { organizationStage } from './tab-tournament-organization.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { presetStaffRoleId } from './tab-tournament-organization-wiring.test-support';
import { createOwnedTournament } from './tab-tournament-owned-event.test-support';
import { organizationPeopleViewSchema } from '@daisy/protocol/lobby/organization-read';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'tabpeopleread');
afterAll(() => scratch.drop());
test('a people read retains its actual account and organization fences through the authorization callback', async () => {
  await scratch.create();
  await scratch.migrate(() => true);
  const owner = new SQL(scratch.url, { max: 1 });
  const reader = new SQL(scratch.url, { max: 1 });
  const writer = new SQL(scratch.url, { max: 1 });
  const observer = new SQL(scratch.url, { max: 1 });
  let release = () => {};
  let reading: Promise<unknown> | null = null;
  let revoking: Promise<unknown> | null = null;
  let overlapping: Promise<unknown> | null = null;
  try {
    const bots = await createBots(owner, ['Director', 'Staff', 'Coach']);
    const state = {
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      clock: scriptClock(),
      made: new Map<string, string>(),
    };
    await withRuntimeTestTransaction(owner, async (frame) => {
      await organizationStage({ ...state, ...frame });
      await grantHostReader({ ...state, ...frame });
      const owned = await createOwnedTournament({ ...state, ...frame });
      state.made.set('fence-lobby', owned.lobbyId);
      const send = organizationCommand({
        store: createTabStore(frame.database),
        authorize,
        now: state.clock.now,
        newId: createId,
      });
      const school = await send(as(state.bots.Coach!), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-organization',
          kind: 'school',
          name: 'Separate School',
          handle: `separate-${createId().slice(0, 10)}`,
        },
      });
      if (school.kind !== 'accepted')
        throw new Error('separate school setup failed');
      const schoolId = school.receipt.aggregate.id;
      const invite = await send(as(state.bots.Coach!), {
        version: 1,
        commandId: createId(),
        expected: { organization: school.receipt.resultingVersion },
        command: {
          type: 'invite-member',
          organizationId: schoolId,
          userId: state.bots.Staff!.userId,
        },
      });
      if (invite.kind !== 'accepted')
        throw new Error('separate membership invitation failed');
      const accepted = await send(as(state.bots.Staff!), {
        version: 1,
        commandId: createId(),
        expected: { organization: invite.receipt.resultingVersion },
        command: { type: 'accept-membership', organizationId: schoolId },
      });
      if (accepted.kind !== 'accepted')
        throw new Error('separate membership acceptance failed');
      state.made.set('separate-school', schoolId);
      state.made.set(
        'separate-version',
        String(accepted.receipt.resultingVersion),
      );
    });
    const organizationId = state.made.get('league')!;
    const [held] = await reader`select pg_backend_pid() as pid`;
    const [grant] =
      await owner`select id from grants where organization_id=${organizationId} and scope_kind='organization' and user_id=${state.bots.Staff!.userId} and revoked_at is null and role_id in (select role_id from role_permissions where permission='organization.roles.manage')`;
    const [organization] =
      await owner`select version from organizations where id=${organizationId}`;
    const original = createTabStore(committingRuntimeTestDatabase(reader));
    const pauseRead = () => {
      let reached = () => {};
      const ready = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const paused: Pick<TabStore, 'organizationPeople'> = {
        organizationPeople: (input, work) =>
          original.organizationPeople(input, async (facts) => {
            reached();
            await released;
            return work(facts);
          }),
      };
      reading = readOrganizationPeople({
        store: paused,
        authorize,
        now: state.clock.now,
      })(as(state.bots.Staff!), organizationId);
      return ready;
    };
    await pauseRead();
    overlapping = readOrganizationPeople({
      store: createTabStore(committingRuntimeTestDatabase(owner)),
      authorize,
      now: state.clock.now,
    })(as(state.bots.Staff!), organizationId);
    const concurrent = await finishedOrBlockedBehind(
      overlapping,
      observer,
      Number(held?.pid),
      { waits: hostWaits },
    );
    release();
    await Promise.all([reading, overlapping]);
    assert({
      given:
        'another read by the same viewer while the first authorization callback is paused',
      should: 'share the canonical account and organization fences',
      actual: concurrent,
      expected: 'finished',
    });
    await pauseRead();
    const send = organizationCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: state.clock.now,
      newId: createId,
    });
    const lobbyId = state.made.get('fence-lobby')!;
    revoking = send(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { lobby: 1 },
      command: {
        type: 'give-grant',
        scope: { kind: 'lobby', lobbyId },
        userId: state.bots.Coach!.userId,
        roleId: presetStaffRoleId,
        expiresAt: null,
      },
    });
    const lobbyWait = await finishedOrBlockedBehind(
      revoking,
      observer,
      Number(held?.pid),
      { waits: hostWaits },
    );
    release();
    const beforeGrant = organizationPeopleViewSchema.parse(await reading);
    const granted = await revoking;
    const afterGrant = await readOrganizationPeople({
      store: original,
      authorize,
      now: state.clock.now,
    })(as(state.bots.Staff!), organizationId);
    const lobbyRoles = (view: typeof beforeGrant) =>
      view.people
        .find((person) => person.userId === state.bots.Coach!.userId)
        ?.grants.filter(
          (grant) =>
            grant.scope.kind === 'lobby' && grant.scope.lobbyId === lobbyId,
        ).length;
    assert({
      given:
        'a Staff people snapshot while a different owner gives a lobby role to a different recipient',
      should:
        'hold its actual lobby guard and role list through projection, independently of viewer-account locking',
      actual: [
        lobbyWait,
        beforeGrant.lobbies.find((lobby) => lobby.lobbyId === lobbyId)?.version,
        lobbyRoles(beforeGrant),
        (granted as { kind: string }).kind,
        afterGrant?.lobbies.find((lobby) => lobby.lobbyId === lobbyId)?.version,
        afterGrant ? lobbyRoles(afterGrant) : null,
      ],
      expected: ['blocked', 1, 0, 'accepted', 2, 1],
    });
    await pauseRead();
    revoking = send(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { organization: Number(organization?.version) },
      command: {
        type: 'update-organization',
        organizationId,
        name: 'Renamed Valley',
      },
    });
    const metadata = await finishedOrBlockedBehind(
      revoking,
      observer,
      Number(held?.pid),
      { waits: hostWaits },
    );
    release();
    await reading;
    const renamed = await revoking;
    const fresh = await readOrganizationPeople({
      store: original,
      authorize,
      now: state.clock.now,
    })(as(state.bots.Staff!), organizationId);
    assert({
      given:
        'an owner changing metadata with no need for the reader account fence',
      should:
        'wait on the organization snapshot fence and expose the next committed version together',
      actual: [
        metadata,
        (renamed as { kind: string }).kind,
        fresh?.name,
        fresh?.version,
      ],
      expected: [
        'blocked',
        'accepted',
        'Renamed Valley',
        Number(organization?.version) + 1,
      ],
    });
    await pauseRead();
    revoking = send(as(state.bots.Staff!), {
      version: 1,
      commandId: createId(),
      expected: { organization: Number(state.made.get('separate-version')) },
      command: {
        type: 'end-membership',
        organizationId: state.made.get('separate-school')!,
        userId: state.bots.Staff!.userId,
      },
    });
    const account = await finishedOrBlockedBehind(
      revoking,
      observer,
      Number(held?.pid),
      { waits: hostWaits },
    );
    release();
    await reading;
    const left = await revoking;
    assert({
      given:
        'the reader changing their own membership in a different organization',
      should:
        'wait on the account fence independently of the viewed organization metadata',
      actual: [account, (left as { kind: string }).kind],
      expected: ['blocked', 'accepted'],
    });
    await pauseRead();
    revoking = organizationCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: state.clock.now,
      newId: createId,
    })(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { organization: Number(organization?.version) + 1 },
      command: {
        type: 'remove-grant',
        grantId: String(grant?.id),
        scope: { kind: 'organization', organizationId: organizationId },
      },
    });
    const blocked = await finishedOrBlockedBehind(
      revoking,
      observer,
      Number(held?.pid),
      { waits: hostWaits },
    );
    release();
    const read = await reading;
    const removed = await revoking;
    const later = await readOrganizationPeople({
      store: original,
      authorize,
      now: state.clock.now,
    })(as(state.bots.Staff!), organizationId);
    assert({
      given:
        'a Staff people read paused inside its actual transaction while the owner revokes its real grant',
      should:
        'serialize the revocation until authorization finishes and deny the next committed read',
      actual: [
        blocked,
        read !== null,
        (removed as { kind: string }).kind,
        later,
      ],
      expected: ['blocked', true, 'accepted', null],
    });
  } finally {
    release();
    await Promise.allSettled([
      ...(reading ? [reading] : []),
      ...(revoking ? [revoking] : []),
      ...(overlapping ? [overlapping] : []),
    ]);
    await Promise.all([
      owner.close(),
      reader.close(),
      writer.close(),
      observer.close(),
    ]);
  }
}, 60_000);
