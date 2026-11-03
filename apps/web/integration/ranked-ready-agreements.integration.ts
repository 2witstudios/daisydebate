import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { isNamedSeat } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { CONTENT_WAIVER_VERSION } from '../src/features/legal/agreements';
import { withRoomRuntime } from './room-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

const rankedRoom = async (f: Fixture) => {
  const [preset] =
    await f.sql`select format_version,version from format_presets where format_id='freestyle' and superseded_at is null`;
  const created = await f.create({
    resolution: { kind: 'strike' },
    selection: {
      kind: 'ranked',
      formatId: 'freestyle',
      formatVersion: preset!.format_version,
      presetVersion: preset!.version,
    },
  });
  return (
    await f.command(f.host, created.view, {
      type: 'claim-seat',
      role: 'affirmative',
      slot: 0,
    })
  ).view;
};

const withSeason = async (f: Fixture, run: () => Promise<void>) => {
  const seasonId = createId();
  await f.sql`insert into seasons(id,name,starts_at,status) values(${seasonId},'Waiver fixture','2000-01-01T00:00:00Z','active')`;
  try {
    await run();
  } finally {
    await f.sql`delete from agreement_signatures where season_id=${seasonId}`;
    await f.sql`delete from seasons where id=${seasonId}`;
  }
};

const refusalOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'accepted',
    (error: unknown) => (isAppError(error) ? error.message : 'threw'),
  );

test('Ready on a ranked Round waits for the signed waiver, and records the notice', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const room = await rankedRoom(f);
      const standing = await f.operations.view(f.host, room.id);
      const unsigned = await refusalOf(f.consent(f.host, standing, 'ready'));
      const refusedRows =
        await f.sql`select count(*)::int as c from agreement_signatures where user_id=${f.host.userId}`;
      await f.store.signContentWaiver({
        id: createId(),
        userId: f.host.userId,
        version: CONTENT_WAIVER_VERSION,
      });
      const signed = await f.operations.view(f.host, room.id);
      const stale = await refusalOf(
        f.command(f.host, signed, {
          type: 'ready',
          noticeVersion: 'ranked-draft-0',
          expectedConsentVersion: signed.participants
            .filter(isNamedSeat)
            .find((p) => p.actorId === f.host.actorId)!.consentVersion,
        }),
      );
      const ready = await f.consent(f.host, signed, 'ready');
      const notices =
        await f.sql`select version, room_id from agreement_signatures where user_id=${f.host.userId} and agreement='round-capture-notice'`;
      assert({
        given: 'an unsigned member, then a signed one, then a stale form',
        should:
          'refuse Ready until signed, refuse the stale form, then record the exact notice',
        actual: {
          standing: standing.contentWaiver,
          unsigned,
          refusedRows: refusedRows[0]!.c,
          signed: signed.contentWaiver,
          stale,
          isReady: ready.view.participants
            .filter(isNamedSeat)
            .find((p) => p.actorId === f.host.actorId)!.ready,
          notices: [...notices],
        },
        expected: {
          standing: 'unsigned',
          unsigned: 'content-waiver-required',
          refusedRows: 0,
          signed: 'signed',
          stale: 'capture-notice-changed',
          isReady: 'ready',
          notices: [{ version: 'ranked-draft-1', room_id: room.id }],
        },
      });
    }),
  );
});

test('a casual Round asks for neither', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const view = await f.operations.view(f.host, room.id);
    const rows =
      await f.sql`select count(*)::int as c from agreement_signatures where user_id=${f.host.userId}`;
    assert({
      given: 'a casual Ready from a member who never signed',
      should: 'accept it and record nothing',
      actual: [
        view.contentWaiver,
        view.captureNotice,
        rows[0]!.c,
        view.participants.filter(isNamedSeat).every((p) => p.ready === 'ready'),
      ],
      expected: [null, null, 0, true],
    });
  });
});
