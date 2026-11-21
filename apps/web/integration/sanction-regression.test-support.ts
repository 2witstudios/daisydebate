import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { settingCommand } from '../src/features/tab/operations/settings';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { sanctionCommand } from '../src/features/tab/operations/sanction-command';
import {
  membershipCompetition,
  requireAccepted,
} from './league-membership-competition.test-support';
import { seedHostingGrant } from './tab-hosting-grant.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World, Bot } from './tab-tournament.test-support';

export const sanctionRegressionNames = [
  'Director',
  'Host',
  'Reader',
  'SetupOnly',
  'Entrant',
] as const;
/** Actual organizations, assent and competitive result; SQL only seeds the narrow authority role and reads guards. */
export async function sanctionRegressionFixture(world: World) {
  const {
    Director: director,
    Host: host,
    Reader: reader,
    SetupOnly: setupOnly,
    Entrant: entrant,
  } = world.bots;
  if (!director || !host || !reader || !setupOnly || !entrant)
    throw new Error('Sanction regression cast missing');
  const accepted = async (
    answer: Promise<LobbyCommandAnswer<string>>,
    label: string,
  ) => {
    try {
      return await requireAccepted(answer, label);
    } catch (cause) {
      throw new Error(label, { cause });
    }
  };
  const common = {
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  };
  await seedHostingGrant(world.sql, director.userId);
  await seedHostingGrant(world.sql, host.userId);
  const organizations = organizationCommand(common);
  const league = await accepted(
    organizations(as(director), {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-organization',
        kind: 'league',
        name: 'Sanction regression league',
        handle: `regression-${createId()}`,
      },
    }),
    'create league',
  );
  const organizationId = league.aggregate.id;
  const join = async (person: Bot) => {
    const [guard] =
      await world.sql`select version from organizations where id=${organizationId}`;
    await accepted(
      organizations(as(director), {
        version: 1,
        commandId: createId(),
        expected: { organization: Number(guard!.version) },
        command: {
          type: 'invite-member',
          organizationId,
          userId: person.userId,
        },
      }),
      'invite league reader',
    );
    await accepted(
      organizations(as(person), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: { type: 'accept-membership', organizationId },
      }),
      'accept league membership',
    );
  };
  await join(reader);
  await join(setupOnly);
  const roleId = createId();
  await world.sql`insert into roles(id,organization_id,name,rank,preset) values(${roleId},${organizationId},'League setup only',60,false)`;
  await world.sql`insert into role_permissions(role_id,organization_id,permission) values(${roleId},${organizationId},'lobby.setup.manage')`;
  const [guard] =
    await world.sql`select version from organizations where id=${organizationId}`;
  const grant = await accepted(
    organizations(as(director), {
      version: 1,
      commandId: createId(),
      expected: { organization: Number(guard!.version) },
      command: {
        type: 'give-grant',
        userId: setupOnly.userId,
        roleId,
        scope: { kind: 'organization', organizationId },
        expiresAt: null,
      },
    }),
    'grant only league setup',
  );
  const template = await accepted(
    settingCommand(common)(as(director), {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-template',
        organizationId,
        name: 'Sanction regression series',
        format: { id: 'freestyle', version: 1 },
        ballotDefinition: null,
      },
    }),
    'create template',
  );
  const templateId = template.aggregate.id;
  const standing = await lobbyAdministrationCommand(common)(as(director), {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'create-lobby',
      owner: { kind: 'organization', organizationId: organizationId },
      name: 'Standing lobby',
      handle: `standing-${createId()}`,
      lobby: { kind: 'standing' },
    },
  });
  if (standing.kind !== 'accepted') throw new Error('Standing lobby refused');
  const season = await accepted(
    lobbyAdministrationCommand(common)(as(director), {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-season',
        organizationId,
        lobbyId: standing.receipt.aggregate.id,
        name: 'Sanction regression season',
        startsAt: new Date(Date.now() - 86400000).toISOString(),
        endsAt: null,
        counting: 'sanction',
        countsLobbyRooms: false,
        rule: {
          preliminaryWin: { points: 2, cap: null },
          eliminationRound: { points: 3 },
          bestEvents: null,
          topPerSchool: null,
        },
      },
    }),
    'create season',
  );
  const seasonId = season.aggregate.id;
  const competition = await membershipCompetition(world, {
    host,
    owner: { kind: 'self' },
    entrant,
    school: null,
    templateId,
    name: 'Personal hosted real event',
    certify: false,
  });
  const input = { organizationId, lobbyId: competition.lobbyId };
  const send = sanctionCommand(common);
  const request = {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'request-sanction',
      leagueId: organizationId,
      eventId: competition.eventId,
      templateId,
      seasonId,
    },
  };
  const requested = await accepted(
    send(as(host), input, request),
    'personal host requests sanction',
  );
  const approval = {
    version: 1,
    commandId: createId(),
    expected: { sanction: 1 },
    command: { type: 'approve-sanction', sanctionId: requested.aggregate.id },
  };
  await accepted(
    send(as(director), input, approval),
    'distinct league director approves',
  );
  const withdrawal = {
    version: 1,
    commandId: createId(),
    expected: { sanction: 2 },
    command: {
      type: 'withdraw-sanction',
      sanctionId: requested.aggregate.id,
      reason: 'The personal event host withdraws before certification.',
    },
  };
  return {
    ...competition,
    organizationId,
    templateId,
    seasonId,
    sanctionId: requested.aggregate.id,
    input,
    withdrawal,
    request,
    approval,
    grant,
    host,
    director,
    reader,
    setupOnly,
  };
}
