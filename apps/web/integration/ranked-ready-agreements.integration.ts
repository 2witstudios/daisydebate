import { daisyOrganizationId } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { isNamedSeat } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  agreementWords,
  contentWaiverDocument,
  casualCaptureNotice,
  CONTENT_WAIVER_VERSION,
} from '../src/features/legal/agreements';
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
    cast: [{ actorId: f.host.actorId, role: 'affirmative', slot: 0 }],
  });
  return created.view;
};

const withSeason = async (f: Fixture, run: () => Promise<void>) => {
  const seasonId = createId();
  await f.sql`insert into seasons(organization_id,id,name,starts_at,status) values(${daisyOrganizationId},${seasonId},'Waiver fixture','2000-01-01T00:00:00Z','active')`;
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

test('Ready on a ranked Round waits for the signed waiver alone, and records no notice', async () => {
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
        words: agreementWords(contentWaiverDocument),
      });
      const signed = await f.operations.view(f.host, room.id);
      const claimed = await refusalOf(
        f.command(f.host, signed, {
          type: 'ready',
          noticeVersion: casualCaptureNotice.version,
          expectedConsentVersion: signed.participants
            .filter(isNamedSeat)
            .find((p) => p.actorId === f.host.actorId)!.consentVersion,
        }),
      );
      const ready = await f.consent(f.host, signed, 'ready');
      const notices =
        await f.sql`select version, room_id from agreement_signatures where user_id=${f.host.userId} and agreement='round-capture-notice'`;
      assert({
        given:
          'an unsigned member, then a signed one whose Ready claims a notice, then states none',
        should:
          'refuse Ready until signed, show no notice, refuse the claimed one, then accept with no notice recorded',
        actual: {
          standing: standing.contentWaiver,
          unsigned,
          refusedRows: refusedRows[0]!.c,
          signed: signed.contentWaiver,
          shown: signed.captureNotice,
          claimed,
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
          shown: null,
          claimed: 'capture-notice-changed',
          isReady: 'ready',
          notices: [],
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

test('an unsigned human judge cannot Ready a ranked Round until they sign', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const room = await rankedRoom(f);
      const seated = (
        await f.command(f.outsider, room, {
          type: 'claim-seat',
          role: 'judge',
          slot: 0,
        })
      ).view;
      const unsigned = await refusalOf(f.consent(f.outsider, seated, 'ready'));
      await f.store.signContentWaiver({
        id: createId(),
        userId: f.outsider.userId,
        version: CONTENT_WAIVER_VERSION,
        words: agreementWords(contentWaiverDocument),
      });
      const signed = await f.operations.view(f.outsider, room.id);
      const ready = await f.consent(f.outsider, signed, 'ready');
      assert({
        given: 'a judge seat held by a member who never signed, then signs',
        should: 'refuse Ready on the server, then accept it',
        actual: [
          unsigned,
          ready.view.participants
            .filter(isNamedSeat)
            .find((p) => p.actorId === f.outsider.actorId)!.ready,
        ],
        expected: ['content-waiver-required', 'ready'],
      });
    }),
  );
});

test('a signature keeps the exact words, whatever the source says later', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      await f.store.signContentWaiver({
        id: createId(),
        userId: f.host.userId,
        version: CONTENT_WAIVER_VERSION,
        words: agreementWords(contentWaiverDocument),
      });
      const room = await rankedRoom(f);
      const view = await f.operations.view(f.host, room.id);
      await f.consent(f.host, view, 'ready');
      const rows =
        await f.sql`select agreement, words from agreement_signatures where user_id=${f.host.userId} order by agreement`;
      assert({
        given: 'a signed waiver and a Ready on a ranked Round',
        should: 'store the waiver with its words, and nothing else',
        actual: [...rows],
        expected: [
          {
            agreement: 'ranked-content-waiver',
            words: agreementWords(contentWaiverDocument),
          },
        ],
      });
    }),
  );
});

test('a ranked create needs no notice and records none', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const [preset] =
        await f.sql`select format_version,version from format_presets where format_id='freestyle' and superseded_at is null`;
      const selection = {
        kind: 'ranked' as const,
        formatId: 'freestyle',
        formatVersion: preset!.format_version,
        presetVersion: preset!.version,
      };
      const notices = (userId: string) =>
        f.sql`select version from agreement_signatures where user_id=${userId} and agreement='round-capture-notice'`;
      const created = await f.create({ selection });
      const claimed = await refusalOf(
        f.create(
          { selection, noticeVersion: casualCaptureNotice.version },
          f.guest,
        ),
      );
      const challenge = await f.create(
        { selection, holdSeatsFor: [f.outsider.actorId] },
        f.outsider,
      );
      assert({
        given:
          'a seatless ranked host stating no notice, a create claiming a notice, and a host holding a seat',
        should:
          'create the first and the last with no notice shown or recorded, and refuse the claim with nothing kept',
        actual: {
          created: [created.view.competitionType, created.view.captureNotice],
          seated: created.view.participants
            .filter(isNamedSeat)
            .some((p) => p.actorId === f.host.actorId),
          claimed,
          challenge: [
            challenge.view.competitionType,
            challenge.view.captureNotice,
          ],
          recorded: (
            await Promise.all(
              [f.host, f.guest, f.outsider].map((member) =>
                notices(member.userId),
              ),
            )
          ).map((rows) => rows.length),
        },
        expected: {
          created: ['ranked', null],
          seated: false,
          claimed: 'capture-notice-changed',
          challenge: ['ranked', null],
          recorded: [0, 0, 0],
        },
      });
    }),
  );
});
