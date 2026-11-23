import { hostWaits } from '@daisy/worker/host';
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
import { settingCommand } from '../src/features/tab/operations/settings';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { readStandingRoomDraft } from '../src/features/tab/reads/standing-room-draft';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { leagueConfigurationStage } from './tab-tournament-league-configuration.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'tabstandingread');
afterAll(() => scratch.drop());
test('standing Room readers coexist and retain actual template, offer and member fences through projection', async () => {
  await scratch.create();
  await scratch.migrate(() => true);
  const owner = new SQL(scratch.url, { max: 1 });
  const reader = new SQL(scratch.url, { max: 1 });
  const writer = new SQL(scratch.url, { max: 1 });
  const observer = new SQL(scratch.url, { max: 1 });
  let release = () => {};
  let reading: Promise<unknown> | null = null;
  let changing: Promise<unknown> | null = null;
  let overlapping: Promise<unknown> | null = null;
  try {
    const bots = await createBots(owner, [
      'Director',
      'Staff',
      'Coach',
      'Judge A',
    ]);
    const state = {
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      clock: scriptClock(),
      made: new Map<string, string>(),
    };
    await withRuntimeTestTransaction(owner, async (frame) => {
      const world = { ...state, ...frame };
      await organizationStage(world);
      await leagueAdministrationStage(world);
      await leagueConfigurationStage(world);
    });
    const lobbyId = state.made.get('standing-lobby')!;
    const templateId = state.made.get('league-template')!;
    const organizationId = state.made.get('league')!;
    const original = createTabStore(committingRuntimeTestDatabase(reader));
    const read = (store: Pick<TabStore, 'standingRoomDraft'>) =>
      readStandingRoomDraft({ store, authorize, now: state.clock.now })(
        as(state.bots.Coach!),
        { lobbyId, templateId },
      );
    const pause = () => {
      let reached = () => {};
      const ready = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      reading = read({
        standingRoomDraft: (input, work) =>
          original.standingRoomDraft(input, async (facts) => {
            reached();
            await released;
            return work(facts);
          }),
      });
      return ready;
    };
    const [held] = await reader`select pg_backend_pid() as pid`;
    const observed = (operation: Promise<unknown>) =>
      finishedOrBlockedBehind(operation, observer, Number(held?.pid), {
        waits: hostWaits,
      });
    await pause();
    overlapping = read(createTabStore(committingRuntimeTestDatabase(owner)));
    const sharing = await observed(overlapping);
    release();
    await Promise.all([reading, overlapping]);
    assert({
      given: 'another member Room-draft read during projection',
      should: 'share all canonical account and metadata fences',
      actual: sharing,
      expected: 'finished',
    });
    const send = settingCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: state.clock.now,
      newId: createId,
    });
    await pause();
    changing = send(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { template: 1 },
      command: {
        type: 'revise-template',
        templateId,
        name: 'Updated offered template',
      },
    });
    const templateWait = await observed(changing);
    release();
    const beforeRename = await reading;
    const renamed = await changing;
    const fresh = await read(original);
    assert({
      given: 'the actual offered template changing during projection',
      should: 'wait and show its new name only on the next read',
      actual: [
        templateWait,
        beforeRename !== null,
        (renamed as { kind: string }).kind,
        fresh?.templates[0]?.name,
      ],
      expected: ['blocked', true, 'accepted', 'Updated offered template'],
    });
    await pause();
    const [lobby] =
      await owner`select version from lobbies where id=${lobbyId}`;
    changing = send(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { lobby: Number(lobby?.version) },
      command: { type: 'withdraw-template', lobbyId, templateId },
    });
    const offerWait = await observed(changing);
    release();
    await reading;
    const withdrawn = await changing;
    assert({
      given: 'withdrawal of the actually offered template during projection',
      should: 'wait on the lobby fence and hide the withdrawn draft afterward',
      actual: [
        offerWait,
        (withdrawn as { kind: string }).kind,
        await read(original),
      ],
      expected: ['blocked', 'accepted', null],
    });
    const [current] =
      await owner`select version from lobbies where id=${lobbyId}`;
    const offered = await send(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { lobby: Number(current?.version) },
      command: { type: 'offer-template', lobbyId, templateId },
    });
    if (offered.kind !== 'accepted') throw new Error('re-offer refused');
    await pause();
    const [organization] =
      await owner`select version from organizations where id=${organizationId}`;
    changing = organizationCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: state.clock.now,
      newId: createId,
    })(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { organization: Number(organization?.version) },
      command: {
        type: 'end-membership',
        organizationId,
        userId: state.bots.Coach!.userId,
      },
    });
    const memberWait = await observed(changing);
    release();
    await reading;
    const removed = await changing;
    assert({
      given: 'the actual reader losing membership during projection',
      should:
        'retain authorization through the callback and deny the next read',
      actual: [
        memberWait,
        (removed as { kind: string }).kind,
        await read(original),
      ],
      expected: ['blocked', 'accepted', null],
    });
  } finally {
    release();
    await Promise.allSettled([
      ...(reading ? [reading] : []),
      ...(changing ? [changing] : []),
      ...(overlapping ? [overlapping] : []),
    ]);
    await Promise.all([
      owner.close(),
      reader.close(),
      writer.close(),
      observer.close(),
    ]);
  }
}, 30_000);
