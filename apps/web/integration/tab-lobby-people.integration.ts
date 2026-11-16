import { requireTestServices } from '@daisy/config';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { hostNavigationRail } from '../src/features/tab/host-navigation';
import { resolveLobbyGrantTarget } from '../src/features/tab/lobby-grant-target';
import { readHostNavigation } from '../src/features/tab/reads/host-navigation';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots } from './tab-tournament.test-support';
import { lobbyPeopleFrame } from './tab-lobby-people.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('the personal lobby People HTTP read binds exact grants, current guards and delegated authority', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const bots = await createBots(sql, [
        'Owner',
        'Delegate',
        'Staff',
        'Outsider',
        'Other staff',
      ]);
      await sql`update account_age set birth_month=${`${new Date().getUTCFullYear() - 14}-01`}, version=version+1 where user_id=${bots[3]!.userId}`;
      return bots;
    },
    work: async (database, bots, sql) => {
      const {
        owner,
        delegate,
        staff,
        outsider,
        otherStaff,
        common,
        lobbyId,
        otherId,
        get,
        send,
        grant,
        people,
        targets,
        discoverySpends,
        membershipCount,
      } = await lobbyPeopleFrame(database, bots, sql, databaseUrl);
      const original = await people(owner);
      assert({
        given:
          'a personal owner reading People through HTTP without an organization',
        should:
          'see its exact lobby and current guard, with no invented organization membership',
        actual: [
          original.lobbyId,
          original.version,
          original.capabilities.give,
          original.people.map((one) => [one.userId, one.owner]),
          [
            await membershipCount(owner.userId),
            await membershipCount(delegate.userId),
            await membershipCount(staff.userId),
          ],
        ],
        expected: [lobbyId, 1, true, [[owner.userId, true]], [0, 0, 0]],
      });
      const delegated = await send(
        owner,
        grant(lobbyId, delegate.userId, 'Director'),
        original.version,
      );
      const foreign = await send(
        owner,
        grant(otherId, otherStaff.userId, 'Staff'),
        1,
      );
      assert({
        given: 'the personal owner assigning staff at two lobbies',
        should:
          'accept both exact-lobby grants over the existing command HTTP boundary',
        actual: [delegated.answer.kind, foreign.answer.kind],
        expected: ['accepted', 'accepted'],
      });
      const viewed = await people(delegate);
      const nav = await readHostNavigation(common)(as(delegate), {
        kind: 'lobby',
        id: lobbyId,
      });
      assert({
        given: 'a nonmember with a Director grant only at this lobby',
        should:
          'receive the People rail and only this lobby’s people, with canonically bounded roles',
        actual: [
          viewed.capabilities.give,
          viewed.people.map((one) => one.userId).sort(),
          viewed.roles.find((one) => one.name === 'Staff')?.giveable,
          viewed.roles.find((one) => one.name === 'Director')?.giveable,
          viewed.roles.find((one) => one.name === 'Coach')?.giveable,
          nav && hostNavigationRail(nav).foot.map((one) => one.id),
          (await get(delegate, otherId)).status,
        ],
        expected: [
          true,
          [owner.userId, delegate.userId].sort(),
          true,
          false,
          false,
          ['people'],
          404,
        ],
      });
      const targetUserId = await resolveLobbyGrantTarget(
        as(delegate),
        {
          lobbyId,
          username: ` BOT-${staff.userId.toUpperCase()} `,
        },
        targets,
      );
      assert({
        given:
          'a current lobby manager looking up a username outside every organization',
        should:
          'resolve its active human account through budgeted discovery before giving the role',
        actual: [targetUserId, discoverySpends],
        expected: [
          staff.userId,
          [10, 60, 3600].map(
            (seconds) => `username-discovery:${delegate.actorId}:${seconds}`,
          ),
        ],
      });
      if (!targetUserId) throw new Error('Actual username target unavailable');
      const grantCommandId = createId();
      const assigned = await send(
        delegate,
        grant(lobbyId, targetUserId, 'Staff'),
        viewed.version,
        grantCommandId,
      );
      const refreshed = await people(delegate);
      const assignedPerson = refreshed.people.find(
        (one) => one.userId === staff.userId,
      );
      assert({
        given:
          'a delegate assigning a lower role within its held permissions to a nonmember',
        should:
          'persist and refresh the exact grant and a removable person using the new guard',
        actual: [
          assigned.answer.kind,
          refreshed.version,
          assignedPerson?.grants.length,
          assignedPerson?.removable,
          await membershipCount(staff.userId),
        ],
        expected: ['accepted', viewed.version + 1, 1, true, 0],
      });
      const retryTarget = await resolveLobbyGrantTarget(
        as(delegate),
        {
          lobbyId,
          username: `bot-${staff.userId}`,
        },
        targets,
      );
      if (!retryTarget)
        throw new Error('Current username retry target unavailable');
      const replayed = await send(
        delegate,
        grant(lobbyId, retryTarget, 'Staff'),
        viewed.version,
        grantCommandId,
      );
      const afterReplay = await people(delegate);
      assert({
        given: 'a lost response after giving a role moved the lobby guard',
        should:
          'resolve the username again and replay the identical command without another grant or version',
        actual: [
          replayed.answer,
          afterReplay.version,
          afterReplay.people.find((one) => one.userId === staff.userId)?.grants
            .length,
        ],
        expected: [
          {
            ...assigned.answer,
            receipt: { ...assigned.answer.receipt, replayed: true },
          },
          refreshed.version,
          1,
        ],
      });
      const deniedLookup = await resolveLobbyGrantTarget(
        as(delegate),
        {
          lobbyId: otherId,
          username: `bot-${outsider.userId}`,
        },
        targets,
      );
      assert({
        given: 'a role manager probing a recipient in an unauthorized lobby',
        should: 'refuse before spending any more username discovery budget',
        actual: [deniedLookup, discoverySpends.length],
        expected: [null, 6],
      });
      const stale = await send(
        delegate,
        grant(lobbyId, outsider.userId, 'Staff'),
        viewed.version,
      );
      const equal = await send(
        delegate,
        grant(lobbyId, outsider.userId, 'Director'),
        refreshed.version,
      );
      const unheld = await send(
        delegate,
        grant(lobbyId, outsider.userId, 'Coach'),
        refreshed.version,
      );
      const otherScope = await send(
        delegate,
        grant(otherId, outsider.userId, 'Staff'),
        2,
      );
      const foreignPeople = await people(owner, otherId);
      const foreignGrantId = foreignPeople.people.find(
        (one) => one.userId === otherStaff.userId,
      )!.grants[0]!.grantId;
      const foreignRemoval = await send(
        owner,
        {
          type: 'remove-grant',
          scope: { kind: 'lobby', lobbyId },
          grantId: foreignGrantId,
        },
        refreshed.version,
      );
      assert({
        given:
          'stale guards, equal or unheld roles, and cross-lobby targets or grant IDs',
        should:
          'refuse every attempt without altering either lobby or disclosing foreign People',
        actual: [
          stale.answer,
          equal.status,
          unheld.status,
          otherScope.status,
          foreignRemoval.answer.kind,
          (await people(delegate)).version,
          (await people(owner, otherId)).version,
          (await people(owner)).people.filter(
            (one) => one.userId === outsider.userId,
          ).length,
        ],
        expected: [
          { kind: 'refused', refusal: 'version-conflict' },
          404,
          404,
          404,
          'refused',
          refreshed.version,
          2,
          0,
        ],
      });
      const underage = await send(
        owner,
        grant(lobbyId, outsider.userId, 'Staff'),
        refreshed.version,
      );
      assert({
        given:
          'a valid owner giving Staff to a recipient below staff.minimum_band',
        should:
          'return its canonical refusal reason and leave the lobby guard unchanged',
        actual: [underage.answer, (await people(owner)).version],
        expected: [{ kind: 'refused', refusal: 'age-band' }, refreshed.version],
      });
      const staffNav = await readHostNavigation(common)(as(staff), {
        kind: 'lobby',
        id: lobbyId,
      });
      assert({
        given:
          'a Staff role with no People authority and an unrelated signed-in viewer',
        should:
          'conceal People in both the HTTP response and host rail, and honor the closed release',
        actual: [
          (await get(staff)).status,
          staffNav && hostNavigationRail(staffNav).foot,
          (await get(outsider)).status,
          (await get(owner, lobbyId, false)).status,
          (await get(owner)).headers.get('cache-control'),
        ],
        expected: [404, [], 404, 404, 'no-store'],
      });
      const removed = await send(
        delegate,
        {
          type: 'remove-grant',
          scope: { kind: 'lobby', lobbyId },
          grantId: assignedPerson!.grants[0]!.grantId,
        },
        refreshed.version,
      );
      const afterRemoval = await people(delegate);
      const ownGrantId = afterRemoval.people.find(
        (one) => one.userId === delegate.userId,
      )!.grants[0]!.grantId;
      const revoked = await send(
        owner,
        {
          type: 'remove-grant',
          scope: { kind: 'lobby', lobbyId },
          grantId: ownGrantId,
        },
        afterRemoval.version,
      );
      const revokedLookup = await resolveLobbyGrantTarget(
        as(delegate),
        {
          lobbyId,
          username: `bot-${outsider.userId}`,
        },
        targets,
      );
      assert({
        given: 'a formerly authorized delegate after revocation',
        should: 'never probe another username after losing authority',
        actual: [revokedLookup, discoverySpends.length],
        expected: [null, 6],
      });
      const revokedWrite = await send(
        delegate,
        grant(lobbyId, outsider.userId, 'Staff'),
        afterRemoval.version + 1,
      );
      assert({
        given:
          'a lower role removed by its delegate, then the delegate’s authority revoked by the owner',
        should:
          'remove the ended staff from the read and revoke the delegate’s read, rail and next command immediately',
        actual: [
          removed.answer.kind,
          afterRemoval.people.some((one) => one.userId === staff.userId),
          revoked.answer.kind,
          (await get(delegate)).status,
          await readHostNavigation(common)(as(delegate), {
            kind: 'lobby',
            id: lobbyId,
          }),
          revokedWrite.status,
          (await people(owner)).people.map((one) => one.userId),
          (await people(owner, otherId)).people
            .find((one) => one.userId === otherStaff.userId)
            ?.grants.map((one) => one.grantId),
        ],
        expected: [
          'accepted',
          false,
          'accepted',
          404,
          null,
          404,
          [owner.userId],
          [foreignGrantId],
        ],
      });
    },
  });
});
