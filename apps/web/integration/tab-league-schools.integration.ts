import { seedHostingGrant } from './tab-hosting-grant.test-support';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import { leagueSchoolCommand } from '../src/features/tab/operations/league-schools';
import { createLeagueSchoolCommandRoute } from '../src/features/tab/league-school-command-route';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { member, origin } from '../src/server/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import {
  createBots,
  scriptClock,
  type Bot,
} from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('league schools require independent league and school assent and audited either-side termination', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, ['League controller', 'School controller', 'Outsider']),
    work: async (database, bots, sql) => {
      const [leagueController, schoolController, outsider] = bots as [
        Bot,
        Bot,
        Bot,
      ];
      const store = createTabStore(database),
        clock = scriptClock();
      const common = { store, authorize, now: clock.now, newId: createId };
      await seedHostingGrant(sql, leagueController.userId);
      await seedHostingGrant(sql, schoolController.userId);
      const organization = organizationCommand(common);
      const create = async (person: Bot, kind: 'league' | 'school') => {
        const answer = await organization(as(person), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-organization',
            kind,
            name: kind,
            handle: `${kind}-${createId()}`,
          },
        });
        if (answer.kind !== 'accepted')
          throw new Error('Organization fixture creation failed');
        return answer.receipt.aggregate.id;
      };
      const leagueId = await create(leagueController, 'league'),
        schoolId = await create(schoolController, 'school'),
        wrongSchoolId = await create(schoolController, 'league');
      const operation = leagueSchoolCommand(common);
      const envelope = (
        type:
          'invite-league-school' | 'accept-league-school' | 'end-league-school',
        expected: Record<string, number>,
        side?: 'league' | 'school',
      ) => ({
        version: 1,
        commandId: createId(),
        expected,
        command: { type, leagueId, schoolId, ...(side ? { side } : {}) },
      });
      const post = async (person: Bot, body: unknown, released = true) => {
        const route = createLeagueSchoolCommandRoute({
          ...common,
          released: async () => released,
          boundary: {
            logger: silentLogger,
            reporter: noopErrorReporter,
            origin: () => origin,
            identify: async () => ({
              ...member,
              principal: { ...as(person), actorId: person.actorId },
            }),
          },
        });
        return route(
          new Request(`${origin}/api/tab/league-school-command`, {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
      };
      const invite = envelope('invite-league-school', { organization: 1 });
      assert({
        given: 'an outsider, a school-only controller, or an unreleased route',
        should: 'not let any of them add a school to the league',
        actual: [
          (await post(outsider, invite)).status,
          (await post(schoolController, invite)).status,
          (await post(leagueController, invite, false)).status,
        ],
        expected: [404, 404, 404],
      });
      const invitation = await post(leagueController, invite);
      const invited = (await invitation.json()) as { kind: string };
      const [pending] =
        await sql`select status,joined_at,joined_by_user_id from league_schools where organization_id=${leagueId} and school_id=${schoolId}`;
      assert({
        given: 'league assent alone',
        should:
          'record an invitation with no active membership or school assent',
        actual: [invitation.status, invited.kind, pending],
        expected: [
          200,
          'accepted',
          { status: 'invited', joined_at: null, joined_by_user_id: null },
        ],
      });
      const accept = envelope('accept-league-school', { membership: 1 });
      assert({
        given: 'the league controller trying to supply school assent',
        should: 'require the school controller instead',
        actual: (await post(leagueController, accept)).status,
        expected: 404,
      });
      const joined = await operation(as(schoolController), accept);
      const replay = await operation(as(schoolController), accept);
      const [active] =
        await sql`select status,version,invited_by_user_id,joined_by_user_id,joined_at is not null as joined from league_schools where organization_id=${leagueId} and school_id=${schoolId}`;
      assert({
        given: 'actual school-controller assent and an identical retry',
        should: 'activate exactly once and retain both controllers',
        actual: [joined.kind, replay.kind, active],
        expected: [
          'accepted',
          'accepted',
          {
            status: 'active',
            version: 2,
            invited_by_user_id: leagueController.userId,
            joined_by_user_id: schoolController.userId,
            joined: true,
          },
        ],
      });
      assert({
        given: 'a stale membership version',
        should: 'refuse termination without changing active membership',
        actual: await operation(
          as(leagueController),
          envelope('end-league-school', { membership: 1 }, 'league'),
        ),
        expected: { kind: 'refused', refusal: 'version-conflict' },
      });
      const ended = await operation(
        as(leagueController),
        envelope('end-league-school', { membership: 2 }, 'league'),
      );
      const [endedRow] =
        await sql`select status,ended_by_user_id,ended_at is not null as ended from league_schools where organization_id=${leagueId} and school_id=${schoolId}`;
      assert({
        given: 'league-controller termination',
        should: 'explicitly end the relation and retain who acted',
        actual: [ended.kind, endedRow],
        expected: [
          'accepted',
          {
            status: 'ended',
            ended_by_user_id: leagueController.userId,
            ended: true,
          },
        ],
      });
      const [league] =
        await sql`select version from organizations where id=${leagueId}`;
      const reinvite = await operation(
        as(leagueController),
        envelope('invite-league-school', {
          organization: Number(league!.version),
        }),
      );
      const cancelled = await operation(
        as(schoolController),
        envelope('end-league-school', { membership: 1 }, 'school'),
      );
      const periods =
        await sql`select status,version,joined_by_user_id,joined_at is not null as joined,ended_by_user_id from league_schools where organization_id=${leagueId} and school_id=${schoolId} order by invited_at,id`;
      assert({
        given:
          'a fresh league invitation to a previously ended school, then school-side refusal',
        should:
          'open a new period needing fresh assent, keep the ended period as it was, and let the school end the pending one',
        actual: [reinvite.kind, cancelled.kind, periods],
        expected: [
          'accepted',
          'accepted',
          [
            {
              status: 'ended',
              version: 3,
              joined_by_user_id: schoolController.userId,
              joined: true,
              ended_by_user_id: leagueController.userId,
            },
            {
              status: 'ended',
              version: 2,
              joined_by_user_id: null,
              joined: false,
              ended_by_user_id: schoolController.userId,
            },
          ],
        ],
      });
      const [currentLeague] =
        await sql`select version from organizations where id=${leagueId}`;
      const wrong = await operation(as(leagueController), {
        ...envelope('invite-league-school', {
          organization: Number(currentLeague!.version),
        }),
        command: {
          type: 'invite-league-school',
          leagueId,
          schoolId: wrongSchoolId,
        },
      });
      assert({
        given: 'a league in place of the member school',
        should: 'refuse joining the wrong organization kind',
        actual: wrong,
        expected: { kind: 'refused', refusal: 'wrong-organization-kind' },
      });
      const rows =
        await sql`select type,actor_user_id,aggregate_kind,aggregate_id from action_history where organization_id=${leagueId} and type in ('invite-league-school','accept-league-school','end-league-school') order by applied_at,command_id`;
      const relations =
        await sql`select id from league_schools where organization_id=${leagueId} and school_id=${schoolId} order by invited_at,id`;
      assert({
        given: 'the relation journal across two membership periods',
        should: 'identify the exact period each transition changed',
        actual: rows.map(
          (row: { aggregate_kind: string; aggregate_id: string }) =>
            row.aggregate_kind === 'league_school' &&
            relations.findIndex(
              (relation: { id: string }) => relation.id === row.aggregate_id,
            ),
        ),
        expected: [0, 0, 0, 1, 1],
      });
      await sql`select set_config('daisy.organization_scope', ${schoolId}, true), set_config('daisy.lobby_scope', '', true)`;
      const schoolSees =
        await sql`select organization_id,status from league_schools order by invited_at,id`;
      assert({
        given: 'a transaction scoped to the member school',
        should: 'read its own membership periods in the league',
        actual: schoolSees.map(
          (row: { organization_id: string; status: string }) => [
            row.organization_id === leagueId,
            row.status,
          ],
        ),
        expected: [
          [true, 'ended'],
          [true, 'ended'],
        ],
      });
      let schoolWrote = true;
      try {
        await sql`savepoint school_write`;
        await sql`update league_schools set version=version+1 where school_id=${schoolId}`;
        schoolWrote =
          (
            await sql`select count(*)::int n from league_schools where school_id=${schoolId} and version > 3`
          )[0]!.n > 0;
        await sql`rollback to savepoint school_write`;
      } catch {
        schoolWrote = false;
        await sql`rollback to savepoint school_write`;
      }
      assert({
        given: 'the member school scope attempting a write',
        should: 'never change the league-owned relation',
        actual: schoolWrote,
        expected: false,
      });
      assert({
        given: 'five accepted transitions plus replay, stale and denied calls',
        should:
          'record exactly five entries in the single history with the correct acting accounts',
        actual: [
          rows.length,
          rows.filter(
            (row: { actor_user_id: string }) =>
              row.actor_user_id === leagueController.userId,
          ).length,
          rows.filter(
            (row: { actor_user_id: string }) =>
              row.actor_user_id === schoolController.userId,
          ).length,
        ],
        expected: [5, 3, 2],
      });
      const otherLeagueInvite = await operation(as(schoolController), {
        version: 1,
        commandId: createId(),
        expected: { organization: 1 },
        command: {
          type: 'invite-league-school',
          leagueId: wrongSchoolId,
          schoolId,
        },
      });
      const hidden =
        await sql`select id from league_schools where organization_id=${leagueId}`;
      const own =
        await sql`select status from league_schools where organization_id=${wrongSchoolId}`;
      assert({
        given: 'a runtime transaction scoped to a different league',
        should:
          'isolate the first league relation behind its canonical organization fence',
        actual: [
          otherLeagueInvite.kind,
          hidden.length,
          own.map((row: { status: string }) => row.status),
        ],
        expected: ['accepted', 0, ['invited']],
      });
    },
  });
}, 30000);
