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
import { guardianCommand } from '../src/features/tab/operations/guardian';
import { readFamilyHistory } from '../src/features/tab/reads/family-history';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import {
  erasePrivacySubject,
  subjectRightsVerificationBindings,
} from '@daisy/db/privacy';
import { activeRoomMembers, closeRoom, eraseSeats } from '@daisy/debate-engine';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env),
  scratch = scratchDatabase(databaseUrl, 'familyreadfence');
afterAll(() => scratch.drop());
test('family readers share the ward fence and a different guardian cannot change it through projection', async () => {
  await scratch.create();
  await scratch.migrate(() => true);
  const owner = new SQL(scratch.url, { max: 1 }),
    reader = new SQL(scratch.url, { max: 1 }),
    writer = new SQL(scratch.url, { max: 1 }),
    observer = new SQL(scratch.url, { max: 1 });
  let release = () => {};
  let releaseClosure = () => {};
  let closing: Promise<unknown> | null = null;
  let reading: Promise<unknown> | null = null,
    changing: Promise<unknown> | null = null,
    overlapping: Promise<unknown> | null = null;
  try {
    const rows = await createBots(owner, [
        'Parent',
        'Second parent',
        'Minor',
        'Closing guardian',
      ]),
      bots = Object.fromEntries(rows.map((bot) => [bot.name, bot])),
      clock = scriptClock();
    await owner`update account_age set birth_month=${`${new Date().getUTCFullYear() - 17}-01`} where user_id=${bots.Minor!.userId}`;
    let firstId = '',
      secondId = '';
    await withRuntimeTestTransaction(owner, async (frame) => {
      await frame.sql`reset role`; // Test-only fixture owner; the production web role still has no family write privilege.
      const send = guardianCommand({
        store: createTabStore(frame.database),
        authorize,
        now: clock.now,
        newId: createId,
        minorsReleased: async () => true,
        consentNoticeVersion: 1,
      });
      const made = await send(as(bots.Parent!), bots.Minor!.userId, {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-guardian-link',
          guardianUserId: bots.Parent!.userId,
          wardUserId: bots.Minor!.userId,
          through: { kind: 'direct' },
        },
      });
      if (made.kind !== 'accepted')
        throw new Error('Family fence fixture refused');
      firstId = made.receipt.aggregate.id;
      const first = await send(as(bots.Parent!), bots.Minor!.userId, {
        version: 1,
        commandId: createId(),
        expected: { guardianLink: 1 },
        command: {
          type: 'consent-guardian-link',
          guardianLinkId: firstId,
          noticeVersion: 1,
        },
      });
      if (first.kind !== 'accepted')
        throw new Error('First test consent refused');
      const added = await send(as(bots.Parent!), bots.Minor!.userId, {
        version: 1,
        commandId: createId(),
        expected: { guardianLink: 2 },
        command: {
          type: 'add-guardian',
          guardianLinkId: firstId,
          guardianUserId: bots['Second parent']!.userId,
        },
      });
      if (added.kind !== 'accepted')
        throw new Error('Second test parent refused');
      secondId = added.receipt.aggregate.id;
      const second = await send(
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
      if (second.kind !== 'accepted')
        throw new Error('Second test consent refused');
    });
    const original = createTabStore(committingRuntimeTestDatabase(reader));
    const view = (store: Pick<TabStore, 'familyHistory'>) =>
      readFamilyHistory({
        store,
        authorize,
        now: clock.now,
        minorsReleased: async () => true,
      })(as(bots['Second parent']!), {
        guardianLinkId: secondId,
        subjectUserId: bots.Minor!.userId,
      });
    const pause = () => {
      let reached = () => {};
      const ready = new Promise<void>((resolve) => {
          reached = resolve;
        }),
        released = new Promise<void>((resolve) => {
          release = resolve;
        });
      const operation = view({
        familyHistory: (input, work) =>
          original.familyHistory(input, async (facts) => {
            reached();
            await released;
            return work(facts);
          }),
      });
      reading = operation;
      return { ready, operation };
    };
    const [held] = await reader`select pg_backend_pid() as pid`;
    const [closingBackend] = await owner`select pg_backend_pid() as pid`;
    const observe = (operation: Promise<unknown>) =>
      finishedOrBlockedBehind(operation, observer, Number(held?.pid), {
        now: Date.now,
      });
    const first = pause();
    await first.ready;
    overlapping = view(createTabStore(committingRuntimeTestDatabase(owner)));
    const coexist = await observe(overlapping);
    release();
    const [one, two] = await Promise.all([first.operation, overlapping]);
    assert({
      given: 'two actual family reads of the same subject',
      should: 'share canonical account fences and read the same four commands',
      actual: [
        coexist,
        one?.entries.length,
        (two as typeof one)?.entries.length,
      ],
      expected: ['finished', 4, 4],
    });
    const heldRead = pause();
    await heldRead.ready;
    changing = withRuntimeTestTransaction(writer, async (frame) => {
      await frame.sql`reset role`; // Test-only write; no role elevation exists in the adapter.
      return guardianCommand({
        store: createTabStore(frame.database),
        authorize,
        now: clock.now,
        newId: createId,
        minorsReleased: async () => true,
        consentNoticeVersion: 1,
      })(as(bots.Parent!), bots.Minor!.userId, {
        version: 1,
        commandId: createId(),
        expected: { guardianLink: 2 },
        command: {
          type: 'set-restriction',
          guardianLinkId: firstId,
          limitsLobbies: false,
          allowedLobbyIds: [],
          videoCap: 'officials',
        },
      });
    });
    const blocked = await observe(changing);
    release();
    const before = await heldRead.operation,
      changed = await changing,
      after = await view(original);
    assert({
      given:
        'one guardian reading while a different guardian changes their shared ward',
      should:
        'retain history through projection using the ward fence and show the next committed action on reload',
      actual: [
        blocked,
        before?.entries.length,
        (changed as { kind: string }).kind,
        after?.entries.length,
      ],
      expected: ['blocked', 4, 'accepted', 5],
    });
    let erasedReached = () => {};
    const erasedReady = new Promise<void>((resolve) => {
        erasedReached = resolve;
      }),
      closureReleased = new Promise<void>((resolve) => {
        releaseClosure = resolve;
      });
    const closingGuardian = bots['Closing guardian']!;
    closing = withRuntimeTestTransaction(owner, async (frame) => {
      await frame.sql`reset role`;
      await erasePrivacySubject(
        frame.database,
        {
          subject: {
            userId: closingGuardian.userId,
            actorId: closingGuardian.actorId,
          },
          now: clock.now(),
          vendors: [],
          jobIds: [],
        },
        { closeRoom, eraseSeats, activeRoomMembers },
        subjectRightsVerificationBindings,
      );
      erasedReached();
      await closureReleased;
    });
    await erasedReady;
    changing = deniedAsNotFound(() =>
      withRuntimeTestTransaction(writer, async (frame) => {
        await frame.sql`reset role`;
        return guardianCommand({
          store: createTabStore(frame.database),
          authorize,
          now: clock.now,
          newId: createId,
          minorsReleased: async () => true,
          consentNoticeVersion: 1,
        })(as(bots.Parent!), bots.Minor!.userId, {
          version: 1,
          commandId: createId(),
          expected: { guardianLink: 3 },
          command: {
            type: 'add-guardian',
            guardianLinkId: firstId,
            guardianUserId: closingGuardian.userId,
          },
        });
      }),
    );
    const closingWait = await finishedOrBlockedBehind(
      changing,
      observer,
      Number(closingBackend?.pid),
      { now: Date.now },
    );
    let linkFree = true;
    try {
      await observer.begin(async (tx) => {
        await tx`select id from guardian_links where id=${firstId} for update nowait`;
      });
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('errno' in error) ||
        error.errno !== '55P03'
      )
        throw error;
      linkFree = false;
    }
    assert({
      given:
        'the named new guardian closing through the actual subject-rights operation',
      should: 'wait for its account before locking the existing relationship',
      actual: [closingWait, linkFree],
      expected: ['blocked', true],
    });
    releaseClosure();
    await closing;
    const refused = await changing;
    const [resurrected] =
      await observer`select count(*)::int as count from guardian_links where guardian_user_id=${closingGuardian.userId}`;
    assert({
      given: 'that closure committed while the command waited',
      should:
        'reload the closed counterpart and refuse without creating a relationship',
      actual: [refused, Number(resurrected?.count)],
      expected: [true, 0],
    });
    const endingRead = pause();
    await endingRead.ready;
    changing = withRuntimeTestTransaction(writer, async (frame) => {
      await frame.sql`reset role`;
      return guardianCommand({
        store: createTabStore(frame.database),
        authorize,
        now: clock.now,
        newId: createId,
        minorsReleased: async () => true,
        consentNoticeVersion: 1,
      })(as(bots['Second parent']!), bots.Minor!.userId, {
        version: 1,
        commandId: createId(),
        expected: { guardianLink: 2 },
        command: { type: 'end-guardian-link', guardianLinkId: secondId },
      });
    });
    const endingWait = await observe(changing);
    release();
    const authorized = await endingRead.operation,
      ended = await changing,
      later = await view(original);
    assert({
      given: 'the actual relationship ending while its history read is paused',
      should:
        'finish the current authorized projection then deny the next read',
      actual: [
        endingWait,
        authorized !== null,
        (ended as { kind: string }).kind,
        later,
      ],
      expected: ['blocked', true, 'accepted', null],
    });
  } finally {
    release();
    releaseClosure();
    await Promise.allSettled([
      ...(reading ? [reading] : []),
      ...(changing ? [changing] : []),
      ...(overlapping ? [overlapping] : []),
      ...(closing ? [closing] : []),
    ]);
    await Promise.all([
      owner.close(),
      reader.close(),
      writer.close(),
      observer.close(),
    ]);
  }
}, 60_000);
