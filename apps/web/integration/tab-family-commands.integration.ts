import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import {
  erasePrivacySubject,
  subjectRightsVerificationBindings,
} from '@daisy/db/privacy';
import { activeRoomMembers, closeRoom, eraseSeats } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { guardianCommand } from '../src/features/tab/operations/guardian';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { readFamilyHistory } from '../src/features/tab/reads/family-history';
import { readOrganizationPeople } from '../src/features/tab/reads/organization-people';
import { createFamilyHistoryRoute } from '../src/features/tab/family-history-route';
import { createTabCommandRoute } from '../src/features/tab/command-route';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { origin } from '../src/server/member-boundary.test-support';
import { noopErrorReporter } from '@daisy/observability';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('test-only family commands attribute the protected subject and cannot revive a closed guardian', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const bots = await createBots(sql, [
        'Parent',
        'Second parent',
        'Coach',
        'Other guardian',
        'Minor',
        'Other minor',
      ]);
      for (const bot of bots.filter(
        (bot) => bot.name.includes('minor') || bot.name === 'Minor',
      ))
        await sql`update account_age set birth_month=${`${new Date().getUTCFullYear() - 17}-01`} where user_id=${bot.userId}`;
      return Object.fromEntries(bots.map((bot) => [bot.name, bot]));
    },
    work: async (database, bots, sql) => {
      const clock = scriptClock(),
        store = createTabStore(database),
        common = { store, authorize, now: clock.now, newId: createId };
      let loaded = false;
      const closedStore: Pick<typeof store, 'guardianCommand'> = {
        guardianCommand: (input, work) => {
          loaded = true;
          return store.guardianCommand(input, work);
        },
      };
      const closed = guardianCommand({
        ...common,
        store: closedStore,
        minorsReleased: async () => false,
        consentNoticeVersion: null,
      });
      const noNotice = guardianCommand({
        ...common,
        store: closedStore,
        minorsReleased: async () => true,
        consentNoticeVersion: null,
      });
      assert({
        given:
          'the closed production policy and separately no approved consent notice',
        should: 'refuse before parsing a body or loading family state',
        actual: [
          await deniedAsNotFound(() =>
            closed(as(bots.Parent!), bots.Minor!.userId, {}),
          ),
          await deniedAsNotFound(() =>
            noNotice(as(bots.Parent!), bots.Minor!.userId, {}),
          ),
          loaded,
        ],
        expected: [true, true, false],
      });
      // Test-only owner privilege and notice fixture. No runtime privilege, consent evidence or release is changed.
      await sql`reset role`;
      const send = guardianCommand({
        ...common,
        minorsReleased: async () => true,
        consentNoticeVersion: 1,
      });
      const make = {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-guardian-link',
          guardianUserId: bots.Parent!.userId,
          wardUserId: bots.Minor!.userId,
          through: { kind: 'direct' },
        },
      };
      const made = await send(as(bots.Parent!), bots.Minor!.userId, make);
      if (made.kind !== 'accepted')
        throw new Error('Test family proposal refused');
      const linkId = made.receipt.aggregate.id;
      assert({
        given:
          'a different protected-person address on a new proposal and an existing link command',
        should: 'refuse both before attributing any action to the wrong person',
        actual: [
          await deniedAsNotFound(() =>
            send(as(bots.Parent!), bots['Other minor']!.userId, make),
          ),
          await deniedAsNotFound(() =>
            send(as(bots.Parent!), bots['Other minor']!.userId, {
              version: 1,
              commandId: createId(),
              expected: { guardianLink: 1 },
              command: {
                type: 'consent-guardian-link',
                guardianLinkId: linkId,
                noticeVersion: 1,
              },
            }),
          ),
        ],
        expected: [true, true],
      });
      assert({
        given: 'the same actual family proposal retried',
        should: 'return its original receipt once',
        actual: await send(as(bots.Parent!), bots.Minor!.userId, make),
        expected: { ...made, receipt: { ...made.receipt, replayed: true } },
      });
      const history = readFamilyHistory({
        ...common,
        minorsReleased: async () => true,
      });
      assert({
        given: 'a pending relationship before test-only consent',
        should: 'withhold the full protected-person history',
        actual: await history(as(bots.Parent!), {
          guardianLinkId: linkId,
          subjectUserId: bots.Minor!.userId,
        }),
        expected: null,
      });
      const consent = await send(as(bots.Parent!), bots.Minor!.userId, {
        version: 1,
        commandId: createId(),
        expected: { guardianLink: 1 },
        command: {
          type: 'consent-guardian-link',
          guardianLinkId: linkId,
          noticeVersion: 1,
        },
      });
      if (consent.kind !== 'accepted')
        throw new Error('Test consent transition refused');
      const add = await send(as(bots.Parent!), bots.Minor!.userId, {
        version: 1,
        commandId: createId(),
        expected: { guardianLink: 2 },
        command: {
          type: 'add-guardian',
          guardianLinkId: linkId,
          guardianUserId: bots['Second parent']!.userId,
        },
      });
      if (add.kind !== 'accepted')
        throw new Error('Second test parent refused');
      const secondId = add.receipt.aggregate.id;
      const secondConsent = await send(
        as(bots['Second parent']!),
        bots.Minor!.userId,
        {
          version: 1,
          commandId: createId(),
          expected: { guardianLink: 1 },
          command: {
            type: 'consent-guardian-link',
            guardianLinkId: secondId,
            noticeVersion: 1,
          },
        },
      );
      if (secondConsent.kind !== 'accepted')
        throw new Error('Second test consent refused');
      const lobby = await lobbyAdministrationCommand({
        ...common,
        hostingPlan: async () => true,
      })(as(bots.Parent!), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-lobby',
          owner: { kind: 'self' },
          name: 'Allowed test lobby',
          handle: `family-${createId()}`,
          lobby: { kind: 'tournament', admitsMinors: true },
        },
      });
      if (lobby.kind !== 'accepted')
        throw new Error('Allowed test lobby refused');
      const restriction = await send(as(bots.Parent!), bots.Minor!.userId, {
        version: 1,
        commandId: createId(),
        expected: { guardianLink: 2 },
        command: {
          type: 'set-restriction',
          guardianLinkId: linkId,
          limitsLobbies: true,
          allowedLobbyIds: [lobby.receipt.aggregate.id],
          videoCap: 'officials',
        },
      });
      if (restriction.kind !== 'accepted')
        throw new Error('Test restriction refused');
      const organization = organizationCommand({
        ...common,
        hostingPlan: async () => false,
      });
      const school = await organization(as(bots.Coach!), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-organization',
          kind: 'school',
          name: 'Family proof school',
          handle: `family-school-${createId().slice(0, 10)}`,
        },
      });
      if (school.kind !== 'accepted') throw new Error('Actual school refused');
      const organizationId = school.receipt.aggregate.id;
      const invitation = await organization(as(bots.Coach!), {
        version: 1,
        commandId: createId(),
        expected: { organization: 1 },
        command: {
          type: 'invite-member',
          organizationId,
          userId: bots['Other guardian']!.userId,
        },
      });
      if (invitation.kind !== 'accepted')
        throw new Error('Actual guardian membership invitation refused');
      const membership = await organization(as(bots['Other guardian']!), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: { type: 'accept-membership', organizationId },
      });
      if (membership.kind !== 'accepted')
        throw new Error('Actual guardian membership refused');
      const paidOrganization = organizationCommand({
        ...common,
        hostingPlan: async () => true,
      }); // Test entitlement only.
      const league = await paidOrganization(as(bots.Coach!), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-organization',
          kind: 'league',
          name: 'Not a school',
          handle: `family-league-${createId().slice(0, 10)}`,
        },
      });
      if (league.kind !== 'accepted')
        throw new Error('Actual non-school fixture refused');
      const leagueId = league.receipt.aggregate.id;
      const leagueInvitation = await organization(as(bots.Coach!), {
        version: 1,
        commandId: createId(),
        expected: { organization: 1 },
        command: {
          type: 'invite-member',
          organizationId: leagueId,
          userId: bots['Other guardian']!.userId,
        },
      });
      if (leagueInvitation.kind !== 'accepted')
        throw new Error('Actual non-school invitation refused');
      const leagueMembership = await organization(as(bots['Other guardian']!), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: { type: 'accept-membership', organizationId: leagueId },
      });
      if (leagueMembership.kind !== 'accepted')
        throw new Error('Actual non-school membership refused');
      assert({
        given:
          'a real league with the proposed guardian actively enrolled, addressed as a school',
        should: 'hide the wrong organization kind before any family write',
        actual: await deniedAsNotFound(() =>
          send(as(bots.Coach!), bots.Minor!.userId, {
            version: 1,
            commandId: createId(),
            expected: {},
            command: {
              type: 'create-guardian-link',
              guardianUserId: bots['Other guardian']!.userId,
              wardUserId: bots.Minor!.userId,
              through: { kind: 'school', organizationId: leagueId },
            },
          }),
        ),
        expected: true,
      });
      const proposed = {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-guardian-link',
          guardianUserId: bots['Other guardian']!.userId,
          wardUserId: bots.Minor!.userId,
          through: { kind: 'school', organizationId },
        },
      };
      const proposedAnswer = await send(
        as(bots.Coach!),
        bots.Minor!.userId,
        proposed,
      );
      if (proposedAnswer.kind !== 'accepted')
        throw new Error('Actual coach proposal refused');
      const boundary = await store.guardianCommand(
        {
          senderUserId: bots.Parent!.userId,
          subjectUserId: bots.Minor!.userId,
          command: {
            type: 'set-restriction',
            guardianLinkId: linkId,
            limitsLobbies: true,
            allowedLobbyIds: [lobby.receipt.aggregate.id],
            videoCap: 'officials',
          },
          newId: createId(),
        },
        async (session) => (await session.load())?.ward?.boundary,
      );
      assert({
        given: 'a restriction written through the actual family command',
        should: 'flow into the canonical account boundary under the ward scope',
        actual: boundary && {
          allowed: boundary.allowedLobbyIds,
          entered: boundary.entryLobbyIds,
        },
        expected: { allowed: [lobby.receipt.aggregate.id], entered: [] },
      });
      const view = await history(as(bots['Second parent']!), {
        guardianLinkId: secondId,
        subjectUserId: bots.Minor!.userId,
      });
      const [record] =
        await sql`select organization_id,lobby_id,subject_person_user_id,actor_user_id from action_history where command_id=${proposed.commandId}`;
      assert({
        given:
          'a school owner proposing another guardian while two parents share the same protected subject',
        should:
          'attribute the actor separately, keep one person journal, deny organization-only and wrong-subject reads, and preserve closed policy',
        actual: [
          record && { ...record },
          view?.entries.length,
          view?.entries.some(
            (entry) =>
              entry.commandId === proposed.commandId &&
              entry.actorUserId === bots.Coach!.userId,
          ),
          (await readOrganizationPeople(common)(
            as(bots.Coach!),
            organizationId,
          )) !== null,
          await history(as(bots.Coach!), {
            guardianLinkId: secondId,
            subjectUserId: bots.Minor!.userId,
          }),
          await history(as(bots.Parent!), {
            guardianLinkId: linkId,
            subjectUserId: bots['Other minor']!.userId,
          }),
          await readFamilyHistory({
            ...common,
            minorsReleased: async () => false,
          })(as(bots.Parent!), {
            guardianLinkId: linkId,
            subjectUserId: bots.Minor!.userId,
          }),
        ],
        expected: [
          {
            organization_id: null,
            lobby_id: null,
            subject_person_user_id: bots.Minor!.userId,
            actor_user_id: bots.Coach!.userId,
          },
          6,
          true,
          true,
          null,
          null,
          null,
        ],
      });
      const guardian = bots['Other guardian']!;
      const changedNotice = await send(as(guardian), bots.Minor!.userId, {
        version: 1,
        commandId: createId(),
        expected: { guardianLink: 1 },
        command: {
          type: 'consent-guardian-link',
          guardianLinkId: proposedAnswer.receipt.aggregate.id,
          noticeVersion: 2,
        },
      });
      const stale = await send(as(bots.Parent!), bots.Minor!.userId, {
        version: 1,
        commandId: createId(),
        expected: { guardianLink: 2 },
        command: {
          type: 'set-restriction',
          guardianLinkId: linkId,
          limitsLobbies: false,
          allowedLobbyIds: [],
          videoCap: 'lobby',
        },
      });
      assert({
        given:
          'an obsolete notice and an obsolete displayed relationship guard',
        should: 'refuse both without a family write',
        actual: [changedNotice, stale],
        expected: [
          { kind: 'refused', refusal: 'notice-changed' },
          { kind: 'refused', refusal: 'version-conflict' },
        ],
      });
      const httpBoundary = {
        logger: silentLogger,
        reporter: noopErrorReporter,
        origin: () => origin,
        identify: async () => ({
          state: 'member' as const,
          username: bots['Second parent']!.name,
          principal: {
            kind: 'user' as const,
            userId: bots['Second parent']!.userId,
            actorId: bots['Second parent']!.actorId,
          },
        }),
      };
      const get = createFamilyHistoryRoute({
        boundary: httpBoundary,
        released: async () => true,
        read: history,
      });
      const path = `http://proof.invalid/api/tab/family-history?${new URLSearchParams({ guardianLinkId: secondId, subjectUserId: bots.Minor!.userId })}`;
      const shown = await get(new Request(path));
      const hidden = await createFamilyHistoryRoute({
        boundary: httpBoundary,
        released: async () => false,
        read: history,
      })(new Request('http://proof.invalid/api/tab/family-history?invalid=1'));
      const post = createTabCommandRoute({
        boundary: httpBoundary,
        released: async () => true,
        name: 'tab.guardian.command',
        address: 'person',
        execute: closed,
      });
      const refusedPost = await post(
        new Request(
          `http://proof.invalid/api/tab/guardian-command?subjectUserId=${bots.Minor!.userId}`,
          {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: JSON.stringify(make),
          },
        ),
      );
      assert({
        given:
          'the same actual family read through HTTP and the independent closed write policy',
        should:
          'serve only the authorized fixture view without caching and keep the closed boundaries at404',
        actual: [
          shown.status,
          shown.headers.get('cache-control'),
          (await shown.json()).entries.length,
          hidden.status,
          refusedPost.status,
        ],
        expected: [200, 'no-store', 6, 404, 404],
      });
      await erasePrivacySubject(
        database,
        {
          subject: { userId: guardian.userId, actorId: guardian.actorId },
          now: clock.now(),
          vendors: [],
          jobIds: [],
        },
        { closeRoom, eraseSeats, activeRoomMembers },
        subjectRightsVerificationBindings,
      );
      const late = await deniedAsNotFound(() =>
        send(as(guardian), bots.Minor!.userId, {
          version: 1,
          commandId: createId(),
          expected: { guardianLink: 1 },
          command: {
            type: 'consent-guardian-link',
            guardianLinkId: proposedAnswer.receipt.aggregate.id,
            noticeVersion: 1,
          },
        }),
      );
      const [after] =
        await sql`select status from guardian_links where id=${proposedAnswer.receipt.aggregate.id}`;
      const entries =
        await sql`select command_id from action_history where subject_person_user_id=${bots.Minor!.userId}`;
      assert({
        given:
          'the proposed guardian actually closed through every existing subject-rights adopter',
        should:
          'refuse later activation without resurrecting a relationship or appending a receipt',
        actual: [late, after?.status, entries.length],
        expected: [true, 'pending', 6],
      });
    },
  });
});
