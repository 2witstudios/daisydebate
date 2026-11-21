import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { CommandDenied } from '../src/features/tab/commands/run-command';
import { createBots } from './tab-tournament.test-support';
import { seedHostingGrant } from './tab-hosting-grant.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const denied = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return false;
  } catch (error) {
    if (error instanceof CommandDenied) return true;
    throw error;
  }
};
const command = (kind: 'league' | 'school', commandId = createId()) => ({
  version: 1,
  commandId,
  expected: {},
  command: {
    type: 'create-organization',
    kind,
    name: `Hosting ${kind}`,
    handle: `hosting-${createId()}`,
  },
});

test('actual creation reads canonical finite hosting, replays once, and denies revoked or foreign funding without taking school creation away', async () => {
  const scratch = scratchDatabase(databaseUrl, 'hostingcreation');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const [director, other] = await createBots(owner, ['Director', 'Other']);
    if (!director || !other) throw new Error('creation cast missing');
    const common = {
      store: createTabStore(committingRuntimeTestDatabase(owner)),
      authorize,
      newId: createId,
      now: () => '1900-01-01T00:00:00.000Z',
    };
    // The deliberately stale injected arrival clock cannot grant paid access or timestamp a committed command.
    const send = organizationCommand(common),
      personal = lobbyAdministrationCommand(common);
    const freeTournament = {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-lobby',
        owner: { kind: 'self' },
        name: 'Free tournament',
        handle: `free-${createId()}`,
        lobby: {
          kind: 'tournament',
          eligibility: { kind: 'own', ageRule: 'adults' },
        },
      },
    };
    assert({
      given: 'an ordinary beta-admitted adult without hosting',
      should:
        'refuse league creation but allow school creation and a tournament of their own (decision 80)',
      actual: [
        await denied(() => send(as(director), command('league'))),
        (await send(as(director), command('school'))).kind,
        (await personal(as(other), freeTournament)).kind,
      ],
      expected: [true, 'accepted', 'accepted'],
    });
    const versionId = await owner.begin((sql) =>
      seedHostingGrant(sql, director.userId),
    );
    const envelope = command('league'),
      answer = await send(as(director), envelope);
    if (answer.kind !== 'accepted')
      throw new Error('stored hosting creation refused');
    const replay = await send(as(director), envelope);
    const lobbyEnvelope = {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-lobby',
        owner: { kind: 'self' },
        name: 'Personally funded tournament',
        handle: `funded-${createId()}`,
        lobby: {
          kind: 'tournament',
          eligibility: { kind: 'own', ageRule: 'adults' },
        },
      },
    };
    const lobby = await personal(as(director), lobbyEnvelope);
    if (lobby.kind !== 'accepted')
      throw new Error('personal hosting creation refused');
    const [history] =
      await owner`select count(*)::int as n,min(applied_at) as at from action_history where command_id=${envelope.commandId}`;
    assert({
      given: 'a real finite selected grant read under the account fence',
      should:
        'commit exactly once at database time and deny the same paid capability to another account',
      actual: {
        kind: answer.kind,
        replay,
        replays: Number(history!.n),
        currentTime: Date.parse(String(history!.at)) > Date.UTC(2026, 0, 1),
        foreign: await denied(() => send(as(other), command('league'))),
      },
      expected: {
        kind: 'accepted',
        replay: { ...answer, receipt: { ...answer.receipt, replayed: true } },
        replays: 1,
        currentTime: true,
        foreign: true,
      },
    });
    await owner.begin(async (sql) => {
      await sql`select id from users where id=${director.userId} for update`;
      await sql`update account_entitlement_grants set revoked_at=clock_timestamp() where user_id=${director.userId} and hosting_version_id=${versionId}`;
      await sql`update users set version=version+1 where id=${director.userId}`;
    });
    assert({
      given:
        'the exact previously accepted creation commands after source revocation',
      should:
        'deny league replay and new league creation, keep the personal tournament (hosting never gated it), with no duplicated organization or lobby',
      actual: [
        await denied(() => send(as(director), envelope)),
        (await personal(as(director), lobbyEnvelope)).kind,
        await denied(() => send(as(director), command('league'))),
        Number(
          (
            await owner`select count(*)::int as n from action_history where command_id in (${envelope.commandId},${lobbyEnvelope.commandId})`
          )[0]!.n,
        ),
      ],
      expected: [true, 'accepted', true, 2],
    });

    const expiryEnvelope = command('league');
    let queued: Promise<boolean> | null = null;
    let heldBeforeExpiry = false,
      observedWait = false;
    await owner.begin(async (sql) => {
      await sql`select id from users where id=${director.userId} for update`;
      const nextId = createId();
      const [version] = await sql`insert into account_hosting_versions
      (id,user_id,source,version,starts_at,expires_at,issuer_service_id,issuer_operator_ref,decision_reference,coverage)
      values(${nextId},${director.userId},'administrative',2,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '500 milliseconds','daisy-admin',${createId()},'DEC409 bounded account-wait fixture',${{ tournamentIds: [], sponsorConcurrencyLimit: 1, tournamentConcurrencyLimit: 1 }})
      returning expires_at>clock_timestamp() as current`;
      heldBeforeExpiry = version!.current === true;
      await sql`update account_entitlement_grants set hosting_version_id=${nextId},revoked_at=null where user_id=${director.userId} and entitlement='tournament_hosting' and source='administrative'`;
      queued = denied(() => send(as(director), expiryEnvelope));
      // Observe the actual competing account lock, then release it only after the DB's coverage end.
      for (let attempt = 0; attempt < 100; attempt++) {
        const [wait] =
          await owner`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%daisy_authorization_accounts_v2%') as waiting`;
        if (wait!.waiting === true) {
          observedWait = true;
          break;
        }
        await Bun.sleep(5);
      }
      await sql`select pg_sleep(greatest(0,extract(epoch from (expires_at-clock_timestamp())))+0.01) from account_hosting_versions where id=${nextId}`;
    });
    const expiredDenied = await queued;
    assert({
      given:
        'a request actually blocked on the canonical account fence while its selected version expires',
      should:
        'sample the database instant after waiting and refuse without writing any command history',
      actual: {
        heldBeforeExpiry,
        observedWait,
        expiredDenied,
        history: Number(
          (
            await owner`select count(*)::int as n from action_history where command_id=${expiryEnvelope.commandId}`
          )[0]!.n,
        ),
      },
      expected: {
        heldBeforeExpiry: true,
        observedWait: true,
        expiredDenied: true,
        history: 0,
      },
    });
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 60_000);
