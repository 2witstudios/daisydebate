import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import {
  committingRuntimeTestDatabase,
  scratchDatabase,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { CommandDenied } from '../src/features/tab/commands/run-command';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { readOrganizationPeople } from '../src/features/tab/reads/organization-people';
import { createBots, scriptClock } from './tab-tournament.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'cancelmembership');
afterAll(() => scratch.drop());

test('DEC406: invitation cancellation binds the displayed membership and races acceptance atomically', async () => {
  await scratch.create();
  await scratch.migrate(() => true);
  const owner = new SQL(scratch.url, { max: 1 });
  const cancelling = new SQL(scratch.url, { max: 1 });
  const accepting = new SQL(scratch.url, { max: 1 });
  try {
    const [director, member, outsider] = await createBots(owner, [
      'Director',
      'Member',
      'Outsider',
    ]);
    if (!director || !member || !outsider) throw new Error('Missing cast');
    const clock = scriptClock();
    const commands = (client: SQL) => {
      const store = createTabStore(committingRuntimeTestDatabase(client));
      return {
        send: organizationCommand({
          store,
          authorize,
          now: clock.now,
          newId: createId,
        }),
        people: readOrganizationPeople({ store, authorize, now: clock.now }),
      };
    };
    const manager = commands(cancelling),
      invitee = commands(accepting);
    const created = await manager.send(as(director), {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-organization',
        kind: 'school',
        name: 'A School',
        handle: `school-${createId().slice(0, 10)}`,
      },
    });
    if (created.kind !== 'accepted') throw new Error('School creation refused');
    const organizationId = created.receipt.aggregate.id;
    const invite = async () => {
      const view = await manager.people(as(director), organizationId);
      if (!view) throw new Error('People read denied');
      const answer = await manager.send(as(director), {
        version: 1,
        commandId: createId(),
        expected: { organization: view.version },
        command: {
          type: 'invite-member',
          organizationId,
          userId: member.userId,
        },
      });
      if (answer.kind !== 'accepted') throw new Error('Invitation refused');
      return manager.people(as(director), organizationId);
    };
    const first = await invite();
    if (!first) throw new Error('Invited people read denied');
    const displayed = first.people.find((row) => row.userId === member.userId);
    assert({
      given: 'the actual invited member read',
      should: 'display its persisted invitation guard',
      actual: displayed?.membershipVersion,
      expected: 1,
    });
    const cancellation = {
      version: 1,
      commandId: createId(),
      expected: { membership: displayed?.membershipVersion },
      command: {
        type: 'cancel-membership-invitation',
        organizationId,
        userId: member.userId,
      },
    };
    assert({
      given: 'an unrelated account',
      should: 'deny cancellation before mutation',
      actual: await deniedAsNotFound(() =>
        manager.send(as(outsider), cancellation),
      ),
      expected: true,
    });
    assert({
      given: 'a cancellation without its displayed lifecycle guard',
      should: 'refuse rather than refresh the guard at submission',
      actual: await manager.send(as(director), {
        ...cancellation,
        commandId: createId(),
        expected: {},
      }),
      expected: { kind: 'refused', refusal: 'version-conflict' },
    });
    const cancelled = await manager.send(as(director), cancellation);
    if (cancelled.kind !== 'accepted') throw new Error('Cancellation refused');
    const replayed = {
      ...cancelled,
      receipt: { ...cancelled.receipt, replayed: true },
    };
    assert({
      given: 'the displayed pending invitation',
      should: 'cancel it once and replay the original receipt',
      actual: [cancelled.kind, await manager.send(as(director), cancellation)],
      expected: ['accepted', replayed],
    });
    const [ended] =
      await owner`select status,version,ended_at is not null as ended from memberships where organization_id=${organizationId} and user_id=${member.userId}`;
    const [grants] =
      await owner`select count(*)::int as count from grants where organization_id=${organizationId} and user_id=${member.userId}`;
    assert({
      given: 'a manager cancellation',
      should:
        'end only that invitation with a version and timestamp and no grants',
      actual: [ended, grants],
      expected: [{ status: 'ended', version: 2, ended: true }, { count: 0 }],
    });
    const reinvited = await invite();
    if (!reinvited) throw new Error('Reinvited people read denied');
    const fresh = reinvited.people.find((row) => row.userId === member.userId);
    assert({
      given: 'a distinct reinvitation after cancellation',
      should:
        'reject a stale displayed version while replay keeps the original effect',
      actual: [
        fresh?.membershipVersion,
        await manager.send(as(director), {
          ...cancellation,
          commandId: createId(),
        }),
        await manager.send(as(director), cancellation),
      ],
      expected: [3, { kind: 'refused', refusal: 'version-conflict' }, replayed],
    });
    const raced = await Promise.allSettled([
      manager.send(as(director), {
        ...cancellation,
        commandId: createId(),
        expected: { membership: fresh?.membershipVersion },
      }),
      invitee.send(as(member), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: { type: 'accept-membership', organizationId },
      }),
    ]);
    const [settled] =
      await owner`select status,version from memberships where organization_id=${organizationId} and user_id=${member.userId}`;
    assert({
      given:
        'acceptance and cancellation on separate real database connections',
      should: 'commit exactly one transition from that invitation',
      actual: [
        raced.filter(
          (answer) =>
            answer.status === 'fulfilled' && answer.value.kind === 'accepted',
        ).length,
        raced.filter((answer) =>
          answer.status === 'fulfilled'
            ? answer.value.kind === 'refused'
            : answer.reason instanceof CommandDenied,
        ).length,
        settled?.version,
        settled?.status === 'active' || settled?.status === 'ended',
      ],
      expected: [1, 1, 4, true],
    });
  } finally {
    await Promise.all([owner.close(), cancelling.close(), accepting.close()]);
  }
});
