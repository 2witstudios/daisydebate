import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { requireTestServices } from '@daisy/config';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationStage } from './tab-tournament-organization.test-support';
import { CommandDenied } from '../src/features/tab/commands/run-command';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { as } from './tab-tournament-organization-wiring.test-support';

import { createBots, scriptClock } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('league lobby administration persists under its tenant fence', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, ['Director', 'Staff', 'Coach']),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        clock: scriptClock(),
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        made: new Map<string, string>(),
      };
      await organizationStage(world);
      await leagueAdministrationStage(world);
    },
  });
});

test('sibling standing lobbies own independent age rules', async () => {
  const organizationId = createId();
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const [director] = await createBots(sql, ['Director']);
      await sql`insert into organizations (id, kind, name, handle, owner_user_id)
        values (${organizationId}, 'league', 'Debate league', ${organizationId}, ${director!.userId})`;
      return director!;
    },
    work: async (database, director, sql) => {
      const create = lobbyAdministrationCommand({
        store: createTabStore(database),
        authorize,
        now: scriptClock().now,
        newId: createId,
      });
      const rules = [];
      for (const ageRule of [undefined, 'anyone', 'under-18'] as const) {
        const handle = createId();
        const reply = await create(as(director), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-lobby',
            owner: { kind: 'organization', organizationId },
            name: handle,
            handle,
            lobby: { kind: 'standing', ...(ageRule ? { ageRule } : {}) },
          },
        });
        if (reply.kind !== 'accepted') throw new Error(JSON.stringify(reply));
        const [row] =
          await sql`select age_rule from lobbies where id=${reply.receipt.aggregate.id}`;
        rules.push(row?.age_rule);
      }
      assert({
        given: 'three new standing lobbies in the same league',
        should: 'persist the default or each lobby’s explicit age rule',
        actual: rules,
        expected: ['adults', 'anyone', 'under-18'],
      });
    },
  });
});

test('standing-lobby management keeps ladder identities and season history in the owning league', async () => {
  const organizationId = createId();
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const [director, other] = await createBots(sql, [
        'Director',
        'Unrelated host',
      ]);
      await sql`insert into organizations (id, kind, name, handle, owner_user_id)
        values (${organizationId}, 'league', 'Debate league', ${organizationId}, ${director!.userId})`;
      return { director: director!, other: other! };
    },
    work: async (database, { director, other }, sql) => {
      const store = createTabStore(database);
      const administer = lobbyAdministrationCommand({
        store,
        authorize,
        now: scriptClock().now,
        newId: createId,
      });
      const send = (
        command: import('@daisy/protocol/lobby/lobby-setup-command').LobbyCommand,
        expected: import('@daisy/protocol/lobby/command').CommandExpected = {},
        person = director,
      ) =>
        administer(as(person), {
          version: 1,
          commandId: createId(),
          expected,
          command,
        });
      const accept = async (result: ReturnType<typeof send>) => {
        const answer = await result;
        if (answer.kind !== 'accepted') throw new Error(JSON.stringify(answer));
        return answer.receipt.aggregate.id;
      };
      const createLobby = (name: string) =>
        accept(
          send({
            type: 'create-lobby',
            owner: { kind: 'organization', organizationId },
            name,
            handle: createId(),
            lobby: { kind: 'standing', ageRule: 'adults' },
          }),
        );
      const lobbyId = await createLobby('Junior debate');
      const sibling = await createLobby('Open debate');
      const address = { organizationId, lobbyId };
      const edit = {
        type: 'edit-standing-lobby',
        ...address,
        name: 'Junior debate club',
        ageRule: 'under-18',
      } as const;
      const denied = await send(edit, { lobby: 1 }, other).then(
        () => false,
        (error: unknown) => {
          if (error instanceof CommandDenied) return true;
          throw error;
        },
      );
      await accept(send(edit, { lobby: 1 }));
      await accept(
        send(
          {
            type: 'save-ladder',
            ...address,
            name: 'Junior ladder',
            ladderId: null,
          },
          { lobby: 2 },
        ),
      );
      const [ladder] = await sql<
        { id: string }[]
      >`select id from ladders where lobby_id=${lobbyId}`;
      await accept(
        send(
          {
            type: 'save-ladder',
            ...address,
            name: 'Junior standings',
            ladderId: ladder!.id,
          },
          { lobby: 3 },
        ),
      );
      const foreignLadder = await send(
        {
          type: 'save-ladder',
          ...address,
          lobbyId: sibling,
          name: 'Wrong lobby',
          ladderId: ladder!.id,
        },
        { lobby: 1 },
      );
      const open = {
        type: 'create-season',
        ...address,
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: null,
        counting: 'sanction',
        countsLobbyRooms: true,
        rule: {},
        name: 'Season 1',
      } as const;
      const first = await accept(send(open));
      const duplicate = await send(open);
      await accept(send({ ...open, lobbyId: sibling }));
      await accept(
        send(
          {
            type: 'edit-season',
            ...address,
            seasonId: first,
            name: 'Inaugural season',
            endsAt: '2027-01-01T00:00:00.000Z',
          },
          { season: 1 },
        ),
      );
      await accept(
        send({ type: 'close-season', seasonId: first }, { season: 2 }),
      );
      await accept(send({ ...open, name: 'Season 2' }));

      const stored = await store.standingLobbyManagement(
        { viewerUserId: director.userId, organizationId },
        async (_facts, read) => read(),
      );
      assert({
        given: 'host edits and season rollover in one of two standing lobbies',
        should:
          'retain the ladder identity and closed history, with separate season and age rules',
        actual: {
          rows: [...stored]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ name, ageRule, ladders, seasons }) => ({
              name,
              ageRule,
              ladders: ladders.map(({ id, name }) => [id, name]),
              seasons: seasons.map(({ name, status }) => [name, status]).sort(),
            })),
          unauthorizedDenied: denied,
          denials: [foreignLadder, duplicate].map((answer) =>
            answer.kind === 'refused' ? answer.refusal : answer.kind,
          ),
        },
        expected: {
          rows: [
            {
              name: 'Junior debate club',
              ageRule: 'under-18',
              ladders: [[ladder!.id, 'Junior standings']],
              seasons: [
                ['Inaugural season', 'closed'],
                ['Season 2', 'active'],
              ],
            },
            {
              name: 'Open debate',
              ageRule: 'adults',
              ladders: [],
              seasons: [['Season 1', 'active']],
            },
          ],
          unauthorizedDenied: true,
          denials: ['not-found', 'season-open'],
        },
      });
    },
  });
});
