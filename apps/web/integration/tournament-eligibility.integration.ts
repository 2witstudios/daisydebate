import type { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import type { LobbyCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { settingCommand } from '../src/features/tab/operations/settings';
import { setupCommand } from '../src/features/tab/operations/setup';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { createBots, type Bot } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const seed = async (sql: SQL) => {
  const [host, adult, minor, guardian] = (await createBots(sql, [
    'Host',
    'Adult',
    'Minor',
    'Guardian',
  ])) as [Bot, Bot, Bot, Bot];
  await sql`update account_age set birth_month=to_char(now()-interval '14 years','YYYY-MM')
    where user_id=${minor.userId}`;
  const makeLeague = async (name: string) => {
    const id = createId();
    await sql`insert into organizations (id, kind, name, handle, owner_user_id, league_division)
      values (${id}, 'league', ${name}, ${id}, ${host.userId}, 'open')`;
    return id;
  };
  const leagueId = await makeLeague('Test league');
  const otherLeagueId = await makeLeague('Other league');
  const makeStanding = async (league: string, rule: 'under-18' | 'adults') => {
    const id = createId();
    await sql`insert into lobbies (id, kind, name, handle, owner_organization_id, age_rule)
      values (${id}, 'standing', ${id}, ${id}, ${league}, ${rule})`;
    return id;
  };
  const youthLobby = await makeStanding(leagueId, 'under-18');
  const permittedLobby = await makeStanding(leagueId, 'adults');
  const unpermittedLobby = await makeStanding(leagueId, 'adults');
  const foreignLobby = await makeStanding(otherLeagueId, 'adults');
  const consentId = createId();
  const linkId = createId();
  await sql`insert into guardian_consent_evidence
    (id, person_user_id, role, method, notice_kind, notice_version, notice_digest, recorded_at)
    values (${consentId}, ${guardian.userId}, 'guardian', 'created-account',
      'parental-consent', 'fixture', repeat('0', 64), now())`;
  await sql`insert into guardian_links
    (id, guardian_user_id, minor_user_id, guardian_consent_id, status, activation, activated_at)
    values (${linkId}, ${guardian.userId}, ${minor.userId}, ${consentId}, 'active', 'created-account', now())`;
  await sql`insert into restriction_lobbies
    (guardian_link_id, guardian_user_id, minor_user_id, lobby_id, signed_at, waiver_version, waiver_digest)
    values (${linkId}, ${guardian.userId}, ${minor.userId}, ${permittedLobby}, now(), 'fixture', repeat('0', 64))`;
  return {
    host,
    adult,
    minor,
    leagueId,
    youthLobby,
    permittedLobby,
    unpermittedLobby,
    foreignLobby,
  };
};

type CreateLobby = Extract<LobbyCommand, { type: 'create-lobby' }>;
type Eligibility = Extract<
  CreateLobby['lobby'],
  { kind: 'tournament' }
>['eligibility'];

test('Tab enrollment uses the exact standing lobby and authorizes each entrant', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed,
    work: async (database, data, sql) => {
      const { host, adult, minor, leagueId } = data;
      const common = {
        store: createTabStore(database),
        authorize,
        now: () => new Date().toISOString(),
        newId: createId,
      };
      const create = (eligibility: Eligibility, name: string) =>
        lobbyAdministrationCommand(common)(as(host), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-lobby',
            owner:
              eligibility.kind === 'own'
                ? { kind: 'self' }
                : { kind: 'organization', organizationId: leagueId },
            name,
            handle: `eligibility-${createId()}`,
            lobby: { kind: 'tournament', eligibility },
          },
        });
      const tournament = async (eligibility: Eligibility, name: string) => {
        const created = await create(eligibility, name);
        if (created.kind !== 'accepted')
          throw new Error(`Tournament refused: ${JSON.stringify(created)}`);
        const lobbyId = created.receipt.aggregate.id;
        const added = await setupCommand(common)(as(host), {
          version: 1,
          commandId: createId(),
          expected: { lobby: created.receipt.resultingVersion },
          command: {
            type: 'add-event',
            lobbyId,
            name: 'Freestyle',
            label: 'FS',
            entry: { kind: 'person' },
            pin: {
              kind: 'format',
              formatId: 'freestyle',
              formatVersion: 1,
              ballotDefinition: null,
            },
          },
        });
        if (added.kind !== 'accepted')
          throw new Error(`Event refused: ${JSON.stringify(added)}`);
        const [event] =
          await sql`select id from events where lobby_id=${lobbyId}`;
        const eventId = String(event!.id);
        const configure = settingCommand(common);
        for (const [index, [key, value]] of [
          ['entry.registration', { state: 'open' }],
          ['entry.approval', { value: 'automatic' }],
        ].entries()) {
          const changed = await configure(as(host), {
            version: 1,
            commandId: createId(),
            expected: { settings: index + 1 },
            command: {
              type: 'set-setting',
              scope: { kind: 'event', id: eventId },
              key,
              value,
              hold: 'default',
            },
          });
          if (changed.kind !== 'accepted')
            throw new Error(
              `Event setting refused: ${JSON.stringify(changed)}`,
            );
        }
        return { lobbyId, eventId };
      };
      const inScope = (lobbyId: string) =>
        sql`select set_config('daisy.lobby_scope', ${lobbyId}, true)`;
      const enter = async (
        target: { lobbyId: string; eventId: string },
        member: Bot,
        caller = member,
      ) => {
        await inScope(target.lobbyId);
        const [row] =
          await sql`select entries_version v from events where id=${target.eventId}`;
        const answer = await entryEnrollmentCommand(common)(
          as(caller),
          target.lobbyId,
          {
            version: 1,
            commandId: createId(),
            expected: { entries: Number(row!.v) },
            command: {
              type: 'submit-entry',
              eventId: target.eventId,
              name: member.name,
              memberActorIds: [member.actorId],
              responsible: { kind: 'self' },
              division: null,
            },
          },
        );
        return answer.kind === 'refused' ? answer.refusal : answer.kind;
      };
      const inherited = (lobbyId: string) => ({
        kind: 'standing' as const,
        lobbyId,
      });
      const youth = await tournament(
        inherited(data.youthLobby),
        'League Youth',
      );
      const permitted = await tournament(
        inherited(data.permittedLobby),
        'Permitted',
      );
      const unpermitted = await tournament(
        inherited(data.unpermittedLobby),
        'No permission',
      );
      const personal = await tournament(
        { kind: 'own', ageRule: 'anyone' },
        'Personal',
      );
      const foreign = await create(
        inherited(data.foreignLobby),
        'Foreign parent',
      );
      const adultRefusal = await enter(youth, adult);
      await inScope(youth.lobbyId);
      const [count] =
        await sql`select count(*)::int n from entries where lobby_id=${youth.lobbyId}`;
      const impersonation = await deniedAsNotFound(() =>
        enter(youth, minor, adult),
      );
      const cases = [youth, permitted, unpermitted, personal];
      const outcomes = [];
      for (const target of cases) {
        const answer = await enter(target, minor);
        await inScope(target.lobbyId);
        const stored =
          await sql`select status, submitted_by_user_id as "submittedBy" from entries where lobby_id=${target.lobbyId}`;
        outcomes.push({ answer, stored });
      }
      const accepted = {
        answer: 'accepted',
        stored: [{ status: 'accepted', submittedBy: minor.userId }],
      };
      assert({
        given:
          'a minor with one standing-lobby permission and an adult applying to a Youth tournament',
        should:
          'keep eligibility and permissions with their actual lobby and reject a foreign parent',
        actual: {
          foreign,
          adultRefusal,
          rejectedRows: Number(count!.n),
          impersonation,
          outcomes,
        },
        expected: {
          foreign: { kind: 'refused', refusal: 'standing-lobby-required' },
          adultRefusal: 'over-youth-age',
          rejectedRows: 0,
          impersonation: true,
          outcomes: [
            accepted,
            accepted,
            { answer: 'under-open-age', stored: [] },
            accepted,
          ],
        },
      });
    },
  });
});
