import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
  withRuntimeTestTransaction,
} from '@daisy/db/testing';
import { createTabStore, type TabStore } from '@daisy/db/tab';
import { createAppError, isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { tournamentSponsorshipCommand } from '../src/features/tab/operations/tournament-sponsorship';
import { organizationStage } from './tab-tournament-organization.test-support';
import { createOwnedTournament } from './tab-tournament-owned-event.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { seedHostingGrant } from './tab-hosting-grant.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const envelope = (lobby: number, command: unknown) => ({
  version: 1,
  commandId: createId(),
  expected: { lobby },
  command,
});

test('organization sponsorship requires actual dual consent, retains transfer history and serializes competing withdrawal atomically', async () => {
  const scratch = scratchDatabase(databaseUrl, 'sponsorship');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 5 });
  try {
    await scratch.migrate(() => true);
    const bots = Object.fromEntries(
      (
        await createBots(owner, [
          'Director',
          'Staff',
          'Coach',
          'Funder',
          'Other funder',
        ])
      ).map((bot) => [bot.name, bot]),
    );
    const setup = await withRuntimeTestTransaction(owner, async (frame) => {
      const world = {
        ...frame,
        bots,
        clock: scriptClock(),
        made: new Map<string, string>(),
      };
      await organizationStage(world);
      return createOwnedTournament(world);
    });
    const lobbyId = setup.lobbyId,
      director = bots.Director!,
      funder = bots.Funder!,
      other = bots['Other funder']!;
    const store = createTabStore(committingRuntimeTestDatabase(owner));
    const send = tournamentSponsorshipCommand({
      store,
      authorize,
      newId: createId,
    });
    const propose = envelope(setup.version, {
      type: 'propose-tournament-sponsorship',
      lobbyId,
      sponsorUserId: funder.userId,
    });
    assert({
      given:
        'an actual unrelated funding account without organization authority',
      should: 'not authorize its own proposal on behalf of the organization',
      actual: await deniedAsNotFound(() => send(as(funder), propose)),
      expected: true,
    });
    const proposed = await send(as(director), propose);
    if (proposed.kind !== 'accepted')
      throw new Error('organization proposal refused');
    const [proposal] =
      await owner`select id,kind,sponsor_user_id from tournament_sponsorship_versions where lobby_id=${lobbyId}`;
    assert({
      given: 'the organization owner’s actual accepted proposal',
      should:
        'hold only proposed direction and never synthesize acceptance or a payer actor',
      actual: proposal,
      expected: {
        id: String(proposal!.id),
        kind: 'proposed',
        sponsor_user_id: funder.userId,
      },
    });
    const versionId = await owner.begin((sql) =>
      seedHostingGrant(sql, funder.userId, {
        tournamentIds: [lobbyId],
        issuerOperatorRef: createId(),
      }),
    );
    const consent = envelope(proposed.receipt.resultingVersion, {
      type: 'accept-tournament-sponsorship',
      lobbyId,
      proposalId: String(proposal!.id),
      hostingVersionId: versionId,
    });
    assert({
      given:
        'the organization owner and another funding account attempting to accept the named account’s commitment',
      should: 'deny both despite owner authority and an existing valid source',
      actual: [
        await deniedAsNotFound(() => send(as(director), consent)),
        await deniedAsNotFound(() => send(as(other), consent)),
      ],
      expected: [true, true],
    });
    const accepted = await send(as(funder), consent);
    if (accepted.kind !== 'accepted')
      throw new Error('actual own consent refused');
    const replay = await send(as(funder), consent);
    const [active] =
      await owner`select kind,sponsor_user_id,acted_by_user_id,previous_version_id,hosting_version_id from tournament_sponsorship_versions where lobby_id=${lobbyId} and kind='active'`;
    assert({
      given:
        'a non-staff adult funding account accepting its actual organization proposal',
      should:
        'freeze its separate current covered version, retain proposal and replay one effect',
      actual: {
        active,
        replay,
        history: Number(
          (
            await owner`select count(*)::int as n from action_history where command_id=${consent.commandId}`
          )[0]!.n,
        ),
      },
      expected: {
        active: {
          kind: 'active',
          sponsor_user_id: funder.userId,
          acted_by_user_id: funder.userId,
          previous_version_id: String(proposal!.id),
          hosting_version_id: versionId,
        },
        replay: {
          ...accepted,
          receipt: { ...accepted.receipt, replayed: true },
        },
        history: 1,
      },
    });
    const before = accepted.receipt.resultingVersion;
    const [transfer, withdrawal] = await Promise.all([
      send(
        as(director),
        envelope(before, {
          type: 'propose-tournament-sponsorship',
          lobbyId,
          sponsorUserId: other.userId,
        }),
      ),
      send(
        as(funder),
        envelope(before, {
          type: 'revoke-tournament-sponsorship',
          lobbyId,
          reason: 'Withdraw current sponsorship',
        }),
      ),
    ]);
    assert({
      given:
        'real separate committed requests for transfer and funding-account withdrawal at one lobby version',
      should:
        'serialize one accepted direction, one refusal and retain both original proposal and active source',
      actual: {
        accepted: [transfer, withdrawal].filter(
          (answer) => answer.kind === 'accepted',
        ).length,
        refused: [transfer, withdrawal].filter(
          (answer) => answer.kind === 'refused',
        ).length,
        versions: Number(
          (
            await owner`select count(*)::int as n from tournament_sponsorship_versions where lobby_id=${lobbyId}`
          )[0]!.n,
        ),
        originals: Number(
          (
            await owner`select count(*)::int as n from tournament_sponsorship_versions where lobby_id=${lobbyId} and version in(1,2)`
          )[0]!.n,
        ),
      },
      expected: { accepted: 1, refused: 1, versions: 3, originals: 2 },
    });
    const [current] =
      await owner`select version from lobbies where id=${lobbyId}`;
    const state = async () =>
      JSON.stringify(
        (
          await owner`select (select version from lobbies where id=${lobbyId}) as lobby,(select jsonb_agg(to_jsonb(v) order by version) from tournament_sponsorship_versions v where lobby_id=${lobbyId}) as versions,(select count(*)::int from action_history where lobby_id=${lobbyId}) as history`
        )[0],
      );
    const unchanged = await state();
    const rollbackStore: Pick<TabStore, 'tournamentSponsorshipCommand'> = {
      tournamentSponsorshipCommand: (input, work) =>
        store.tournamentSponsorshipCommand(input, (session) =>
          work({
            ...session,
            apply: async (...args) => {
              await session.apply(...args);
              throw createAppError('INFRASTRUCTURE');
            },
          }),
        ),
    };
    let rolledBack = false;
    try {
      await tournamentSponsorshipCommand({
        store: rollbackStore,
        authorize,
        newId: createId,
      })(
        as(director),
        envelope(Number(current!.version), {
          type: 'propose-tournament-sponsorship',
          lobbyId,
          sponsorUserId: other.userId,
        }),
      );
    } catch (error) {
      if (!isAppError(error) || error.code !== 'INFRASTRUCTURE') throw error;
      rolledBack = true;
    }
    assert({
      given:
        'an injected failure after actual sponsorship, version and command history writes',
      should: 'rollback every effect without dropping prior funding history',
      actual: [rolledBack, unchanged === (await state())],
      expected: [true, true],
    });
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 60_000);
